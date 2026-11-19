const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

// Joi Schemas
const feeHeadSchema = Joi.object({
  name: Joi.string().required(),
  type: Joi.string().valid("Monthly", "One-time", "Annual", "Per Exam").required(),
  description: Joi.string().allow("")
});

const bulkFeeSetupSchema = Joi.object({
  head_id: Joi.string().required(),
  fees: Joi.array().items(Joi.object({
    class_id: Joi.string().required(),
    amount: Joi.number().min(0).required()
  })).required()
});

// --- Fee Heads CRUD ---

const getAllFeeHeads = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    const feeHeads = await mongo.fetchMany(db, "fee_heads", query, {}, { name: 1 });
    res.status(200).json({ success: true, data: feeHeads });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const createFeeHead = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const payload = { ...req.body, madrasa_id: req.user.madrasa_id, created_at: Date.now() };
    const result = await mongo.insertOne(db, "fee_heads", payload);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const updateFeeHead = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db, "fee_heads", 
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      { $set: { ...req.body, updated_at: Date.now() } }
    );
    if (!result) return res.status(404).json({ success: false, message: "Fee head not found" });
    res.status(200).json({ success: true, message: "Updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const deleteFeeHead = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { _id: req.params.id, madrasa_id: req.user.madrasa_id };
    const result = await mongo.deleteData(db, "fee_heads", query);
    if (!result) return res.status(404).json({ success: false, message: "Fee head not found" });
    
    // Also cleanup fee setups for this head
    await db.collection("fee_setups").deleteMany({ head_id: req.params.id, madrasa_id: req.user.madrasa_id });
    
    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// --- Fee Setups (Assignments) ---

const getFeeSetupsByHead = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { head_id: req.params.headId, madrasa_id: req.user.madrasa_id };
    const setups = await mongo.fetchMany(db, "fee_setups", query);
    res.status(200).json({ success: true, data: setups });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const bulkUpdateFeeSetups = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { head_id, fees } = req.body;
    const madrasa_id = req.user.madrasa_id;

    // We use a loop or bulk write to update/upsert each class amount
    for (const item of fees) {
      const query = { head_id, class_id: item.class_id, madrasa_id };
      await db.collection("fee_setups").updateOne(
        query,
        { $set: { amount: Number(item.amount), updated_at: Date.now() } },
        { upsert: true }
      );
    }

    res.status(200).json({ success: true, message: "Fee setups updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/heads", getAllFeeHeads);
router.post("/heads", validate(feeHeadSchema), createFeeHead);
router.put("/heads/:id", validate(feeHeadSchema), updateFeeHead);
router.delete("/heads/:id", deleteFeeHead);

router.get("/setups/:headId", getFeeSetupsByHead);
router.post("/setups/bulk", validate(bulkFeeSetupSchema), bulkUpdateFeeSetups);

module.exports = router;
