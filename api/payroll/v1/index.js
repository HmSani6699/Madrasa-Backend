const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const validate = require(`${root}/middleware/validate`);

// Schemas
const generateSchema = Joi.object({
  month: Joi.number().min(1).max(12).required(),
  year: Joi.number().min(2000).max(2100).required()
});

const paymentSchema = Joi.object({
  staff_id: Joi.string().required(),
  amount: Joi.number().min(1).required(),
  payment_type: Joi.string().valid("regular", "advance").required(),
  payment_method: Joi.string().valid("Cash", "Bank", "Mobile Banking").required(),
  note: Joi.string().allow(""),
  transaction_id: Joi.string().allow("")
});

// Update or Init Ledger Helper
const updateLedger = async (db, staff_id, madrasa_id, amount_change) => {
  const ledger = await db.collection("payroll_ledgers").findOne({ staff_id: new ObjectId(staff_id) });
  if (ledger) {
    await db.collection("payroll_ledgers").updateOne(
      { staff_id: new ObjectId(staff_id) },
      { $inc: { balance: amount_change }, $set: { updated_at: Date.now() } }
    );
  } else {
    await db.collection("payroll_ledgers").insertOne({
      staff_id: new ObjectId(staff_id),
      madrasa_id: new ObjectId(madrasa_id),
      balance: amount_change,
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }
};

// 1. Generate Payroll
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
      return res.status(400).json({ success: false, message: "No active salary setups found." });
    }

    let generatedCount = 0;
    
    for (let setup of activeSetups) {
      // Check if already generated
      const exists = await db.collection("monthly_salaries").findOne({
        staff_id: setup.staff_id,
        month: parseInt(month),
        year: parseInt(year)
      });

      if (!exists) {
        const net_payable = setup.total_salary; // For simplicity, no dynamic deductions here yet
        
        const monthlyRecord = {
          madrasa_id: setup.madrasa_id,
          staff_id: setup.staff_id,
          salary_setup_id: setup._id,
          month: parseInt(month),
          year: parseInt(year),
          basic_salary: setup.basic_salary,
          total_allowance: (setup.house_rent || 0) + (setup.medical_allowance || 0) + (setup.transport_allowance || 0) + (setup.other_allowance || 0),
          total_salary: setup.total_salary,
          net_payable: net_payable,
          status: "generated",
          created_at: Date.now()
        };
        
        await db.collection("monthly_salaries").insertOne(monthlyRecord);
        
        // Update Ledger (Company owes staff +net_payable)
        await updateLedger(db, setup.staff_id, setup.madrasa_id, net_payable);
        generatedCount++;
      }
    }

    res.status(200).json({ 
      success: true, 
      message: `Payroll generated for ${generatedCount} staff members.`,
      generatedCount
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Ledgers
const getLedgers = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const query = {};
    if (req.user.role !== 'super_admin') {
      query["staff_info.madrasa_id"] = madrasaId;
    }

    const pipeline = [
      {
        $lookup: {
          from: "payroll_ledgers",
          localField: "_id",
          foreignField: "staff_id",
          as: "ledger"
        }
      },
      {
        $unwind: {
          path: "$ledger",
          preserveNullAndEmptyArrays: true
        }
      },
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
      {
        $unwind: {
          path: "$active_setup",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          name: 1,
          role: 1,
          email: 1,
          phone: 1,
          madrasa_id: 1,
          balance: { $ifNull: ["$ledger.balance", 0] },
          basic_salary: { $ifNull: ["$active_setup.basic_salary", 0] },
          total_salary: { $ifNull: ["$active_setup.total_salary", 0] }
        }
      },
      { $match: madrasaId && req.user.role !== 'super_admin' ? { madrasa_id: madrasaId } : {} },
      { $sort: { name: 1 } }
    ];

    const ledgers = await db.collection("staff").aggregate(pipeline).toArray();
    res.status(200).json({ success: true, data: ledgers });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Make Payment / Advance
const processPayment = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const { staff_id, amount, payment_type, payment_method, note, transaction_id } = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

    const staff = await db.collection("staff").findOne({ _id: new ObjectId(staff_id) });
    if (!staff) return res.status(404).json({ success: false, message: "Staff not found" });

    if (req.user.role !== 'super_admin' && staff.madrasa_id.toString() !== madrasaId.toString()) {
       return res.status(403).json({ success: false, message: "Access denied." });
    }

    const transaction = {
      madrasa_id: staff.madrasa_id,
      staff_id: staff._id,
      amount: parseFloat(amount),
      payment_type: payment_type, // 'regular' or 'advance'
      payment_method,
      note: note || "",
      transaction_id: transaction_id || "",
      created_at: Date.now()
    };

    await db.collection("payroll_transactions").insertOne(transaction);

    // Payment reduces the due balance (or increases advance / negative balance)
    await updateLedger(db, staff._id, staff.madrasa_id, -parseFloat(amount));

    res.status(201).json({ success: true, message: `Payment of ৳${amount} processed successfully as ${payment_type}.` });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Get Ledger History
const getHistory = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const staffId = new ObjectId(req.params.staffId);
    
    // Fetch generations
    const generations = await db.collection("monthly_salaries").find({ staff_id: staffId }).toArray();
    // Fetch payments
    const payments = await db.collection("payroll_transactions").find({ staff_id: staffId }).toArray();

    // Combine and sort
    const history = [
      ...generations.map(g => ({
        type: 'generation',
        title: `Salary Generated - ${g.month}/${g.year}`,
        amount: g.net_payable,
        date: g.created_at,
        sign: '+'
      })),
      ...payments.map(p => ({
        type: p.payment_type === 'advance' ? 'advance' : 'payment',
        title: p.payment_type === 'advance' ? 'Advance Taken' : 'Salary Paid',
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
router.get("/ledgers", rbacMiddleware(['admin', 'super_admin', 'accountant']), getLedgers);
router.post("/payment", rbacMiddleware(['admin', 'super_admin', 'accountant']), validate(paymentSchema), processPayment);
router.get("/history/:staffId", rbacMiddleware(['admin', 'super_admin', 'accountant']), getHistory);

module.exports = router;
