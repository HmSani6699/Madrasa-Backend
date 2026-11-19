const router = require("express").Router();
const root = process.cwd();
const { ObjectId } = require("mongodb");
const Joi = require("joi");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const validate = require(`${root}/middleware/validate`);

// Joi Schemas
const generateSchema = Joi.object({
  month: Joi.number().min(1).max(12).required(),
  year: Joi.number().min(2000).max(2100).required()
});

const paymentSchema = Joi.object({
  monthly_salary_id: Joi.string().allow(null, ""),
  staff_id: Joi.string().required(),
  amount: Joi.number().min(1).required(),
  payment_type: Joi.string().valid("regular", "advance", "salary_payment").default("salary_payment"),
  payment_method: Joi.string().valid("Cash", "Bank", "Mobile Banking").required(),
  account_id: Joi.string().allow(null, ""),
  note: Joi.string().allow(""),
  transaction_id: Joi.string().allow("")
});

const adjustSchema = Joi.object({
  bonus: Joi.number().min(0).default(0),
  absent_deduction: Joi.number().min(0).default(0),
  advance_deduction: Joi.number().min(0).default(0),
  note: Joi.string().allow("")
});

const advanceSchema = Joi.object({
  staff_id: Joi.string().required(),
  amount: Joi.number().min(1).required(),
  payment_method: Joi.string().valid("Cash", "Bank", "Mobile Banking").required(),
  account_id: Joi.string().allow(null, ""),
  reason: Joi.string().allow(""),
  date: Joi.date().default(() => new Date())
});

