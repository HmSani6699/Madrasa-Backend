const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const authService = require(`${root}/services/auth.service`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Staff Payload
const staffSchema = Joi.object({
  // Academic/Job Details
  employeeID: Joi.string().required(),
  role: Joi.string().required(),
  joinDate: Joi.date().required(),
  designation: Joi.string().required(),
  department: Joi.string(),
  qualification: Joi.string().allow(""),
  totalExperience: Joi.string().allow(""),

  // Personal Details
  name: Joi.string().required(),
  gender: Joi.string().valid("Male", "Female", "Other").required(),
  bloodGroup: Joi.string().allow(""),
  dob: Joi.date().allow(""),
  phone: Joi.string().required(),
  email: Joi.string().email().allow(""),
  address: Joi.string().required(),
  photo: Joi.string().allow(null, ""),

  // Login Details
  password: Joi.string().min(6).optional(), // Optional for updates
  confirmPassword: Joi.string().valid(Joi.ref('password')).optional(),

  // Social Links
  facebook: Joi.string().allow(""),
  twitter: Joi.string().allow(""),
  linkedin: Joi.string().allow(""),

  // Bank & Payment Details
  paymentMethod: Joi.string().valid("Bank", "Mobile Banking", "None").required(),
  bankName: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("") }),
  holderName: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("") }),
  bankBranch: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("") }),
  bankAddress: Joi.string().allow(""),
  ifscCode: Joi.string().allow(""),
  accountNo: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("") }),
  mobileMethods: Joi.array().items(Joi.string()).when('paymentMethod', { is: 'Mobile Banking', then: Joi.required(), otherwise: Joi.allow(null) }),
  mobileNumber: Joi.string().when('paymentMethod', { is: 'Mobile Banking', then: Joi.required(), otherwise: Joi.allow("") }),
  
  // Frontend might wrap bank details in an object, but schema seems flat or mixed. 
  // Let's adjust based on CreateEmployee payload structure:
  // payload = { ...formData, paymentMethod, bankDetails: { ... } }
  bankDetails: Joi.object({
      bankName: Joi.string().allow(""),
      holderName: Joi.string().allow(""),
      bankBranch: Joi.string().allow(""),
      bankAddress: Joi.string().allow(""),
      ifscCode: Joi.string().allow(""),
      accountNo: Joi.string().allow("")
  }).optional()
});

// Create new staff
const createStaff = async (req, res) => {
  let client, db;
  try {
    const connection = await mongoConnect();
    db = connection.db;
    client = connection.client;
    
    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

    // 1. Create User Identity (if email provided)
    let userId = null;
    if (payload.email && payload.password) {
        // Check if user exists
        const existingUser = await db.collection("users").findOne({ email: payload.email });
        if (existingUser) {
            throw new Error("User with this email already exists");
        }

        const hashedPassword = await authService.hashPassword(payload.password);
        const newUser = await db.collection("users").insertOne({
            email: payload.email,
            password: hashedPassword,
            role: payload.role.toLowerCase(), // teacher, staff, accountant
            username: payload.name.replace(/\s+/g, '').toLowerCase() + Math.floor(Math.random() * 1000),
            madrasa_id: madrasaId,
            reference_id: null, // Will update after creating staff profile
            created_at: Date.now(),
            updated_at: Date.now()
        });
        
        userId = newUser.insertedId;
    }

    // 2. Create Staff Profile
    const staffData = {
        employeeID: payload.employeeID,
        userId: userId,
        madrasa_id: madrasaId,
        name: payload.name,
        role: payload.role,
        designation: payload.designation,
        department: payload.department,
        joinDate: payload.joinDate,
        qualification: payload.qualification,
        totalExperience: payload.totalExperience,
        gender: payload.gender,
        bloodGroup: payload.bloodGroup,
        dob: payload.dob,
        phone: payload.phone,
        address: payload.address,
        photo: payload.photo,
        socialLinks: {
            facebook: payload.facebook,
            twitter: payload.twitter,
            linkedin: payload.linkedin
        },
        paymentDetails: {
            method: payload.paymentMethod,
            bankName: payload.bankDetails?.bankName || payload.bankName,
            holderName: payload.bankDetails?.holderName || payload.holderName,
            branch: payload.bankDetails?.bankBranch || payload.bankBranch,
            address: payload.bankDetails?.bankAddress || payload.bankAddress,
            ifsc: payload.bankDetails?.ifscCode || payload.ifscCode,
            accountNo: payload.bankDetails?.accountNo || payload.accountNo,
            mobileMethods: payload.mobileMethods,
            mobileNumber: payload.mobileNumber
        },
        status: "Active",
        created_at: Date.now(),
        updated_at: Date.now()
    };

    const newStaff = await db.collection("staff").insertOne(staffData);
    
    // Update user with reference_id if user was created
    if (userId) {
        await db.collection("users").updateOne(
            { _id: userId },
            { $set: { reference_id: newStaff.insertedId } }
        );
    }
    
    res.status(201).json({ 
        success: true, 
        message: "Staff created successfully",
        data: {
            staffId: newStaff.insertedId,
            userId: userId
        }
    });

  } catch (error) {
    console.error("Staff Creation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (client) {
        // await client.close();
    }
  }
};

