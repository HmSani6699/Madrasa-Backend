const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const reportSchema = Joi.object({
  student_id: Joi.string().required(),
  exam_id: Joi.string().required(),
  class_id: Joi.string().required(),
  section_id: Joi.string().allow(""),
  subject_id: Joi.string().required(),
  marks_obtained: Joi.number().required(),
  total_marks: Joi.number().required(),
  grade: Joi.string().allow(""),
  remarks: Joi.string().allow(""),
  date: Joi.date().default(Date.now)
});

const buildLookupPipeline = (query, limit = 0, page = 0, sort = { date: -1 }) => {
  const pipeline = [
    { $match: query }
  ];
  if (Object.keys(sort).length > 0) pipeline.push({ $sort: sort });
  if (page > 0 && limit > 0) pipeline.push({ $skip: (page - 1) * limit });
  if (limit > 0) pipeline.push({ $limit: limit });

  pipeline.push(
    {
      $lookup: {
        from: "students",
        let: { sId: "$student_id" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$sId" }] } } },
          { $project: { name: 1, roll: 1 } }
        ],
        as: "student_info"
      }
    },
    {
      $lookup: {
        from: "classes",
        let: { cId: "$class_id" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$cId" }] } } },
          { $project: { name: 1 } }
        ],
        as: "class_info"
      }
    },
    {
      $lookup: {
        from: "sections",
        let: { secId: "$section_id" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$secId" }] } } },
          { $project: { name: 1 } }
        ],
        as: "section_info"
      }
    },
    {
      $lookup: {
        from: "subjects",
        let: { subId: "$subject_id" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$subId" }] } } },
          { $project: { name: 1 } }
        ],
        as: "subject_info"
      }
    },
    {
      $lookup: {
        from: "exam_names",
        let: { eId: "$exam_id" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$eId" }] } } },
          { $project: { name: 1 } }
        ],
        as: "exam_info"
      }
    },
    {
      $addFields: {
        student_id: { $cond: { if: { $gt: [{ $size: "$student_info" }, 0] }, then: { $arrayElemAt: ["$student_info", 0] }, else: "$student_id" } },
        class_id: { $cond: { if: { $gt: [{ $size: "$class_info" }, 0] }, then: { $arrayElemAt: ["$class_info", 0] }, else: "$class_id" } },
        section_id: { $cond: { if: { $gt: [{ $size: "$section_info" }, 0] }, then: { $arrayElemAt: ["$section_info", 0] }, else: "$section_id" } },
        subject_id: { $cond: { if: { $gt: [{ $size: "$subject_info" }, 0] }, then: { $arrayElemAt: ["$subject_info", 0] }, else: "$subject_id" } },
        exam_id: { $cond: { if: { $gt: [{ $size: "$exam_info" }, 0] }, then: { $arrayElemAt: ["$exam_info", 0] }, else: "$exam_id" } }
      }
    },
    {
      $project: {
        student_info: 0,
        class_info: 0,
        section_info: 0,
        subject_info: 0,
        exam_info: 0
      }
    }
  );
  return pipeline;
};

// Get all academic reports
const getAllReports = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.student_id) query.student_id = req.query.student_id;
    if (req.query.exam_id) query.exam_id = req.query.exam_id;
    if (req.query.subject_id) query.subject_id = req.query.subject_id;
    if (req.query.class_id) query.class_id = req.query.class_id;
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const pipeline = buildLookupPipeline(query, limit, page, { date: -1 });
    const reports = await db.collection("academic_reports").aggregate(pipeline).toArray();
    const total = await mongo.documentCount(db, "academic_reports", query);
    res.status(200).json({ success: true, data: reports, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single report by ID
const getReportById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { ObjectId } = require("mongodb");
    const query = { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id };
    const pipeline = buildLookupPipeline(query, 1, 0, {});
    const reports = await db.collection("academic_reports").aggregate(pipeline).toArray();
    
    if (!reports || reports.length === 0) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    res.status(200).json({ success: true, data: reports[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get student report card
const getStudentReportCard = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = {
      student_id: req.params.studentId,
      madrasa_id: req.user.madrasa_id
    };
    
    if (req.query.exam_id) query.exam_id = req.query.exam_id;
    
    const pipeline = buildLookupPipeline(query, 0, 0, { date: -1 });
    const reports = await db.collection("academic_reports").aggregate(pipeline).toArray();
    res.status(200).json({ success: true, data: reports });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new report
const createReport = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const reportData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const report = await mongo.insertOne(db, "academic_reports", reportData);
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update report
const updateReport = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "academic_reports",
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    
    res.status(200).json({ success: true, message: "Report updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete report
const deleteReport = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "academic_reports", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    
    res.status(200).json({ success: true, message: "Report deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/academic-reports", getAllReports);
router.get("/academic-reports/:id", getReportById);
router.get("/academic-reports/student/:studentId", getStudentReportCard);
router.post("/academic-reports", validate(reportSchema), createReport);
router.put("/academic-reports/:id", validate(reportSchema), updateReport);
router.delete("/academic-reports/:id", deleteReport);

module.exports = router;