// Update or Init Ledger Helper
const updateLedger = async (db, staff_id, madrasa_id, amount_change) => {
  const staffObjId = new ObjectId(staff_id);
  const ledger = await db.collection("payroll_ledgers").findOne({ staff_id: staffObjId });
  if (ledger) {
    await db.collection("payroll_ledgers").updateOne(
      { staff_id: staffObjId },
      { $inc: { balance: amount_change }, $set: { updated_at: Date.now() } }
    );
  } else {
    await db.collection("payroll_ledgers").insertOne({
      staff_id: staffObjId,
      madrasa_id: new ObjectId(madrasa_id),
      balance: amount_change,
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }
};

// 1. Generate Payroll for a Month & Year
const generatePayroll = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { month, year } = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

    if (req.user.role !== 'super_admin' && !madrasaId) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const query = { status: "active" };
    if (madrasaId) query.madrasa_id = madrasaId;

    // Get active setups
    const activeSetups = await db.collection("salary_setups").find(query).toArray();

    if (activeSetups.length === 0) {
      return res.status(400).json({
        success: false,
        message: "কোন সক্রিয় স্যালারি সেটআপ পাওয়া যায়নি। প্রথমে 'Salary Setup' থেকে বেতন নির্ধারণ করুন।"
      });
    }

    let generatedCount = 0;
    let skippedCount = 0;

    for (let setup of activeSetups) {
      // Check if already generated
      const exists = await db.collection("monthly_salaries").findOne({
        staff_id: setup.staff_id,
        month: parseInt(month),
        year: parseInt(year)
      });

      if (!exists) {
        // Calculate gross salary
        const basic = parseFloat(setup.basic_salary || 0);
        const houseRent = parseFloat(setup.house_rent || 0);
        const medical = parseFloat(setup.medical_allowance || 0);
        const transport = parseFloat(setup.transport_allowance || 0);
        const other = parseFloat(setup.other_allowance || 0);
        const grossSalary = basic + houseRent + medical + transport + other;

        // Check if employee has any active advance balance
        const advanceRecords = await db.collection("salary_advances").find({
          staff_id: setup.staff_id,
          status: "active",
          balance: { $gt: 0 }
        }).toArray();

        const totalActiveAdvance = advanceRecords.reduce((acc, curr) => acc + (curr.balance || 0), 0);

        const monthlyRecord = {
          madrasa_id: setup.madrasa_id,
          staff_id: setup.staff_id,
          salary_setup_id: setup._id,
          month: parseInt(month),
          year: parseInt(year),
          basic_salary: basic,
          house_rent: houseRent,
          medical_allowance: medical,
          transport_allowance: transport,
          other_allowance: other,
          gross_salary: grossSalary,
          bonus: 0,
          absent_days: 0,
          absent_deduction: 0,
          advance_deduction: 0,
          active_advance_balance: totalActiveAdvance,
          net_payable: grossSalary,
          paid_amount: 0,
          remaining_due: grossSalary,
          status: "unpaid",
          note: "",
          created_at: Date.now(),
          updated_at: Date.now()
        };

        await db.collection("monthly_salaries").insertOne(monthlyRecord);

        // Update Ledger (Company owes staff +net_payable)
        await updateLedger(db, setup.staff_id, setup.madrasa_id, grossSalary);
        generatedCount++;
      } else {
        skippedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `${generatedCount} জন কর্মীর জন্য পে-রোল তৈরি হয়েছে (${skippedCount} জন আগেই তৈরিকৃত ছিল)।`,
      generatedCount,
      skippedCount
    });

  } catch (error) {
    console.error("Payroll Generation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Monthly Payroll Sheet with Stats
const getMonthlyPayroll = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const status = req.query.status;
    const search = req.query.search;

    const matchQuery = {
      month: month,
      year: year
    };
    if (madrasaId && req.user.role !== 'super_admin') {
      matchQuery.madrasa_id = madrasaId;
    }
    if (status && status !== 'all') {
      matchQuery.status = status;
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "staff",
          localField: "staff_id",
          foreignField: "_id",
          as: "staff_info"
        }
      },
      { $unwind: { path: "$staff_info", preserveNullAndEmptyArrays: true } }
    ];

    if (search && search.trim()) {
      pipeline.push({
        $match: {
          $or: [
            { "staff_info.name": { $regex: search.trim(), $options: "i" } },
            { "staff_info.employeeID": { $regex: search.trim(), $options: "i" } },
            { "staff_info.phone": { $regex: search.trim(), $options: "i" } },
            { "staff_info.designation": { $regex: search.trim(), $options: "i" } }
          ]
        }
      });
    }

    pipeline.push({ $sort: { "staff_info.name": 1 } });

    const records = await db.collection("monthly_salaries").aggregate(pipeline).toArray();

    // Summary statistics for this month (from all records matching month & year)
    const allRecordsForMonth = await db.collection("monthly_salaries").find({
      month,
      year,
      ...(madrasaId && req.user.role !== 'super_admin' ? { madrasa_id: madrasaId } : {})
    }).toArray();

    const stats = {
      total_staff: allRecordsForMonth.length,
      total_gross: allRecordsForMonth.reduce((sum, r) => sum + (r.gross_salary || 0), 0),
      total_bonus: allRecordsForMonth.reduce((sum, r) => sum + (r.bonus || 0), 0),
      total_deductions: allRecordsForMonth.reduce((sum, r) => sum + ((r.absent_deduction || 0) + (r.advance_deduction || 0)), 0),
      total_net_payable: allRecordsForMonth.reduce((sum, r) => sum + (r.net_payable || 0), 0),
      total_paid: allRecordsForMonth.reduce((sum, r) => sum + (r.paid_amount || 0), 0),
      total_due: allRecordsForMonth.reduce((sum, r) => sum + (r.remaining_due || 0), 0),
      count_paid: allRecordsForMonth.filter(r => r.status === 'paid').length,
      count_partial: allRecordsForMonth.filter(r => r.status === 'partial').length,
      count_unpaid: allRecordsForMonth.filter(r => r.status === 'unpaid').length
    };

    res.status(200).json({ success: true, data: records, stats });
  } catch (error) {
    console.error("Get Monthly Payroll Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Process Salary Payment (Pay Salary)
const processPayment = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { monthly_salary_id, staff_id, amount, payment_method, note, transaction_id, account_id } = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const payAmount = parseFloat(amount);

    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ success: false, message: "সঠিক টাকার পরিমাণ দিন।" });
    }

    const staffObjId = new ObjectId(staff_id);
    const staff = await db.collection("staff").findOne({ _id: staffObjId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found." });

    let monthlyRecord = null;
    if (monthly_salary_id) {
      monthlyRecord = await db.collection("monthly_salaries").findOne({ _id: new ObjectId(monthly_salary_id) });
    }

    // 1. Create payroll transaction
    const transactionRecord = {
      madrasa_id: staff.madrasa_id || madrasaId,
      staff_id: staffObjId,
      monthly_salary_id: monthlyRecord ? monthlyRecord._id : null,
      month: monthlyRecord ? monthlyRecord.month : null,
      year: monthlyRecord ? monthlyRecord.year : null,
      amount: payAmount,
      payment_type: "salary_payment",
      payment_method: payment_method || "Cash",
      account_id: account_id ? new ObjectId(account_id) : null,
      note: note || "",
      transaction_id: transaction_id || `PAY-${Date.now().toString().slice(-6)}`,
      created_at: Date.now()
    };
    const newTx = await db.collection("payroll_transactions").insertOne(transactionRecord);

    // 2. Update monthly record if applicable
    if (monthlyRecord) {
      const newPaid = (monthlyRecord.paid_amount || 0) + payAmount;
      const newDue = Math.max(0, (monthlyRecord.net_payable || 0) - newPaid);
      const newStatus = newDue <= 0 ? "paid" : "partial";

      await db.collection("monthly_salaries").updateOne(
        { _id: monthlyRecord._id },
        {
          $set: {
            paid_amount: newPaid,
            remaining_due: newDue,
            status: newStatus,
            last_payment_date: Date.now(),
            updated_at: Date.now()
          }
        }
      );
    }

    // 3. Update Payroll Ledger (reduces company liability)
    await updateLedger(db, staffObjId, staff.madrasa_id || madrasaId, -payAmount);

    // 4. Integrated Institutional Expense Logging
    try {
      let targetAccountId = account_id ? new ObjectId(account_id) : null;
      if (!targetAccountId && (staff.madrasa_id || madrasaId)) {
        const defaultAcc = await db.collection("accounts").findOne({
          madrasa_id: staff.madrasa_id || madrasaId,
          type: payment_method === 'Cash' ? 'Cash' : (payment_method === 'Bank' ? 'Bank' : 'Mobile Banking')
        });
        if (defaultAcc) targetAccountId = defaultAcc._id;
      }

      if (targetAccountId) {
        await db.collection("accounts").updateOne(
          { _id: targetAccountId },
          { $inc: { balance: -payAmount }, $set: { updated_at: Date.now() } }
        );

        await db.collection("transactions").insertOne({
          madrasa_id: staff.madrasa_id || madrasaId,
          type: "Expense",
          category: "Salary",
          account_id: targetAccountId.toString(),
          amount: payAmount,
          date: new Date(),
          description: `Salary disbursement to ${staff.name} ${monthlyRecord ? `(${monthlyRecord.month}/${monthlyRecord.year})` : ''}`,
          reference_id: newTx.insertedId.toString(),
          created_at: Date.now()
        });
      }
    } catch (accErr) {
      console.warn("Account integration warning (non-fatal):", accErr.message);
    }

    res.status(201).json({
      success: true,
      message: `৳${payAmount.toLocaleString()} বেতন সফলভাবে পরিশোধ করা হয়েছে।`,
      data: {
        transactionId: transactionRecord.transaction_id,
        amount: payAmount,
        staffName: staff.name
      }
    });

  } catch (error) {
    console.error("Payment Processing Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Adjust Monthly Salary (Bonus, Absent Deduction, Advance Deduction)
const adjustMonthlySalary = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { id } = req.params;
    const { bonus, absent_deduction, advance_deduction, note } = req.body;

    const record = await db.collection("monthly_salaries").findOne({ _id: new ObjectId(id) });
    if (!record) {
      return res.status(404).json({ success: false, message: "Monthly salary record not found." });
    }

    const b = parseFloat(bonus || 0);
    const absD = parseFloat(absent_deduction || 0);
    const advD = parseFloat(advance_deduction || 0);

    const oldNet = record.net_payable || 0;
    const newNet = Math.max(0, (record.gross_salary || 0) + b - absD - advD);
    const paid = record.paid_amount || 0;
    const newDue = Math.max(0, newNet - paid);
    const newStatus = newDue <= 0 ? "paid" : (paid > 0 ? "partial" : "unpaid");

    await db.collection("monthly_salaries").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          bonus: b,
          absent_deduction: absD,
          advance_deduction: advD,
          net_payable: newNet,
          remaining_due: newDue,
          status: newStatus,
          note: note !== undefined ? note : record.note,
          updated_at: Date.now()
        }
      }
    );

    // Update Ledger for the difference
    const diff = newNet - oldNet;
    if (diff !== 0) {
      await updateLedger(db, record.staff_id, record.madrasa_id, diff);
    }

    res.status(200).json({
      success: true,
      message: "বেতন সফলভাবে সমন্বয় (Adjust) করা হয়েছে।",
      data: {
        gross_salary: record.gross_salary,
        bonus: b,
        absent_deduction: absD,
        advance_deduction: advD,
        net_payable: newNet,
        remaining_due: newDue,
        status: newStatus
      }
    });

  } catch (error) {
    console.error("Adjustment Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Issue Salary Advance / Loan
const issueAdvance = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { staff_id, amount, payment_method, account_id, reason, date } = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const advAmount = parseFloat(amount);

    const staffObjId = new ObjectId(staff_id);
    const staff = await db.collection("staff").findOne({ _id: staffObjId });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found." });

    const advanceRecord = {
      madrasa_id: staff.madrasa_id || madrasaId,
      staff_id: staffObjId,
      amount: advAmount,
      recovered_amount: 0,
      balance: advAmount,
      payment_method: payment_method || "Cash",
      account_id: account_id ? new ObjectId(account_id) : null,
      reason: reason || "",
      date: date ? new Date(date) : new Date(),
      status: "active",
      created_at: Date.now(),
      updated_at: Date.now()
    };
    await db.collection("salary_advances").insertOne(advanceRecord);

    // Also record payroll transaction
    await db.collection("payroll_transactions").insertOne({
      madrasa_id: staff.madrasa_id || madrasaId,
      staff_id: staffObjId,
      amount: advAmount,
      payment_type: "advance",
      payment_method: payment_method || "Cash",
      note: reason || "Advance issued",
      transaction_id: `ADV-${Date.now().toString().slice(-6)}`,
      created_at: Date.now()
    });

    // Update Ledger (Advance payment reduces balance)
    await updateLedger(db, staffObjId, staff.madrasa_id || madrasaId, -advAmount);

    res.status(201).json({
      success: true,
      message: `৳${advAmount.toLocaleString()} অগ্রিম প্রদান সফল হয়েছে।`
    });

  } catch (error) {
    console.error("Issue Advance Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Get Advances List
const getAdvances = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const query = {};
    if (madrasaId && req.user.role !== 'super_admin') {
      query.madrasa_id = madrasaId;
    }

    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: "staff",
          localField: "staff_id",
          foreignField: "_id",
          as: "staff_info"
        }
      },
      { $unwind: { path: "$staff_info", preserveNullAndEmptyArrays: true } },
      { $sort: { date: -1, created_at: -1 } }
    ];

    const advances = await db.collection("salary_advances").aggregate(pipeline).toArray();
    res.status(200).json({ success: true, data: advances });

  } catch (error) {
    console.error("Get Advances Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. Get Payslip Details
const getPayslip = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { id } = req.params;
    const record = await db.collection("monthly_salaries").findOne({ _id: new ObjectId(id) });
    if (!record) {
      return res.status(404).json({ success: false, message: "Payslip record not found." });
    }

    const staff = await db.collection("staff").findOne({ _id: record.staff_id });
    const madrasa = record.madrasa_id ? await db.collection("madrasas").findOne({ _id: record.madrasa_id }) : null;
    const transactions = await db.collection("payroll_transactions").find({ monthly_salary_id: record._id }).toArray();

    res.status(200).json({
      success: true,
      data: {
        payroll: record,
        staff: staff || {},
        madrasa: madrasa || { name: "Madrasatul Madina", address: "Dhaka, Bangladesh" },
        transactions: transactions || []
      }
    });

  } catch (error) {
    console.error("Get Payslip Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Delete Monthly Salary Record (Reset for single employee)
const deleteMonthlySalary = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { id } = req.params;
    const record = await db.collection("monthly_salaries").findOne({ _id: new ObjectId(id) });
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });

    if (record.paid_amount > 0) {
      return res.status(400).json({
        success: false,
        message: "পরিশোধকৃত বেতন মুছে ফেলা যাবে না। প্রয়োজনে সমন্বয় করুন।"
      });
    }

    await db.collection("monthly_salaries").deleteOne({ _id: record._id });
    // Reverse ledger
    await updateLedger(db, record.staff_id, record.madrasa_id, -record.net_payable);

    res.status(200).json({ success: true, message: "রেকর্ড মুছে ফেলা হয়েছে।" });
  } catch (error) {
    console.error("Delete Record Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Get Ledgers (Compatible with current implementation)
const getLedgers = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const query = {};
    if (req.user.role !== 'super_admin' && madrasaId) {
      query.madrasa_id = madrasaId;
    }

    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: "payroll_ledgers",
          localField: "_id",
          foreignField: "staff_id",
          as: "ledger"
        }
      },
      { $unwind: { path: "$ledger", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "salary_setups",
          let: { staffId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$staff_id", "$$staffId"] }, status: "active" } }
          ],
          as: "active_setup"
        }
      },
      { $unwind: { path: "$active_setup", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          role: 1,
          employeeID: 1,
          designation: 1,
          email: 1,
          phone: 1,
          photo: 1,
          madrasa_id: 1,
          balance: { $ifNull: ["$ledger.balance", 0] },
          basic_salary: { $ifNull: ["$active_setup.basic_salary", 0] },
          total_salary: { $ifNull: ["$active_setup.total_salary", 0] },
          has_setup: { $cond: [{ $ifNull: ["$active_setup._id", false] }, true, false] }
        }
      },
      { $sort: { name: 1 } }
    ];

    const ledgers = await db.collection("staff").aggregate(pipeline).toArray();
    res.status(200).json({ success: true, data: ledgers });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 10. Get Staff Ledger History
