const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const validate = require(`${root}/middleware/validate`);

// Joi Schema for Salary Setup Payload
const salarySetupSchema = Joi.object({
  staff_id: Joi.string().required(),
  basic_salary: Joi.number().min(0).required(),
  house_rent: Joi.number().min(0).default(0),
  medical_allowance: Joi.number().min(0).default(0),
  transport_allowance: Joi.number().min(0).default(0),
  other_allowance: Joi.number().min(0).default(0),
  effective_from: Joi.date().required(),
  status: Joi.string().valid("active", "inactive").default("active")
});

// Create new salary setup
const createSalarySetup = async (req, res) => {
  const { db, client } = await mongoConnect();
  
  try {
    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    if (!madrasaId) {
      return res.status(403).json({ success: false, message: "Access denied. No madrasa associated." });
    }
    
    // Validate staff exists and belongs to same madrasa
    const staff = await mongo.fetchOne(db, "staff", { _id: new ObjectId(payload.staff_id) });
    if (!staff) {
      throw new Error("Staff not found");
    }
    
    if (req.user.role !== 'super_admin') {
      if (!staff.madrasa_id || staff.madrasa_id.toString() !== madrasaId.toString()) {
        throw new Error("Access denied. Staff belongs to different madrasa.");
      }
    }
    
    // Calculate total salary
    const total_salary = 
      parseFloat(payload.basic_salary || 0) +
      parseFloat(payload.house_rent || 0) +
      parseFloat(payload.medical_allowance || 0) +
      parseFloat(payload.transport_allowance || 0) +
      parseFloat(payload.other_allowance || 0);
    
    // Mark previous active setups as inactive
    await db.collection("salary_setups").updateMany(
      { 
        staff_id: new ObjectId(payload.staff_id),
        status: "active"
      },
      { 
        $set: { 
          status: "inactive",
          updated_at: Date.now()
        } 
      }
    );
    
    // Create new salary setup
    const salarySetupData = {
      madrasa_id: madrasaId,
      staff_id: new ObjectId(payload.staff_id),
      basic_salary: parseFloat(payload.basic_salary),
      house_rent: parseFloat(payload.house_rent || 0),
      medical_allowance: parseFloat(payload.medical_allowance || 0),
      transport_allowance: parseFloat(payload.transport_allowance || 0),
      other_allowance: parseFloat(payload.other_allowance || 0),
      total_salary: total_salary,
      effective_from: new Date(payload.effective_from),
      status: payload.status || "active",
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const newSetup = await db.collection("salary_setups").insertOne(salarySetupData);
    
    res.status(201).json({ 
      success: true, 
      message: "Salary setup created successfully",
      data: {
        setupId: newSetup.insertedId,
        total_salary: total_salary
      }
    });
    
  } catch (error) {
    console.error("Salary Setup Creation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get all salary setups
const getAllSalarySetups = async (req, res) => {
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
    
    if (req.query.staff_id) query.staff_id = new ObjectId(req.query.staff_id);
    if (req.query.status) query.status = req.query.status;
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    // Use aggregation to join with staff collection
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: "staff",
          localField: "staff_id",
          foreignField: "_id",
          as: "staff_info"
        }
      },
      { $unwind: { path: "$staff_info", preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } }
    ];
    
    if (page > 0 && limit > 0) {
      pipeline.push({ $skip: (page - 1) * limit });
      pipeline.push({ $limit: limit });
    }
    
    const setups = await db.collection("salary_setups").aggregate(pipeline).toArray();
    const total = await mongo.documentCount(db, "salary_setups", query);
    
    res.status(200).json({ success: true, data: setups, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single salary setup by ID
const getSalarySetupById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    const setup = await mongo.fetchOne(db, "salary_setups", { _id: req.params.id });
    if (!setup) {
      return res.status(404).json({ success: false, message: "Salary setup not found" });
    }
    
    // Multi-tenant validation (Super Admin can access all)
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !setup.madrasa_id || setup.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Salary setup belongs to different madrasa." });
      }
    }
    
    // Fetch staff info
    if (setup.staff_id) {
      const staff = await mongo.fetchOne(db, "staff", { _id: setup.staff_id });
      if (staff) setup.staff_info = staff;
    }
    
    res.status(200).json({ success: true, data: setup });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update salary setup
const updateSalarySetup = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check setup exists and belongs to same madrasa
    const existingSetup = await mongo.fetchOne(db, "salary_setups", { _id: req.params.id });
    if (!existingSetup) {
      return res.status(404).json({ success: false, message: "Salary setup not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingSetup.madrasa_id || existingSetup.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Salary setup belongs to different madrasa." });
      }
    }
    
    // Calculate total salary
    const total_salary = 
      parseFloat(payload.basic_salary || existingSetup.basic_salary) +
      parseFloat(payload.house_rent || existingSetup.house_rent) +
      parseFloat(payload.medical_allowance || existingSetup.medical_allowance) +
      parseFloat(payload.transport_allowance || existingSetup.transport_allowance) +
      parseFloat(payload.other_allowance || existingSetup.other_allowance);
    
    const updateFields = {
      basic_salary: parseFloat(payload.basic_salary || existingSetup.basic_salary),
      house_rent: parseFloat(payload.house_rent || existingSetup.house_rent),
      medical_allowance: parseFloat(payload.medical_allowance || existingSetup.medical_allowance),
      transport_allowance: parseFloat(payload.transport_allowance || existingSetup.transport_allowance),
      other_allowance: parseFloat(payload.other_allowance || existingSetup.other_allowance),
      total_salary: total_salary,
      effective_from: payload.effective_from ? new Date(payload.effective_from) : existingSetup.effective_from,
      status: payload.status || existingSetup.status,
      updated_at: Date.now()
    };
    
    const result = await mongo.updateData(
      db,
      "salary_setups",
      { _id: req.params.id },
      { $set: updateFields }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Salary setup not found" });
    }
    
    res.status(200).json({ success: true, message: "Salary setup updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete salary setup
const deleteSalarySetup = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check setup exists and belongs to same madrasa
    const existingSetup = await mongo.fetchOne(db, "salary_setups", { _id: req.params.id });
    if (!existingSetup) {
      return res.status(404).json({ success: false, message: "Salary setup not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingSetup.madrasa_id || existingSetup.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Salary setup belongs to different madrasa." });
      }
    }
    
    const result = await mongo.deleteData(db, "salary_setups", { _id: req.params.id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Salary setup not found" });
    }
    
    res.status(200).json({ success: true, message: "Salary setup deleted successfully" });
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

// Routes with RBAC (Admin only for create/update/delete)
router.get("/salary-setup", rbacMiddleware(['admin', 'super_admin']), getAllSalarySetups);
router.get("/salary-setup/:id", rbacMiddleware(['admin', 'super_admin']), getSalarySetupById);
router.post("/salary-setup", rbacMiddleware(['admin', 'super_admin']), validate(salarySetupSchema), createSalarySetup);
router.put("/salary-setup/:id", rbacMiddleware(['admin', 'super_admin']), validate(salarySetupSchema), updateSalarySetup);
router.delete("/salary-setup/:id", rbacMiddleware(['admin', 'super_admin']), deleteSalarySetup);

module.exports = router;
