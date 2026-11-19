const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const { ObjectId } = require("mongodb");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const transactionSchema = Joi.object({
  type: Joi.string().valid("Income", "Expense", "Transfer").required(),
  category: Joi.string().required(), // Salary, Fee, Donation, Utility, etc.
  account_id: Joi.string().required(),
  transfer_to_account_id: Joi.string().allow(null, ""), // Required if type is Transfer
  amount: Joi.number().min(0).required(),
  date: Joi.date().default(Date.now),
  description: Joi.string().allow(""),
  reference_id: Joi.string().allow("") // Link to other entities
});

// Get all transactions
const getAllTransactions = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.account_id) query.account_id = req.query.account_id;
    if (req.query.type) query.type = req.query.type;
    if (req.query.category) query.category = req.query.category;
    
    if (req.query.start_date && req.query.end_date) {
      query.date = {
        $gte: new Date(req.query.start_date),
        $lte: new Date(req.query.end_date)
      };
    }
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const transactions = await mongo.fetchMany(db, "transactions", query, {}, { date: -1 }, limit, page);
    const total = await mongo.documentCount(db, "transactions", query);
    res.status(200).json({ success: true, data: transactions, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single transaction
const getTransactionById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id;
    const transaction = await mongo.fetchOne(db, "transactions", { _id: req.params.id, madrasa_id: madrasaId });
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    
    // Populate account info
    if (transaction.account_id) {
        const acc = await mongo.fetchOne(db, "accounts", { _id: transaction.account_id, madrasa_id: madrasaId });
        transaction.account = acc;
    }
    
    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new transaction and update balance(s)
const createTransaction = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { type, account_id, amount, transfer_to_account_id } = req.body;
    const madrasaId = req.user.madrasa_id;
    
    // Validate accounts exist
    const account = await mongo.fetchOne(db, "accounts", { _id: account_id, madrasa_id: madrasaId });
    if (!account) return res.status(404).json({ success: false, message: "Source account not found" });

    // Validate balance for Expense/Transfer
    if ((type === "Expense" || type === "Transfer") && account.balance < amount) {
        return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    if (type === "Transfer") {
        if (!transfer_to_account_id) return res.status(400).json({ success: false, message: "Destination account required for Transfer" });
        const destAccount = await mongo.fetchOne(db, "accounts", { _id: transfer_to_account_id, madrasa_id: madrasaId });
        if (!destAccount) return res.status(404).json({ success: false, message: "Destination account not found" });
    }

    // Prepare transaction record
    const transactionData = {
      ...req.body,
      madrasa_id: madrasaId,
      date: new Date(req.body.date || Date.now()),
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const transaction = await mongo.insertOne(db, "transactions", transactionData);
    
    // Update Balances
    // Note: In production, use a transaction session for atomicity. 
    // Here we do sequential updates.
    
    if (type === "Income") {
        await db.collection("accounts").updateOne({ _id: new ObjectId(account_id), madrasa_id: madrasaId }, { $inc: { balance: amount } });
    } else if (type === "Expense") {
        await db.collection("accounts").updateOne({ _id: new ObjectId(account_id), madrasa_id: madrasaId }, { $inc: { balance: -amount } });
    } else if (type === "Transfer") {
        await db.collection("accounts").updateOne({ _id: new ObjectId(account_id), madrasa_id: madrasaId }, { $inc: { balance: -amount } });
        await db.collection("accounts").updateOne({ _id: new ObjectId(transfer_to_account_id), madrasa_id: madrasaId }, { $inc: { balance: amount } });
    }

    res.status(201).json({ success: true, data: transaction, message: "Transaction recorded and balance updated" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/transactions", getAllTransactions);
router.get("/transactions/:id", getTransactionById);
router.post("/transactions", validate(transactionSchema), createTransaction);

module.exports = router;
