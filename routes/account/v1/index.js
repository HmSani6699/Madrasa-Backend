const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

router.use(authMiddleware);
router.use(tenantMiddleware);

// Joi Schema
const accountSchema = Joi.object({
  name: Joi.string().required(), // e.g., "Main Cash", "Sonali Bank"
  type: Joi.string().valid("Cash", "Bank", "Mobile Banking").required(),
  account_number: Joi.string().allow(""),
  bank_name: Joi.string().allow(""),
  branch_name: Joi.string().allow(""),
  balance: Joi.number().default(0),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  description: Joi.string().allow("")
});

// Get all accounts
const getAllAccounts = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user?.madrasa_id;
    const query = { madrasa_id: madrasaId };
    if (req.query.type) query.type = req.query.type;
    if (req.query.status) query.status = req.query.status;
    
    let accounts = await mongo.fetchMany(db, "accounts", query, {}, { name: 1 });
    
    // Auto-seed default Cash account if none exists for this madrasa
    if (accounts.length === 0 && madrasaId) {
      const defaultAccount = {
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
        updated_at: Date.now()
      };
      const result = await mongo.insertOne(db, "accounts", defaultAccount);
      defaultAccount._id = result.insertedId;
      accounts = [defaultAccount];
    }

    const total = accounts.length;
    res.status(200).json({ success: true, data: accounts, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single account by ID
const getAccountById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const account = await mongo.fetchOne(db, "accounts", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    res.status(200).json({ success: true, data: account });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new account
const createAccount = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const accountData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const account = await mongo.insertOne(db, "accounts", accountData);
    res.status(201).json({ success: true, data: account });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update account
const updateAccount = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "accounts",
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    
    res.status(200).json({ success: true, message: "Account updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete account
// Note: Should check for existing transactions before deleting!
const deleteAccount = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id;
    // Check usage
    const usage = await mongo.documentCount(db, "transactions", { account_id: req.params.id, madrasa_id: madrasaId });
    if (usage > 0) {
        return res.status(400).json({ success: false, message: "Cannot delete account with existing transactions" });
    }

    const result = await mongo.deleteData(db, "accounts", { _id: req.params.id, madrasa_id: madrasaId });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }
    
    res.status(200).json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/accounts", getAllAccounts);
router.get("/accounts/:id", getAccountById);
router.post("/accounts", validate(accountSchema), createAccount);
router.put("/accounts/:id", validate(accountSchema), updateAccount);
router.delete("/accounts/:id", deleteAccount);

module.exports = router;
