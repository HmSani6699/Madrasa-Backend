const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const examSchema = Joi.object({
  exam_name_id: Joi.string().required(), // e.g., "Final Term" ID
  class_id: Joi.string().required(),
  academic_year: Joi.string().required(),
  start_date: Joi.date().required(),
  end_date: Joi.date().min(Joi.ref('start_date')).required(),
  status: Joi.string().valid("Scheduled", "Ongoing", "Completed", "Cancelled").default("Scheduled"),
  remarks: Joi.string().allow("")
});

// Get all exams
const getAllExams = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.exam_name_id) query.exam_name_id = req.query.exam_name_id;
    if (req.query.class_id) query.class_id = req.query.class_id;
    if (req.query.academic_year) query.academic_year = req.query.academic_year;
    
    const exams = await mongo.fetchMany(db, "exams", query, {}, { start_date: -1 });
    const total = await mongo.documentCount(db, "exams", query);
    res.status(200).json({ success: true, data: exams, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single exam by ID
const getExamById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const exam = await mongo.fetchOne(db, "exams", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    if (!exam) {
      return res.status(404).json({ success: false, message: "Exam not found" });
    }
    
    // Get exam name details
    if (exam.exam_name_id) {
      const examName = await mongo.fetchOne(db, "exam_names", { _id: exam.exam_name_id, madrasa_id: req.user.madrasa_id });
      exam.exam_name = examName;
    }
    
    res.status(200).json({ success: true, data: exam });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new exam
const createExam = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const examData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const exam = await mongo.insertOne(db, "exams", examData);
    res.status(201).json({ success: true, data: exam });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update exam
const updateExam = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "exams",
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Exam not found" });
    }
    
    res.status(200).json({ success: true, message: "Exam updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete exam
const deleteExam = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "exams", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Exam not found" });
    }
    
    res.status(200).json({ success: true, message: "Exam deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/exams", getAllExams);
router.get("/exams/:id", getExamById);
router.post("/exams", validate(examSchema), createExam);
router.put("/exams/:id", validate(examSchema), updateExam);
router.delete("/exams/:id", deleteExam);

module.exports = router;
