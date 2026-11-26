const router = require("express").Router();
const root = process.cwd();
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const authService = require(`${root}/services/auth.service`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Helper to safely parse MongoDB ObjectId
const parseObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// Helper to verify tenant ownership
const hasTenantAccess = (req, staffDoc) => {
  if (req.user.role === "super_admin") return true;
  const madrasaId = req.user.madrasa_id ? req.user.madrasa_id.toString() : null;
  return Boolean(madrasaId && staffDoc.madrasa_id && staffDoc.madrasa_id.toString() === madrasaId);
};

// Joi Schema for Staff Payload
const staffSchema = Joi.object({
  // Academic/Job Details
  employeeID: Joi.string().required(),
  role: Joi.string().required(),
  joinDate: Joi.date().required(),
  designation: Joi.string().required(),
  department: Joi.string().allow("", null),
  qualification: Joi.string().allow("", null),
  totalExperience: Joi.string().allow("", null),

  // Personal Details
  name: Joi.string().required(),
  gender: Joi.string().valid("Male", "Female", "Other").required(),
  bloodGroup: Joi.string().allow("", null),
  dob: Joi.date().allow("", null),
  phone: Joi.string().required(),
  email: Joi.string().email().allow("", null),
  address: Joi.string().required(),
  photo: Joi.string().allow(null, ""),

  // Login Details
  password: Joi.string().min(6).allow("", null).optional(), // Optional for updates
  confirmPassword: Joi.when("password", {
    is: Joi.string().min(1),
    then: Joi.string().valid(Joi.ref("password")).required(),
    otherwise: Joi.string().allow("", null).optional()
  }),

  // Social Links
  facebook: Joi.string().allow("", null),
  twitter: Joi.string().allow("", null),
  linkedin: Joi.string().allow("", null),

  // Salary & Compensation (Optional)
  basic_salary: Joi.number().min(0).allow(null, ""),
  house_rent: Joi.number().min(0).allow(null, ""),
  medical_allowance: Joi.number().min(0).allow(null, ""),
  transport_allowance: Joi.number().min(0).allow(null, ""),
  other_allowance: Joi.number().min(0).allow(null, ""),

  status: Joi.string().valid("Active", "Inactive", "active", "inactive").optional(),

  // Bank & Payment Details
  paymentMethod: Joi.string().valid("Bank", "Mobile Banking", "None").required(),
  bankName: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("", null) }),
  holderName: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("", null) }),
  bankBranch: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("", null) }),
  bankAddress: Joi.string().allow("", null),
  ifscCode: Joi.string().allow("", null),
  accountNo: Joi.string().when('paymentMethod', { is: 'Bank', then: Joi.required(), otherwise: Joi.allow("", null) }),
  mobileMethods: Joi.array().items(Joi.string()).when('paymentMethod', { is: 'Mobile Banking', then: Joi.required(), otherwise: Joi.allow(null) }),
  mobileNumber: Joi.string().when('paymentMethod', { is: 'Mobile Banking', then: Joi.required(), otherwise: Joi.allow("", null) }),

  bankDetails: Joi.object({
    bankName: Joi.string().allow("", null),
    holderName: Joi.string().allow("", null),
    bankBranch: Joi.string().allow("", null),
    bankAddress: Joi.string().allow("", null),
    ifscCode: Joi.string().allow("", null),
    accountNo: Joi.string().allow("", null)
  }).optional()
});

