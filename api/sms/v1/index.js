const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

// Apply protection and tenant check
router.use(authMiddleware);
router.use(tenantMiddleware);

// 1. Submit Recharge Request (Manual payment verification, Min BDT 100)
router.post("/sms/recharge-request", async (req, res) => {
  const { amount, senderNumber, transactionId } = req.body;
  const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

  if (!madrasaId) {
    return res.status(400).json({ success: false, message: "Invalid Madrasa context" });
  }

  if (!amount || !senderNumber || !transactionId) {
    return res.status(400).json({ success: false, message: "All fields (amount, senderNumber, transactionId) are required" });
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 100) {
    return res.status(400).json({ success: false, message: "Minimum recharge amount is BDT 100" });
  }

  const { db } = await mongoConnect();
  try {
    const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
    const rechargeRequest = {
      madrasaId,
      madrasaName: madrasa?.name || "Unknown Madrasa",
      amount: numAmount,
      senderNumber,
      transactionId,
      status: "Pending",
      created_at: new Date()
    };

    const result = await db.collection("sms_recharges").insertOne(rechargeRequest);
    res.status(201).json({ 
      success: true, 
      message: "Recharge request submitted successfully! Pending approval from Super Admin.",
      data: { ...rechargeRequest, _id: result.insertedId }
    });
  } catch (error) {
    console.error("SMS Recharge Request Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 2. Get past recharge requests for this Madrasa
router.get("/sms/recharges", async (req, res) => {
  const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
  if (!madrasaId) {
    return res.status(400).json({ success: false, message: "Invalid Madrasa context" });
  }

  const { db } = await mongoConnect();
  try {
    const recharges = await db.collection("sms_recharges")
      .find({ madrasaId })
      .sort({ created_at: -1 })
      .toArray();
    res.status(200).json({ success: true, data: recharges });
  } catch (error) {
    console.error("Get Madrasa Recharges Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 3. Get active wallet balance & statistics
router.get("/sms/balance", async (req, res) => {
  const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
  if (!madrasaId) {
    return res.status(400).json({ success: false, message: "Invalid Madrasa context" });
  }

  const { db } = await mongoConnect();
  try {
    const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
    const balance = madrasa?.smsWalletBalance || 0;

    let rates = await db.collection("sms_rates").findOne();
    if (!rates) {
      rates = {
        singleSmsRate: 0.30,
        bulkSmsRate: 0.25,
        maskingSmsRate: 0.40
      };
    }

    res.status(200).json({ 
      success: true, 
      data: {
        balance,
        rates: {
          single: rates.singleSmsRate,
          bulk: rates.bulkSmsRate,
          masking: rates.maskingSmsRate
        }
      } 
    });
  } catch (error) {
    console.error("Get SMS Balance Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 4. Targeted Broadcast SMS Portal API
router.post("/sms/broadcast", async (req, res) => {
  const { recipientType, recipientId, classId, message, smsType } = req.body;
  const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

  if (!madrasaId) {
    return res.status(400).json({ success: false, message: "Invalid Madrasa context" });
  }

  if (!recipientType || !message || !smsType) {
    return res.status(400).json({ success: false, message: "recipientType, message, and smsType are required fields" });
  }

  const { db } = await mongoConnect();
  try {
    // 1. Fetch SMS Rates
    let rates = await db.collection("sms_rates").findOne();
    if (!rates) {
      rates = { singleSmsRate: 0.30, bulkSmsRate: 0.25, maskingSmsRate: 0.40 };
    }

    let ratePerSms = rates.singleSmsRate;
    if (smsType === 'Bulk') ratePerSms = rates.bulkSmsRate;
    if (smsType === 'Masking') ratePerSms = rates.maskingSmsRate;

    // 2. Fetch target recipient phone numbers
    let phones = [];
    const logsToInsert = [];

    if (recipientType === 'Student') {
      if (recipientId) {
        if (ObjectId.isValid(recipientId)) {
          const student = await db.collection("students").findOne({ _id: new ObjectId(recipientId), madrasa_id: madrasaId });
          if (student) {
            const parent = student.guardian_id ? await db.collection("parents").findOne({ _id: student.guardian_id }) : null;
            const phone = student.phone || parent?.contact;
            if (phone) {
              phones.push(phone);
              logsToInsert.push({ name: `${student.firstName} ${student.lastName || ''}`.trim(), phone });
            }
          }
        }
      } else {
        const students = await db.collection("students").find({ madrasa_id: madrasaId }).toArray();
        for (const s of students) {
          const parent = s.guardian_id ? await db.collection("parents").findOne({ _id: s.guardian_id }) : null;
          const phone = s.phone || parent?.contact;
          if (phone) {
            phones.push(phone);
            logsToInsert.push({ name: `${s.firstName} ${s.lastName || ''}`.trim(), phone });
          }
        }
      }
    } else if (recipientType === 'Class') {
      if (classId) {
        const students = await db.collection("students").find({ madrasa_id: madrasaId, class_id: classId }).toArray();
        for (const s of students) {
          const parent = s.guardian_id ? await db.collection("parents").findOne({ _id: s.guardian_id }) : null;
          const phone = s.phone || parent?.contact;
          if (phone) {
            phones.push(phone);
            logsToInsert.push({ name: `${s.firstName} ${s.lastName || ''}`.trim(), phone });
          }
        }
      }
    } else if (recipientType === 'Teacher') {
      if (recipientId) {
        if (ObjectId.isValid(recipientId)) {
          const teacher = await db.collection("staffs").findOne({ _id: new ObjectId(recipientId), madrasa_id: madrasaId });
          if (teacher && teacher.phone) {
            phones.push(teacher.phone);
            logsToInsert.push({ name: teacher.name, phone: teacher.phone });
          }
        }
      } else {
        const teachers = await db.collection("staffs").find({ madrasa_id: madrasaId, role: "teacher" }).toArray();
        for (const t of teachers) {
          if (t.phone) {
            phones.push(t.phone);
            logsToInsert.push({ name: t.name, phone: t.phone });
          }
        }
      }
    } else if (recipientType === 'Parent') {
      if (recipientId) {
        if (ObjectId.isValid(recipientId)) {
          const parent = await db.collection("parents").findOne({ _id: new ObjectId(recipientId), madrasa_id: madrasaId });
          if (parent && parent.contact) {
            phones.push(parent.contact);
            logsToInsert.push({ name: parent.fatherName || parent.motherName || "Parent", phone: parent.contact });
          }
        }
      } else {
        const parents = await db.collection("parents").find({ madrasa_id: madrasaId }).toArray();
        for (const p of parents) {
          if (p.contact) {
            phones.push(p.contact);
            logsToInsert.push({ name: p.fatherName || p.motherName || "Parent", phone: p.contact });
          }
        }
      }
    }

    // De-duplicate phone numbers
    const uniquePhones = [...new Set(phones)];
    if (uniquePhones.length === 0) {
      return res.status(400).json({ success: false, message: "No valid recipient phone numbers found" });
    }

    // 3. Compute cost and check wallet balance
    const totalSmsCount = uniquePhones.length;
    const totalCost = Number((totalSmsCount * ratePerSms).toFixed(2));

    const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
    const balance = madrasa?.smsWalletBalance || 0;

    if (balance < totalCost) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient wallet balance! This broadcast requires BDT ${totalCost}, but your current wallet balance is BDT ${balance}. Please recharge and try again.` 
      });
    }

    // 4. Deduct BDT cost and log transactions
    await db.collection("madrasas").updateOne(
      { _id: madrasaId },
      { $inc: { smsWalletBalance: -totalCost } }
    );

    // Save logs to database
    const smsLogs = logsToInsert.filter(log => uniquePhones.includes(log.phone)).map(log => ({
      madrasaId,
      recipientName: log.name,
      to: log.phone,
      message,
      smsType,
      cost: ratePerSms,
      sentAt: new Date()
    }));

    if (smsLogs.length > 0) {
      await db.collection("sms_logs").insertMany(smsLogs);
    }

    res.status(200).json({
      success: true,
      message: `SMS broadcast sent successfully to ${totalSmsCount} recipients!`,
      data: {
        totalSent: totalSmsCount,
        cost: totalCost,
        remainingBalance: Number((balance - totalCost).toFixed(2))
      }
    });
  } catch (error) {
    console.error("SMS Broadcast Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
