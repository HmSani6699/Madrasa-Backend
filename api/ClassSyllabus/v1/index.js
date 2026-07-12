const router = require("express").Router();
const { ObjectId } = require("mongodb");
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Syllabus
const syllabusSchema = Joi.object({
  class_id: Joi.string().required(),
  subject_id: Joi.string().required(),
  description: Joi.string().allow(""),
  status: Joi.string().valid("active", "inactive").default("active"),
});

// Get all syllabuses
const getAllSyllabuses = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    const syllabuses = await mongo.fetchMany(db, "syllabuses", query, {}, { created_at: -1 });
    res.status(200).json({ success: true, data: syllabuses });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single syllabus by ID
const getSyllabusById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id };
    const syllabus = await mongo.fetchOne(db, "syllabuses", query);
    if (!syllabus) {
      return res.status(404).json({ success: false, message: "Syllabus not found" });
    }
    res.status(200).json({ success: true, data: syllabus });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new syllabus
const createSyllabus = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const syllabusData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const newSyllabus = await mongo.insertOne(db, "syllabuses", syllabusData);
    res.status(201).json({ success: true, data: newSyllabus });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update syllabus
const updateSyllabus = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "syllabuses",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Syllabus not found" });
    }
    
    res.status(200).json({ success: true, message: "Syllabus updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete syllabus
const deleteSyllabus = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "syllabuses", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Syllabus not found" });
    }
    
    res.status(200).json({ success: true, message: "Syllabus deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/syllabuses", getAllSyllabuses);
router.get("/syllabuses/:id", getSyllabusById);
router.post("/syllabuses", validate(syllabusSchema), createSyllabus);
router.put("/syllabuses/:id", validate(syllabusSchema), updateSyllabus);
router.delete("/syllabuses/:id", deleteSyllabus);

module.exports = router;