// Create or sync a staff member's login account in `users`
const syncStaffUserAccount = async (db, { existingStaff = null, payload, madrasaId }) => {
  const trimmedEmail = (payload.email || "").trim();
  const trimmedPhone = (payload.phone || "").trim();
  const trimmedPassword = (payload.password || "").trim();
  const normalizedRole = (payload.role || "").trim().toLowerCase();

  const existingUserId = existingStaff?.userId
    ? (parseObjectId(existingStaff.userId) || existingStaff.userId)
    : null;

  if (existingUserId) {
    const userUpdate = {
      role: normalizedRole,
      updated_at: Date.now()
    };

    if (trimmedPassword.length > 0) {
      userUpdate.password = await authService.hashPassword(trimmedPassword);
    }

    if (trimmedEmail) {
      const duplicateEmail = await db.collection("users").findOne({
        email: trimmedEmail,
        _id: { $ne: existingUserId }
      });
      if (duplicateEmail) {
        return { errorStatus: 400, message: "User with this email already exists" };
      }
      userUpdate.email = trimmedEmail;
    }

    if (trimmedPhone) {
      userUpdate.phone = trimmedPhone;
      const duplicateUsername = await db.collection("users").findOne({
        username: trimmedPhone,
        _id: { $ne: existingUserId }
      });
      if (!duplicateUsername) {
        userUpdate.username = trimmedPhone;
      } else if (!trimmedEmail) {
        return { errorStatus: 400, message: "User with this phone number already exists" };
      }
    }

    await db.collection("users").updateOne({ _id: existingUserId }, { $set: userUpdate });
    return { userId: existingUserId };
  }

  if (!trimmedPassword || (!trimmedEmail && !trimmedPhone)) {
    return { userId: null };
  }

  if (trimmedEmail) {
    const existingEmailUser = await db.collection("users").findOne({ email: trimmedEmail });
    if (existingEmailUser) {
      return { errorStatus: 400, message: "User with this email already exists" };
    }
  }

  const existingPhoneUser = trimmedPhone
    ? await db.collection("users").findOne({ username: trimmedPhone })
    : null;
  if (existingPhoneUser && !trimmedEmail) {
    return { errorStatus: 400, message: "User with this phone number already exists" };
  }

  const fallbackUsername =
    (payload.name || "staff").replace(/\s+/g, "").toLowerCase() +
    Math.floor(Math.random() * 1000);
  const username = !existingPhoneUser && trimmedPhone ? trimmedPhone : fallbackUsername;
  const hashedPassword = await authService.hashPassword(trimmedPassword);

  const newUser = await db.collection("users").insertOne({
    email: trimmedEmail,
    phone: trimmedPhone,
    password: hashedPassword,
    role: normalizedRole,
    username,
    madrasa_id: madrasaId,
    reference_id: existingStaff?._id || null,
    created_at: Date.now(),
    updated_at: Date.now()
  });

  return { userId: newUser.insertedId };
};

