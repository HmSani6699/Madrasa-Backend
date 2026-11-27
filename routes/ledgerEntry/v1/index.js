const router = require("express").Router();
const root = process.cwd();
const Joi = require("joi");
const { ObjectId } = require("mongodb");

const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const allowedRoles = ["admin", "mohtamim", "accountant"];

const getMadrasaFilter = (madrasaId) => {
  if (!madrasaId) return madrasaId;
  return ObjectId.isValid(madrasaId)
    ? { $in: [madrasaId.toString(), new ObjectId(madrasaId)] }
    : madrasaId;
};

const ledgerEntrySchema = Joi.object({
  mode: Joi.string().valid("income", "expense").required(),
  title: Joi.string().trim().required(),
  amount: Joi.number().positive().required(),
  category: Joi.string().trim().default("general"),
  paymentMode: Joi.string().trim().default("Cash"),
  account_id: Joi.string().allow("", null).optional(),
  remarks: Joi.string().allow("", null).default(""),
  date: Joi.string().allow("", null).optional(),
  voucherNo: Joi.string().allow("", null).optional(),
});

const resolveAccount = async (db, madrasaFilter, madrasaId, accountId, paymentMode) => {
  let account = null;
  if (accountId && ObjectId.isValid(accountId)) {
    account = await db.collection("accounts").findOne({
      _id: new ObjectId(accountId),
      madrasa_id: madrasaFilter,
    });
  }
  if (!account && paymentMode) {
    const modeLower = paymentMode.toLowerCase();
    const targetType = modeLower.includes("bank")
      ? "Bank"
      : modeLower.includes("cash")
        ? "Cash"
        : "Mobile Banking";
    account = await db.collection("accounts").findOne({
      madrasa_id: madrasaFilter,
      type: targetType,
    });
  }
  if (!account) {
    account = await db.collection("accounts").findOne({
      madrasa_id: madrasaFilter,
      type: "Cash",
    });
  }
  if (!account) {
    account = await db.collection("accounts").findOne({ madrasa_id: madrasaFilter });
  }
  if (!account && madrasaId) {
    const defaultAcc = {
      name: "Main Cash (মেইন ক্যাশ)",
      type: "Cash",
      account_number: "",
      bank_name: "",
      branch_name: "",
      balance: 0,
      status: "Active",
      description: "Default Cash Account",
      madrasa_id: madrasaId,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const res = await db.collection("accounts").insertOne(defaultAcc);
    defaultAcc._id = res.insertedId;
    account = defaultAcc;
  }
  return account;
};

const getLedgerEntries = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const mode = req.query.mode;

    const query = {
      madrasa_id: madrasaFilter,
      source: "ledger_entry",
    };
    if (mode === "income") query.type = "Income";
    if (mode === "expense") query.type = "Expense";

    const entries = await db
      .collection("transactions")
      .find(query)
      .sort({ date: -1, created_at: -1 })
      .toArray();

    const formatted = entries.map((item) => ({
      id: item._id.toString(),
      _id: item._id.toString(),
      mode: item.type === "Expense" ? "expense" : "income",
      voucherNo: item.receipt_no || item.voucherNo || "",
      title: item.title || item.description || "",
      amount: Number(item.amount || 0),
      category: item.sub_category || item.category || "general",
      paymentMode: item.payment_method || "Cash",
      account_id: item.account_id || "",
      account_name: item.account_name || "",
      remarks: item.remarks || "",
      date: item.date ? new Date(item.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Get Ledger Entries Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const createLedgerEntry = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaId = req.user.madrasa_id;
    const madrasaFilter = getMadrasaFilter(madrasaId);

    const { mode, title, amount, category, paymentMode, account_id, remarks, date } = req.body;
    const txType = mode === "expense" ? "Expense" : "Income";
    const prefix = mode === "expense" ? "EXP" : "INC";
    const voucherNo = req.body.voucherNo || `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    const dateStr = date ? String(date).split("T")[0] : new Date().toISOString().split("T")[0];
    const amountNum = Number(amount);

    const account = await resolveAccount(db, madrasaFilter, madrasaId, account_id, paymentMode);

    const txDoc = {
      madrasa_id: madrasaId,
      source: "ledger_entry",
      type: txType,
      category: category || "general",
      sub_category: category || "general",
      title: title.trim(),
      description: remarks ? `${title.trim()} (${remarks.trim()})` : title.trim(),
      remarks: (remarks || "").trim(),
      amount: amountNum,
      payment_method: paymentMode || "Cash",
      receipt_no: voucherNo,
      voucherNo,
      account_id: account ? account._id.toString() : "",
      account_name: account?.name || "Main Cash",
      date: new Date(dateStr),
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const insertRes = await db.collection("transactions").insertOne(txDoc);

    if (account) {
      const delta = txType === "Income" ? amountNum : -amountNum;
      await db.collection("accounts").updateOne(
        { _id: account._id },
        { $inc: { balance: delta }, $set: { updated_at: Date.now() } }
      );
    }

    res.status(201).json({
      success: true,
      message: mode === "expense" ? "খরচ সফলভাবে সংরক্ষণ করা হয়েছে!" : "আয় সফলভাবে সংরক্ষণ করা হয়েছে!",
      data: {
        id: insertRes.insertedId.toString(),
        _id: insertRes.insertedId.toString(),
        mode,
        voucherNo,
        title: txDoc.title,
        amount: amountNum,
        category: txDoc.category,
        paymentMode: txDoc.payment_method,
        account_id: txDoc.account_id,
        account_name: txDoc.account_name,
        remarks: txDoc.remarks,
        date: dateStr,
      },
    });
  } catch (error) {
    console.error("Create Ledger Entry Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateLedgerEntry = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid entry ID" });
    }

    const existing = await db.collection("transactions").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
      source: "ledger_entry",
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }

    const newAmount = Number(req.body.amount);
    const oldAmount = Number(existing.amount || 0);
    const diff = newAmount - oldAmount;
    const txType = existing.type;
    const dateStr = req.body.date
      ? String(req.body.date).split("T")[0]
      : new Date(existing.date || Date.now()).toISOString().split("T")[0];

    await db.collection("transactions").updateOne(
      { _id: existing._id },
      {
        $set: {
          title: req.body.title.trim(),
          category: req.body.category || existing.category,
          sub_category: req.body.category || existing.sub_category,
          description: req.body.remarks
            ? `${req.body.title.trim()} (${req.body.remarks.trim()})`
            : req.body.title.trim(),
          remarks: (req.body.remarks || "").trim(),
          amount: newAmount,
          payment_method: req.body.paymentMode || existing.payment_method,
          date: new Date(dateStr),
          updated_at: Date.now(),
        },
      }
    );

    if (diff !== 0 && existing.account_id && ObjectId.isValid(existing.account_id)) {
      const balanceDelta = txType === "Income" ? diff : -diff;
      await db.collection("accounts").updateOne(
        { _id: new ObjectId(existing.account_id) },
        { $inc: { balance: balanceDelta }, $set: { updated_at: Date.now() } }
      );
    }

    res.status(200).json({
      success: true,
      message: "তথ্য সফলভাবে আপডেট করা হয়েছে!",
      data: {
        id: existing._id.toString(),
        _id: existing._id.toString(),
        mode: txType === "Expense" ? "expense" : "income",
        voucherNo: existing.receipt_no || existing.voucherNo,
        title: req.body.title.trim(),
        amount: newAmount,
        category: req.body.category || existing.category,
        paymentMode: req.body.paymentMode || existing.payment_method,
        remarks: (req.body.remarks || "").trim(),
        date: dateStr,
      },
    });
  } catch (error) {
    console.error("Update Ledger Entry Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteLedgerEntry = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid entry ID" });
    }

    const existing = await db.collection("transactions").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
      source: "ledger_entry",
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }

    if (existing.account_id && ObjectId.isValid(existing.account_id)) {
      const reverseDelta = existing.type === "Income"
        ? -Number(existing.amount || 0)
        : Number(existing.amount || 0);
      await db.collection("accounts").updateOne(
        { _id: new ObjectId(existing.account_id) },
        { $inc: { balance: reverseDelta }, $set: { updated_at: Date.now() } }
      );
    }

    await db.collection("transactions").deleteOne({ _id: existing._id });
    res.status(200).json({ success: true, message: "রেকর্ড মুছে ফেলা হয়েছে" });
  } catch (error) {
    console.error("Delete Ledger Entry Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/", rbacMiddleware(allowedRoles), getLedgerEntries);
router.post("/", rbacMiddleware(allowedRoles), validate(ledgerEntrySchema), createLedgerEntry);
router.put("/:id", rbacMiddleware(allowedRoles), validate(ledgerEntrySchema), updateLedgerEntry);
router.delete("/:id", rbacMiddleware(allowedRoles), deleteLedgerEntry);

module.exports = router;
