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

const donationSchema = Joi.object({
  donorName: Joi.string().trim().required(),
  phone: Joi.string().allow("", null).default(""),
  address: Joi.string().allow("", null).default(""),
  amount: Joi.number().positive().required(),
  type: Joi.string().trim().default("general"),
  paymentMode: Joi.string().trim().default("Cash"),
  account_id: Joi.string().allow("", null).optional(),
  remarks: Joi.string().allow("", null).default(""),
  date: Joi.string().allow("", null).optional(),
  receiptNo: Joi.string().allow("", null).optional(),
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

const getDonations = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const query = { madrasa_id: madrasaFilter };

    if (req.query.type && req.query.type !== "all" && req.query.type !== "All") {
      query.type = req.query.type;
    }
    if (req.query.paymentMode && req.query.paymentMode !== "all" && req.query.paymentMode !== "All") {
      query.paymentMode = { $regex: `^${req.query.paymentMode}$`, $options: "i" };
    }

    const donations = await db
      .collection("donations")
      .find(query)
      .sort({ date: -1, created_at: -1 })
      .toArray();

    res.status(200).json({ success: true, data: donations });
  } catch (error) {
    console.error("Get Donations Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const createDonation = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaId = req.user.madrasa_id;
    const madrasaFilter = getMadrasaFilter(madrasaId);

    const amountNum = Number(req.body.amount);
    const dateStr = req.body.date
      ? String(req.body.date).split("T")[0]
      : new Date().toISOString().split("T")[0];
    const receiptNo =
      req.body.receiptNo || `DON-${Math.floor(1000 + Math.random() * 9000)}`;

    const account = await resolveAccount(
      db,
      madrasaFilter,
      madrasaId,
      req.body.account_id,
      req.body.paymentMode
    );

    const doc = {
      madrasa_id: madrasaId,
      donorName: req.body.donorName.trim(),
      phone: req.body.phone || "",
      address: req.body.address || "",
      amount: amountNum,
      type: req.body.type || "general",
      paymentMode: req.body.paymentMode || "Cash",
      account_id: account ? account._id.toString() : "",
      account_name: account?.name || "Main Cash",
      remarks: req.body.remarks || "",
      receiptNo,
      date: dateStr,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const insertRes = await db.collection("donations").insertOne(doc);
    doc._id = insertRes.insertedId;

    if (account) {
      const txResult = await db.collection("transactions").insertOne({
        madrasa_id: madrasaId,
        type: "Income",
        category: "Donation",
        sub_category: doc.type,
        account_id: account._id.toString(),
        account_name: account.name || "Main Cash",
        amount: amountNum,
        payment_method: doc.paymentMode,
        receipt_no: receiptNo,
        description: `Donation from ${doc.donorName} (${doc.type})${doc.remarks ? ` - ${doc.remarks}` : ""}`,
        reference_id: doc._id.toString(),
        donor_name: doc.donorName,
        date: new Date(dateStr),
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await db.collection("donations").updateOne(
        { _id: doc._id },
        { $set: { transaction_id: txResult.insertedId.toString() } }
      );

      await db.collection("accounts").updateOne(
        { _id: account._id },
        { $inc: { balance: amountNum }, $set: { updated_at: Date.now() } }
      );
    }

    res.status(201).json({
      success: true,
      message: "অনুদান সফলভাবে সংরক্ষণ করা হয়েছে!",
      data: doc,
    });
  } catch (error) {
    console.error("Create Donation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteDonation = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid donation ID" });
    }

    const existing = await db.collection("donations").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Donation not found" });
    }

    if (existing.transaction_id && ObjectId.isValid(existing.transaction_id)) {
      await db.collection("transactions").deleteOne({ _id: new ObjectId(existing.transaction_id) });
      if (existing.account_id && ObjectId.isValid(existing.account_id)) {
        await db.collection("accounts").updateOne(
          { _id: new ObjectId(existing.account_id) },
          { $inc: { balance: -Number(existing.amount || 0) } }
        );
      }
    }

    await db.collection("donations").deleteOne({ _id: existing._id });
    res.status(200).json({ success: true, message: "Donation deleted successfully" });
  } catch (error) {
    console.error("Delete Donation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/", rbacMiddleware(allowedRoles), getDonations);
router.post("/", rbacMiddleware(allowedRoles), validate(donationSchema), createDonation);
router.delete("/:id", rbacMiddleware(allowedRoles), deleteDonation);

module.exports = router;