// Create new staff
const createStaff = async (req, res) => {
  let client, db;
  try {
    const connection = await mongoConnect();
    db = connection.db;
    client = connection.client;

    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

    // 1. Create User Identity (using email and/or phone when password is provided)
    const userSync = await syncStaffUserAccount(db, { payload, madrasaId });
    if (userSync.errorStatus) {
      return res.status(userSync.errorStatus).json({ success: false, message: userSync.message });
    }
    const userId = userSync.userId;

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
      email: (payload.email || "").trim(),
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

    // 3. Optional: Create Salary Setup if basic_salary is provided
    await upsertSalarySetup(db, madrasaId, newStaff.insertedId, payload);

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

// Helper to create or update active salary setup for a staff member
const upsertSalarySetup = async (db, madrasaId, staffId, payload) => {
  const basicSalary = parseFloat(payload.basic_salary);
  if (isNaN(basicSalary) || basicSalary <= 0) return;

  const houseRent = parseFloat(payload.house_rent || 0);
  const medicalAllowance = parseFloat(payload.medical_allowance || 0);
  const transportAllowance = parseFloat(payload.transport_allowance || 0);
  const otherAllowance = parseFloat(payload.other_allowance || 0);
  const totalSalary = basicSalary + houseRent + medicalAllowance + transportAllowance + otherAllowance;

  const existingSetup = await db.collection("salary_setups").findOne({
    staff_id: staffId,
    status: "active"
  });

  if (existingSetup) {
    await db.collection("salary_setups").updateOne(
      { _id: existingSetup._id },
      {
        $set: {
          basic_salary: basicSalary,
          house_rent: houseRent,
          medical_allowance: medicalAllowance,
          transport_allowance: transportAllowance,
          other_allowance: otherAllowance,
          total_salary: totalSalary,
          updated_at: Date.now()
        }
      }
    );
  } else {
    await db.collection("salary_setups").insertOne({
      madrasa_id: madrasaId,
      staff_id: staffId,
      basic_salary: basicSalary,
      house_rent: houseRent,
      medical_allowance: medicalAllowance,
      transport_allowance: transportAllowance,
      other_allowance: otherAllowance,
      total_salary: totalSalary,
      effective_from: payload.joinDate ? new Date(payload.joinDate) : new Date(),
      status: "active",
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }

  const existingLedger = await db.collection("payroll_ledgers").findOne({ staff_id: staffId });
  if (!existingLedger) {
    await db.collection("payroll_ledgers").insertOne({
      staff_id: staffId,
      madrasa_id: madrasaId,
      balance: 0,
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }
};

// Update staff
const updateStaff = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const staffId = parseObjectId(req.params.id);
    if (!staffId) {
      return res.status(400).json({ success: false, message: "Invalid staff ID" });
    }

    const payload = req.body;
    const existingStaff = await mongo.fetchOne(db, "staff", { _id: staffId });
    if (!existingStaff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    if (!hasTenantAccess(req, existingStaff)) {
      return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
    }

    // Prepare update object
    const updateFields = {
      employeeID: payload.employeeID,
      name: payload.name,
      role: payload.role,
      joinDate: payload.joinDate,
      designation: payload.designation,
      department: payload.department,
      qualification: payload.qualification,
      totalExperience: payload.totalExperience,
      gender: payload.gender,
      bloodGroup: payload.bloodGroup,
      dob: payload.dob,
      phone: payload.phone,
      email: (payload.email || "").trim(),
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

    if (payload.status) {
      updateFields.status = payload.status;
    }

    // Update linked user account, or create one if missing and credentials are provided
    const userSync = await syncStaffUserAccount(db, {
      existingStaff,
      payload,
      madrasaId: existingStaff.madrasa_id
    });
    if (userSync.errorStatus) {
      return res.status(userSync.errorStatus).json({ success: false, message: userSync.message });
    }
    if (!existingStaff.userId && userSync.userId) {
      updateFields.userId = userSync.userId;
    }

    const result = await mongo.updateData(
      db,
      "staff",
      { _id: staffId },
      { $set: updateFields }
    );

    if (!result) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    await upsertSalarySetup(db, existingStaff.madrasa_id, staffId, payload);

    res.status(200).json({ success: true, message: "Staff updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
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
  const { db } = await mongoConnect();
  try {
    const staffId = parseObjectId(req.params.id);
    if (!staffId) {
      return res.status(400).json({ success: false, message: "Invalid staff ID" });
    }

    const staff = await mongo.fetchOne(db, "staff", { _id: staffId });
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    // Multi-tenant validation (Super Admin can access all)
    if (!hasTenantAccess(req, staff)) {
      return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
    }

    // Fetch user email if linked
    if (staff.userId) {
      const userId = parseObjectId(staff.userId) || staff.userId;
      const user = await mongo.fetchOne(db, "users", { _id: userId });
      if (user) {
        const { password, ...safeUser } = user;
        staff.userId = safeUser;
      }
    }

    // Fetch active salary setup if present
    const salarySetup = await db.collection("salary_setups").findOne({
      staff_id: staffId,
      status: "active"
    });
    if (salarySetup) {
      staff.salarySetup = salarySetup;
    }

    res.status(200).json({ success: true, data: staff });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete staff
const deleteStaff = async (req, res) => {
  const { db } = await mongoConnect();
  try {
    const staffId = parseObjectId(req.params.id);
    if (!staffId) {
      return res.status(400).json({ success: false, message: "Invalid staff ID" });
    }

    // Multi-tenant validation - check staff exists and belongs to same madrasa
    const existingStaff = await mongo.fetchOne(db, "staff", { _id: staffId });
    if (!existingStaff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    if (!hasTenantAccess(req, existingStaff)) {
      return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
    }

    const result = await mongo.deleteData(db, "staff", { _id: staffId });

    if (!result) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    // Remove linked user account if present
    if (existingStaff.userId) {
      const userId = parseObjectId(existingStaff.userId) || existingStaff.userId;
      await db.collection("users").deleteOne({ _id: userId });
    }

    res.status(200).json({ success: true, message: "Staff deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
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
