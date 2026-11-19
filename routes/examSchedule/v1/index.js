const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

// Joi Schema
const scheduleSchema = Joi.object({
  exam_id: Joi.string().required(),
  class_id: Joi.string().required(),
  subject_id: Joi.string().required(),
  exam_date: Joi.date().required(),
  start_time: Joi.string().required(), // HH:mm
  end_time: Joi.string().required(),
  room_no: Joi.string().allow(""),
  full_marks: Joi.number().default(100),
  pass_marks: Joi.number().default(33)
});

// Get all exam schedules
const getAllSchedules = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.exam_id) query.exam_id = req.query.exam_id;
    if (req.query.class_id) query.class_id = req.query.class_id;
    if (req.query.subject_id) query.subject_id = req.query.subject_id;
    
    const schedules = await mongo.fetchMany(db, "exam_schedules", query);
    const total = await mongo.documentCount(db, "exam_schedules", query);
    res.status(200).json({ success: true, data: schedules, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single schedule by ID
const getScheduleById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const schedule = await mongo.fetchOne(db, "exam_schedules", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    if (!schedule) {
      return res.status(404).json({ success: false, message: "Schedule not found" });
    }
    res.status(200).json({ success: true, data: schedule });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new schedule
const createSchedule = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // Check duplication (same exam, same subject, same madrasa)
    const existing = await mongo.fetchOne(db, "exam_schedules", { 
        exam_id: req.body.exam_id, 
        subject_id: req.body.subject_id,
        madrasa_id: req.user.madrasa_id
    });
    
    if (existing) {
        return res.status(409).json({ success: false, message: "Schedule for this subject in this exam already exists" });
    }

    const scheduleData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const schedule = await mongo.insertOne(db, "exam_schedules", scheduleData);
    res.status(201).json({ success: true, data: schedule });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update schedule
const updateSchedule = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "exam_schedules",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Schedule not found" });
    }
    
    res.status(200).json({ success: true, message: "Schedule updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete schedule
const deleteSchedule = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "exam_schedules", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Schedule not found" });
    }
    
    res.status(200).json({ success: true, message: "Schedule deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/exam-schedules", getAllSchedules);
router.get("/exam-schedules/:id", getScheduleById);
router.post("/exam-schedules", validate(scheduleSchema), createSchedule);
router.put("/exam-schedules/:id", validate(scheduleSchema), updateSchedule);
router.delete("/exam-schedules/:id", deleteSchedule);

module.exports = router;