// Update staff
const updateStaff = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check staff exists and belongs to same madrasa
    const existingStaff = await mongo.fetchOne(db, "staff", { _id: req.params.id });
    if (!existingStaff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingStaff.madrasa_id || existingStaff.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
      }
    }
    
    // Prepare update object
    const updateFields = {
        employeeID: payload.employeeID,
        name: payload.name,
        role: payload.role,
        designation: payload.designation,
        department: payload.department,
        qualification: payload.qualification,
        totalExperience: payload.totalExperience,
        gender: payload.gender,
        bloodGroup: payload.bloodGroup,
        dob: payload.dob,
        phone: payload.phone,
        address: payload.address,
        photo: payload.photo,
        socialLinks: {
            facebook: payload.facebook,
            twitter: payload.twitter,
            linkedin: payload.linkedin
        },
        paymentDetails: {
            method: payload.paymentMethod,
            bankName: payload.bankDetails?.bankName || payload.bankName,
            holderName: payload.bankDetails?.holderName || payload.holderName,
            branch: payload.bankDetails?.bankBranch || payload.bankBranch,
            address: payload.bankDetails?.bankAddress || payload.bankAddress,
            ifsc: payload.bankDetails?.ifscCode || payload.ifscCode,
            accountNo: payload.bankDetails?.accountNo || payload.accountNo,
            mobileMethods: payload.mobileMethods,
            mobileNumber: payload.mobileNumber
        },
        updated_at: Date.now()
    };

    // If password provided in update, update User collection (omitted for brevity, can be added later)

    const result = await mongo.updateData(
      db,
      "staff",
      { _id: req.params.id },
      { $set: updateFields }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    
    res.status(200).json({ success: true, message: "Staff updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get all staff
const getAllStaff = async (req, res) => {
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
      
      if (req.query.role) query.role = req.query.role;
      if (req.query.department) query.department = req.query.department;
      if (req.query.status) query.status = req.query.status;
  
      const page = parseInt(req.query.page) || 0;
      const limit = parseInt(req.query.limit) || 0;
      
      const staff = await mongo.fetchMany(db, "staff", query, {}, { created_at: -1 }, limit, page);
      const total = await mongo.documentCount(db, "staff", query);
      
      res.status(200).json({ success: true, data: staff, total });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
};

// Get single staff by ID
const getStaffById = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
      const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
      
      const staff = await mongo.fetchOne(db, "staff", { _id: req.params.id });
      if (!staff) {
        return res.status(404).json({ success: false, message: "Staff not found" });
      }
      
      // Multi-tenant validation (Super Admin can access all)
      if (req.user.role !== 'super_admin') {
        if (!madrasaId || !staff.madrasa_id || staff.madrasa_id.toString() !== madrasaId.toString()) {
          return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
        }
      }
      
      // Fetch user email if linked
      if (staff.userId) {
          const user = await mongo.fetchOne(db, "users", { _id: staff.userId });
          if(user) staff.userId = user; // Embed user object or just email
      }
      
      res.status(200).json({ success: true, data: staff });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
};

// Delete staff
const deleteStaff = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
      const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
      
      // Multi-tenant validation - check staff exists and belongs to same madrasa
      const existingStaff = await mongo.fetchOne(db, "staff", { _id: req.params.id });
      if (!existingStaff) {
        return res.status(404).json({ success: false, message: "Staff not found" });
      }
      
      if (req.user.role !== 'super_admin') {
        if (!madrasaId || !existingStaff.madrasa_id || existingStaff.madrasa_id.toString() !== madrasaId.toString()) {
          return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
        }
      }
      
      const result = await mongo.deleteData(db, "staff", { _id: req.params.id });
      
      if (!result) {
        return res.status(404).json({ success: false, message: "Staff not found" });
      }
      
      res.status(200).json({ success: true, message: "Staff deleted successfully" });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
};

// Routes with Middleware
router.use(authMiddleware); // Authenticate first
router.use(tenantMiddleware); // Check Tenant

router.get("/staff", rbacMiddleware(['admin', 'super_admin', 'teacher', 'staff']), getAllStaff);
router.get("/staff/:id", rbacMiddleware(['admin', 'super_admin', 'teacher', 'staff']), getStaffById);
router.post("/staff", rbacMiddleware(['admin', 'super_admin']), validate(staffSchema), createStaff);
router.put("/staff/:id", rbacMiddleware(['admin', 'super_admin']), validate(staffSchema), updateStaff);
router.delete("/staff/:id", rbacMiddleware(['admin', 'super_admin']), deleteStaff);

module.exports = router;
