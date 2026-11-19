const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const homeworkSchema = Joi.object({
  class_id: Joi.string().required(),
  section_id: Joi.string().required(),
  subject_id: Joi.string().required(),
  teacher_id: Joi.string().required(),
  title: Joi.string().required(),
  description: Joi.string().allow(""),
  assignedDate: Joi.date().default(Date.now),
  dueDate: Joi.date().required(),
  attachment: Joi.string().allow("") // URL
});

// Get all homework
const getAllHomework = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.class_id) query.class_id = req.query.class_id;
    if (req.query.section_id) query.section_id = req.query.section_id;
    if (req.query.subject_id) query.subject_id = req.query.subject_id;
    if (req.query.teacher_id) query.teacher_id = req.query.teacher_id;
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const homework = await mongo.fetchMany(db, "homework", query, {}, { assignedDate: -1 }, limit, page);
    const total = await mongo.documentCount(db, "homework", query);
    res.status(200).json({ success: true, data: homework, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single homework by ID
const getHomeworkById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const homework = await mongo.fetchOne(db, "homework", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    if (!homework) {
      return res.status(404).json({ success: false, message: "Homework not found" });
    }
    res.status(200).json({ success: true, data: homework });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new homework
const createHomework = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const homeworkData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const homework = await mongo.insertOne(db, "homework", homeworkData);
    res.status(201).json({ success: true, data: homework });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update homework
const updateHomework = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "homework",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Homework not found" });
    }
    
    res.status(200).json({ success: true, message: "Homework updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete homework
const deleteHomework = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "homework", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Homework not found" });
    }
    
    res.status(200).json({ success: true, message: "Homework deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/homework", getAllHomework);
router.get("/homework/:id", getHomeworkById);
router.post("/homework", validate(homeworkSchema), createHomework);
router.put("/homework/:id", validate(homeworkSchema), updateHomework);
router.delete("/homework/:id", deleteHomework);

module.exports = router;
