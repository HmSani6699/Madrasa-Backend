const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Class
const classSchema = Joi.object({
  name: Joi.string().required(),
  level: Joi.string().allow("Primary", "Secondary", "Higher Secondary"),
  section_id: Joi.string().allow(null, ""),
  students: Joi.number().allow(0),
  subjects: Joi.number().allow(0),
  tuitionFee: Joi.number().allow(null, 0),
  classTeacher_id: Joi.string().allow(null, ""), // ObjectId as string
  status: Joi.string().valid("active", "inactive").default("active"),
  description: Joi.string().allow(""),
  subjects_list: Joi.array().items(Joi.string()).allow(null),
});

// Get all classes
const getAllClasses = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id || null;
    const query = { madrasa_id: madrasaId };
    
    const classes = await mongo.fetchMany(db, "classes", query, {}, { name: 1 });
    const total = await mongo.documentCount(db, "classes", query);
    
    res.status(200).json({ 
      success: true, 
      data: Array.isArray(classes) ? classes : [], 
      total: total || 0 
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection managed by singleton
  }
};

// Get single class by ID
const getClassById = async (req, res) => {
  console.log(`[GET] /classes/${req.params.id} hit`);
  const { db, client } = await mongoConnect();
  try {
    const query = { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id };
    const classData = await mongo.fetchOne(db, "classes", query);
    if (!classData) {
      return res.status(404).json({ success: false, message: "Class not found" });
    }
    
    // Get sections for this class
    const sections = await mongo.fetchMany(db, "sections", { class_id: req.params.id, madrasa_id: req.user.madrasa_id });
    classData.sections = sections;
    
    res.status(200).json({ success: true, data: classData });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new class
const createClass = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const classData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    // Check if section_id is present
    const section_id = req.body.section_id;
    
    const newClass = await mongo.insertOne(db, "classes", classData);

    // Update the section to link to this class
    if (newClass && section_id) {
       await mongo.updateData(db, "sections", { _id: new ObjectId(section_id) }, { $set: { class_id: newClass._id.toString() } });
    }

    res.status(201).json({ success: true, data: newClass });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update class
const updateClass = async (req, res) => {
  console.log(`[PUT] /classes/${req.params.id} hit`);
  const { db, client } = await mongoConnect();
  try {
    // Get old class data to see if section changed
    const oldClass = await mongo.fetchOne(db, "classes", { _id: new ObjectId(req.params.id) });
    const oldSectionId = oldClass ? oldClass.section_id : null;
    const newSectionId = req.body.section_id;

    const result = await mongo.updateData(
      db,
      "classes",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Class not found" });
    }

    // Handle section re-linking
    if (oldSectionId !== newSectionId) {
        // Clear old section
        if (oldSectionId) {
            await mongo.updateData(db, "sections", { _id: new ObjectId(oldSectionId) }, { $set: { class_id: "" } });
        }
        // Link new section
        if (newSectionId) {
            await mongo.updateData(db, "sections", { _id: new ObjectId(newSectionId) }, { $set: { class_id: req.params.id } });
        }
    }
    
    res.status(200).json({ success: true, message: "Class updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete class
const deleteClass = async (req, res) => {
  console.log(`[DELETE] /classes/${req.params.id} hit`);
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "classes", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Class not found" });
    }
    
    res.status(200).json({ success: true, message: "Class deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/classes", getAllClasses);
router.get("/classes/:id", getClassById);
router.post("/classes", validate(classSchema), createClass);
router.put("/classes/:id", validate(classSchema), updateClass);
router.delete("/classes/:id", deleteClass);

module.exports = router;
