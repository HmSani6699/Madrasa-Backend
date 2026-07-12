const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Subject Type
const subjectTypeSchema = Joi.object({
  name: Joi.string().required(),
  code: Joi.string().required(),
  status: Joi.string().valid("active", "inactive").default("active"),
});

// Get all subject types
const getAllSubjectTypes = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    
    // Add search functionality
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { code: { $regex: req.query.search, $options: "i" } }
      ];
    }
    
    // Add filters
    if (req.query.status) query.status = req.query.status;
    
    const subjectTypes = await mongo.fetchMany(db, "subjectTypes", query, {}, { name: 1 });
    const total = await mongo.documentCount(db, "subjectTypes", query);
    res.status(200).json({ success: true, data: subjectTypes, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single subject type by ID
const getSubjectTypeById = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const subjectType = await mongo.fetchOne(db, "subjectTypes", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    if (!subjectType) {
      return res.status(404).json({ success: false, message: "Subject Type not found" });
    }
    res.status(200).json({ success: true, data: subjectType });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new subject type
const createSubjectType = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const subjectTypeData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const subjectType = await mongo.insertOne(db, "subjectTypes", subjectTypeData);
    res.status(201).json({ success: true, data: subjectType });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update subject type
const updateSubjectType = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "subjectTypes",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Subject Type not found" });
    }
    
    res.status(200).json({ success: true, message: "Subject Type updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete subject type
const deleteSubjectType = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "subjectTypes", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Subject Type not found" });
    }
    
    res.status(200).json({ success: true, message: "Subject Type deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Routes
router.get("/", getAllSubjectTypes);
router.get("/:id", getSubjectTypeById);
router.post("/", validate(subjectTypeSchema), createSubjectType);
router.put("/:id", validate(subjectTypeSchema), updateSubjectType);
router.delete("/:id", deleteSubjectType);

module.exports = router;