const getHistory = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const staffId = new ObjectId(req.params.staffId);

    // Fetch generations
    const generations = await db.collection("monthly_salaries").find({ staff_id: staffId }).toArray();
    // Fetch payments
    const payments = await db.collection("payroll_transactions").find({ staff_id: staffId }).toArray();
    // Fetch advances
    const advances = await db.collection("salary_advances").find({ staff_id: staffId }).toArray();

    const history = [
      ...generations.map(g => ({
        type: 'generation',
        title: `মাসিক বেতন নির্ধারণ - ${g.month}/${g.year}`,
        amount: g.net_payable,
        date: g.created_at,
        sign: '+'
      })),
      ...payments.map(p => ({
        type: p.payment_type === 'advance' ? 'advance' : 'payment',
        title: p.payment_type === 'advance' ? 'অগ্রিম গ্রহণ' : 'বেতন পরিশোধ',
        amount: p.amount,
        method: p.payment_method,
        date: p.created_at,
        sign: '-'
      }))
    ].sort((a, b) => b.date - a.date);

    res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Apply middleware
router.use(authMiddleware);
router.use(tenantMiddleware);

// Routes
router.post("/generate", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(generateSchema), generatePayroll);
router.get("/monthly", rbacMiddleware(['admin', 'super_admin', 'accountant']), getMonthlyPayroll);
router.post("/pay", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(paymentSchema), processPayment);
router.post("/payment", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(paymentSchema), processPayment);
router.put("/adjust/:id", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(adjustSchema), adjustMonthlySalary);
router.post("/advance", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(advanceSchema), issueAdvance);
router.get("/advance", rbacMiddleware(['admin', 'super_admin', 'accountant']), getAdvances);
router.get("/payslip/:id", rbacMiddleware(['admin', 'super_admin', 'accountant', 'teacher', 'staff']), getPayslip);
router.delete("/monthly/:id", rbacMiddleware(['admin', 'super_admin', 'accountant']), deleteMonthlySalary);
router.get("/ledgers", rbacMiddleware(['admin', 'super_admin', 'accountant']), getLedgers);
router.get("/history/:staffId", rbacMiddleware(['admin', 'super_admin', 'accountant']), getHistory);

module.exports = router;
