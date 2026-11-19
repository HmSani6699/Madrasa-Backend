const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const { ObjectId } = require("mongodb");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const resultSchema = Joi.object({
  student_id: Joi.string().required(),
  exam_id: Joi.string().required(),
  subject_id: Joi.string().required(),
  class_id: Joi.string().required(),
  marks_obtained: Joi.number().min(0).required(),
  total_marks: Joi.number().min(Joi.ref('marks_obtained')).required(),
  grade_id: Joi.string().optional(), // Can be auto-calculated? Use optional if done by backend
  remarks: Joi.string().allow("")
});

// Get all results
const getAllResults = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.student_id) query.student_id = req.query.student_id;
    if (req.query.exam_id) query.exam_id = req.query.exam_id;
    if (req.query.subject_id) query.subject_id = req.query.subject_id;
    if (req.query.class_id) query.class_id = req.query.class_id;
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const results = await mongo.fetchMany(db, "results", query, {}, { created_at: -1 }, limit, page);
    const total = await mongo.documentCount(db, "results", query);
    res.status(200).json({ success: true, data: results, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single result by ID
const getResultById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.fetchOne(db, "results", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    if (!result) {
      return res.status(404).json({ success: false, message: "Result not found" });
    }
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get student results
const getStudentResults = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = {
      student_id: req.params.studentId,
      madrasa_id: req.user.madrasa_id
    };
    
    if (req.query.exam_id) query.exam_id = req.query.exam_id;
    
    const results = await mongo.fetchMany(db, "results", query, {}, { created_at: -1 });
    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new result
const createResult = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // Check duplicates
    const existing = await mongo.fetchOne(db, "results", {
        student_id: req.body.student_id,
        exam_id: req.body.exam_id,
        subject_id: req.body.subject_id,
        madrasa_id: req.user.madrasa_id
    });
    
    if (existing) {
        return res.status(409).json({ success: false, message: "Result already exists for this student/subject/exam" });
    }

    const resultData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const result = await mongo.insertOne(db, "results", resultData);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update result
const updateResult = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "results",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Result not found" });
    }
    
    res.status(200).json({ success: true, message: "Result updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete result
const deleteResult = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "results", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Result not found" });
    }
    
    res.status(200).json({ success: true, message: "Result deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/results", getAllResults);
router.get("/results/:id", getResultById);
router.get("/results/student/:studentId", getStudentResults);
router.post("/results", validate(resultSchema), createResult);
router.put("/results/:id", validate(resultSchema), updateResult);
router.delete("/results/:id", deleteResult);

module.exports = router;
