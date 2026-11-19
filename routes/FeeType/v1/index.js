const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

// Joi Schemas
const feeTypeSchema = Joi.object({
  name: Joi.string().required(),
  pay_type: Joi.string().valid("On Time", "Monthly", "Annual").required(),
  status: Joi.string().valid("active", "inactive").default("active")
});

// --- Fee Type CRUD ---

const getAllFeeTypes = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    const feeTypes = await mongo.fetchMany(db, "fee_types", query, {}, { created_at: -1 });
    res.status(200).json({ success: true, data: feeTypes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const createFeeType = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const payload = { 
      ...req.body, 
      madrasa_id: req.user.madrasa_id, 
      created_at: Date.now(),
      status: req.body.status || "active"
    };
    const result = await mongo.insertOne(db, "fee_types", payload);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const updateFeeType = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db, "fee_types", 
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      { $set: { ...req.body, updated_at: Date.now() } }
    );
    if (!result) return res.status(404).json({ success: false, message: "Fee type not found" });
    res.status(200).json({ success: true, message: "Updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

const deleteFeeType = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { _id: req.params.id, madrasa_id: req.user.madrasa_id };
    const result = await mongo.deleteData(db, "fee_types", query);
    if (!result) return res.status(404).json({ success: false, message: "Fee type not found" });
    
    res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/", getAllFeeTypes);
router.post("/", validate(feeTypeSchema), createFeeType);
router.put("/:id", validate(feeTypeSchema), updateFeeType);
router.delete("/:id", deleteFeeType);

module.exports = router;
