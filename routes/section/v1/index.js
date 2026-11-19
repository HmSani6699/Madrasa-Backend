const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Section
const sectionSchema = Joi.object({
  name: Joi.string().required(),
  status: Joi.string().valid("active", "inactive").default("active"),
  class_id: Joi.string().allow(null, ""),
  capacity: Joi.number().allow(null, 0),
  roomNumber: Joi.string().allow(""),
  teacher_id: Joi.string().allow(null, ""), 
  subjects: Joi.array().items(Joi.string()).allow(null),
});

// Get all sections
const getAllSections = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.class_id) query.class_id = req.query.class_id;
    
    const sections = await mongo.fetchMany(db, "sections", query, {}, { name: 1 });
    const total = await mongo.documentCount(db, "sections", query);
    res.status(200).json({ success: true, data: sections, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single section by ID
const getSectionById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const section = await mongo.fetchOne(db, "sections", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }
    
    // Get class info
    if (section.class_id) {
      const classInfo = await mongo.fetchOne(db, "classes", { _id: new ObjectId(section.class_id), madrasa_id: req.user.madrasa_id });
      section.class = classInfo;
    }
    
    res.status(200).json({ success: true, data: section });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new section
const createSection = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const sectionData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const section = await mongo.insertOne(db, "sections", sectionData);
    res.status(201).json({ success: true, data: section });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update section
const updateSection = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "sections",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }
    
    res.status(200).json({ success: true, message: "Section updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete section
const deleteSection = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "sections", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }
    
    res.status(200).json({ success: true, message: "Section deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/sections", getAllSections);
router.get("/sections/:id", getSectionById);
router.post("/sections", validate(sectionSchema), createSection);
router.put("/sections/:id", validate(sectionSchema), updateSection);
router.delete("/sections/:id", deleteSection);

module.exports = router;
