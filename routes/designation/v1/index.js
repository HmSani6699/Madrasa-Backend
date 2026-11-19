const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

// Get all designations
const getAllDesignations = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    const query = {};
    
    // Multi-tenant filtering (Super Admin can see all)
    if (req.user.role !== 'super_admin') {
      if (!madrasaId) {
        return res.status(403).json({ success: false, message: "Access denied. No madrasa associated." });
      }
      query.madrasa_id = madrasaId;
    }
    
    if (req.query.department) query.department = req.query.department;

    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const designations = await mongo.fetchMany(db, "designations", query, {}, { title: 1 }, limit, page);
    const total = await mongo.documentCount(db, "designations", query);
    
    res.status(200).json({ success: true, data: designations, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single designation by ID
const getDesignationById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    const designation = await mongo.fetchOne(db, "designations", { _id: new ObjectId(req.params.id) });
    if (!designation) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    
    // Multi-tenant validation (Super Admin can access all)
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !designation.madrasa_id || designation.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Designation belongs to different madrasa." });
      }
    }
    
    res.status(200).json({ success: true, data: designation });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new designation
const createDesignation = async (req, res) => {
  const { db, client } = await mongoConnect();

  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    if (!madrasaId) {
      return res.status(403).json({ success: false, message: "Access denied. No madrasa associated." });
    }
    
    const designationData = {
      ...req.body,
      madrasa_id: madrasaId,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const designation = await mongo.insertOne(db, "designations", designationData);
    res.status(201).json({ success: true, data: designation });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update designation
const updateDesignation = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check designation exists and belongs to same madrasa
    const existingDesignation = await mongo.fetchOne(db, "designations", { _id: new ObjectId(req.params.id) });
    if (!existingDesignation) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingDesignation.madrasa_id || existingDesignation.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Designation belongs to different madrasa." });
      }
    }
    
    const result = await mongo.updateData(
      db,
      "designations",
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    
    res.status(200).json({ success: true, message: "Designation updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete designation
const deleteDesignation = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check designation exists and belongs to same madrasa
    const existingDesignation = await mongo.fetchOne(db, "designations", { _id: new ObjectId(req.params.id) });
    if (!existingDesignation) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingDesignation.madrasa_id || existingDesignation.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Designation belongs to different madrasa." });
      }
    }
    
    const result = await mongo.deleteData(db, "designations", { _id: new ObjectId(req.params.id) });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Designation not found" });
    }
    
    res.status(200).json({ success: true, message: "Designation deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Apply middleware to all routes
router.use(authMiddleware); // Authenticate first
router.use(tenantMiddleware); // Check Tenant

// Routes with RBAC
router.get("/designations", rbacMiddleware(['admin', 'super_admin', 'teacher', 'staff']), getAllDesignations);
router.get("/designations/:id", rbacMiddleware(['admin', 'super_admin', 'teacher', 'staff']), getDesignationById);
router.post("/designations", rbacMiddleware(['admin', 'super_admin']), createDesignation);
router.put("/designations/:id", rbacMiddleware(['admin', 'super_admin']), updateDesignation);
router.delete("/designations/:id", rbacMiddleware(['admin', 'super_admin']), deleteDesignation);

module.exports = router;
