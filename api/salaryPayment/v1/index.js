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

// Joi Schema for Salary Payment Payload
const salaryPaymentSchema = Joi.object({
  staff_id: Joi.string().required(),
  salary_setup_id: Joi.string().optional(),
  month: Joi.number().min(1).max(12).required(),
  year: Joi.number().min(2000).max(2100).required(),
  gross_salary: Joi.number().min(0).required(),
  deductions: Joi.number().min(0).default(0),
  payment_date: Joi.date().default(() => new Date()),
  payment_method: Joi.string().valid("Bank", "Mobile Banking", "Cash").required(),
  transaction_id: Joi.string().allow(""),
  note: Joi.string().allow(""),
  status: Joi.string().valid("paid", "pending").default("paid")
});

// Create new salary payment
const createSalaryPayment = async (req, res) => {
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
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!staff.madrasa_id || staff.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
      }
    }
    
    // Check for duplicate payment (same staff, month, year)
    const existingPayment = await mongo.fetchOne(db, "salary_payments", {
      staff_id: new ObjectId(payload.staff_id),
      month: payload.month,
      year: payload.year
    });
    
    if (existingPayment) {
      return res.status(400).json({ 
        success: false, 
        message: `Payment already exists for ${staff.name} for ${payload.month}/${payload.year}` 
      });
    }
    
    // Get active salary setup for this staff
    let salarySetupId = payload.salary_setup_id ? new ObjectId(payload.salary_setup_id) : null;
    
    if (!salarySetupId) {
      const activeSalarySetup = await mongo.fetchOne(db, "salary_setups", {
        staff_id: new ObjectId(payload.staff_id),
        status: "active"
      });
      
      if (activeSalarySetup) {
        salarySetupId = activeSalarySetup._id;
      }
    }
    
    // Calculate net salary
    const net_salary = parseFloat(payload.gross_salary) - parseFloat(payload.deductions || 0);
    
    // Create salary payment record
    const paymentData = {
      madrasa_id: madrasaId,
      staff_id: new ObjectId(payload.staff_id),
      salary_setup_id: salarySetupId,
      month: parseInt(payload.month),
      year: parseInt(payload.year),
      gross_salary: parseFloat(payload.gross_salary),
      deductions: parseFloat(payload.deductions || 0),
      net_salary: net_salary,
      payment_date: new Date(payload.payment_date || Date.now()),
      payment_method: payload.payment_method,
      transaction_id: payload.transaction_id || "",
      note: payload.note || "",
      status: payload.status || "paid",
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const newPayment = await db.collection("salary_payments").insertOne(paymentData);
    
    res.status(201).json({ 
      success: true, 
      message: "Salary payment recorded successfully",
      data: {
        paymentId: newPayment.insertedId,
        net_salary: net_salary
      }
    });
    
  } catch (error) {
    console.error("Salary Payment Creation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get all salary payments
const getAllSalaryPayments = async (req, res) => {
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
    if (req.query.month) query.month = parseInt(req.query.month);
    if (req.query.year) query.year = parseInt(req.query.year);
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
      {
        $lookup: {
          from: "salary_setups",
          localField: "salary_setup_id",
          foreignField: "_id",
          as: "salary_setup_info"
        }
      },
      { $unwind: { path: "$salary_setup_info", preserveNullAndEmptyArrays: true } },
      { $sort: { year: -1, month: -1, created_at: -1 } }
    ];
    
    if (page > 0 && limit > 0) {
      pipeline.push({ $skip: (page - 1) * limit });
      pipeline.push({ $limit: limit });
    }
    
    const payments = await db.collection("salary_payments").aggregate(pipeline).toArray();
    const total = await mongo.documentCount(db, "salary_payments", query);
    
    res.status(200).json({ success: true, data: payments, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get salary payments for specific staff
const getPaymentsByStaffId = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const staffId = new ObjectId(req.params.staffId);
    
    // Validate staff exists and belongs to same madrasa
    const staff = await mongo.fetchOne(db, "staff", { _id: staffId });
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !staff.madrasa_id || staff.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Staff belongs to different madrasa." });
      }
    }
    
    const query = { staff_id: staffId };
    if (req.query.year) query.year = parseInt(req.query.year);
    if (req.query.status) query.status = req.query.status;
    
    const payments = await mongo.fetchMany(db, "salary_payments", query, {}, { year: -1, month: -1 });
    
    res.status(200).json({ success: true, data: payments, staff_info: staff });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete salary payment
const deleteSalaryPayment = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    // Multi-tenant validation - check payment exists and belongs to same madrasa
    const existingPayment = await mongo.fetchOne(db, "salary_payments", { _id: req.params.id });
    if (!existingPayment) {
      return res.status(404).json({ success: false, message: "Salary payment not found" });
    }
    
    if (req.user.role !== 'super_admin') {
      if (!madrasaId || !existingPayment.madrasa_id || existingPayment.madrasa_id.toString() !== madrasaId.toString()) {
        return res.status(403).json({ success: false, message: "Access denied. Salary payment belongs to different madrasa." });
      }
    }
    
    const result = await mongo.deleteData(db, "salary_payments", { _id: req.params.id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Salary payment not found" });
    }
    
    res.status(200).json({ success: true, message: "Salary payment deleted successfully" });
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

// Routes with RBAC (Admin only)
router.get("/salary-payment", rbacMiddleware(['admin', 'super_admin']), getAllSalaryPayments);
router.get("/salary-payment/staff/:staffId", rbacMiddleware(['admin', 'super_admin']), getPaymentsByStaffId);
router.post("/salary-payment", rbacMiddleware(['admin', 'super_admin']), validate(salaryPaymentSchema), createSalaryPayment);
router.delete("/salary-payment/:id", rbacMiddleware(['admin', 'super_admin']), deleteSalaryPayment);

module.exports = router;
