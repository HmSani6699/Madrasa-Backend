const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Parent (Guardian)
const parentSchema = Joi.object({
  fatherName: Joi.string().required(),
  motherName: Joi.string().required(),
  fatherOccupation: Joi.string().allow(""),
  motherOccupation: Joi.string().allow(""),
  contact: Joi.string().required(),
  motherContact: Joi.string().allow(""),
  email: Joi.string().email().allow(""),
  address: Joi.string().required(),
  
  // Documents / Photos
  fatherPhoto: Joi.string().allow(""),
  motherPhoto: Joi.string().allow(""),
  guardianNID: Joi.string().allow("")
});

// Update Schema (all optional)
const parentUpdateSchema = parentSchema.fork(
    Object.keys(parentSchema.describe().keys),
    (schema) => schema.optional()
);


// Get all parents with search
const getAllParents = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const matchQuery = { madrasa_id: req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null };
    if (req.query.search) {
      matchQuery.$or = [
        { fatherName: { $regex: req.query.search, $options: 'i' } },
        { motherName: { $regex: req.query.search, $options: 'i' } },
        { contact: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Use aggregation to count children (students linked to this guardian)
    const pipeline = [
      { $match: matchQuery },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "students",     
          localField: "_id",
          foreignField: "guardian_id", 
          as: "children"
        }
      },
      {
        $addFields: {
          childrenCount: { $size: "$children" }
        }
      }
    ];

    const parents = await db.collection("parents").aggregate(pipeline).toArray();
    const total = await mongo.documentCount(db, "parents", matchQuery);
    
    res.status(200).json({ success: true, data: parents, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await client.close();
  }
};

// Get single parent by ID
const getParentById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const parent = await mongo.fetchOne(db, "parents", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    if (!parent) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }
    res.status(200).json({ success: true, data: parent });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get parent's children
const getParentStudents = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Parent ID format" });
    }
    // using guardian_id as per student schema
    const students = await mongo.fetchMany(db, "students", { 
        guardian_id: new ObjectId(req.params.id),
        madrasa_id: req.user.madrasa_id 
    });
    res.status(200).json({ success: true, data: students });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new parent
const createParent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // Check for duplicate contact within same madrasa
    const existing = await mongo.fetchOne(db, "parents", { 
        contact: req.body.contact,
        madrasa_id: req.user.madrasa_id
    });
    if (existing) {
        return res.status(409).json({ success: false, message: "Guardian with this contact already exists" });
    }

    const parentData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const parent = await mongo.insertOne(db, "parents", parentData);
    res.status(201).json({ success: true, data: parent });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update parent
const updateParent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const payload = { ...req.body };
    payload.updated_at = Date.now();
    if (payload.madrasa_id) payload.madrasa_id = new ObjectId(payload.madrasa_id);

    const result = await mongo.updateData(
      db,
      "parents",
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      { $set: payload }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }
    
    res.status(200).json({ success: true, message: "Parent updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete parent
const deleteParent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // Optional: Check if parent has students before deleting?
    // For now, allow delete.
    
    const result = await mongo.deleteData(db, "parents", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }
    
    res.status(200).json({ success: true, message: "Parent deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/parents", getAllParents);
router.get("/parents/:id", getParentById);
router.get("/parents/:id/students", getParentStudents);
router.post("/parents", validate(parentSchema), createParent);
router.put("/parents/:id", validate(parentUpdateSchema), updateParent);
router.delete("/parents/:id", deleteParent);

module.exports = router;
