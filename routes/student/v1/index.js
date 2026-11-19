const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema for Student
const studentSchema = Joi.object({
  firstName: Joi.string().required(),
  gender: Joi.string().valid("Male", "Female", "Other").required(),
  dateOfBirth: Joi.date().required(),
  bloodGroup: Joi.string().allow(""),
  
  // Relations
  guardian_id: Joi.string().required(),
  class_id: Joi.string().required(),
  section_id: Joi.string().allow(null, ""), // Optional initially
  roll_number: Joi.string().allow(""), // Can be auto-assigned
  
  // Details
  photo: Joi.string().allow(null, ""),
  academicYear: Joi.string().required(),
  admissionDate: Joi.date().required(),
  admissionStatus: Joi.string().default("Active"),
  
  // Modules
  transport: Joi.object({
    required: Joi.boolean(),
    route: Joi.string().allow("")
  }).optional(),
  hostel: Joi.object({
    required: Joi.boolean(),
    roomType: Joi.string().allow("")
  }).optional(),
  fees: Joi.object().optional(),
  
  note: Joi.string().allow("")
});

// Update Schema (some fields might be optional)
const studentUpdateSchema = studentSchema.fork(
    ['guardian_id', 'academicYear', 'admissionDate'], 
    (schema) => schema.optional()
);


// Get all students with comprehensive filters
const getAllStudents = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    const query = { madrasa_id: madrasaId };
    
    // Exact match filters - backend expects string IDs from frontend dropdowns, but handle ObjectIds just in case
    if (req.query.class_id && req.query.class_id !== 'all') {
        const classIdObj = ObjectId.isValid(req.query.class_id) ? new ObjectId(req.query.class_id) : req.query.class_id;
        query.class_id = { $in: [req.query.class_id, classIdObj] };
    }
    if (req.query.section_id && req.query.section_id !== 'all') {
        const sectionIdObj = ObjectId.isValid(req.query.section_id) ? new ObjectId(req.query.section_id) : req.query.section_id;
        query.section_id = { $in: [req.query.section_id, sectionIdObj] };
    }
    if (req.query.guardian_id) query.guardian_id = new ObjectId(req.query.guardian_id);
    if (req.query.status) query.admissionStatus = req.query.status;
    if (req.query.academicYear) query.academicYear = req.query.academicYear;

    // Search filter
    if (req.query.search) {
      query.$or = [
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } },
        { student_id: { $regex: req.query.search, $options: 'i' } },
        { roll_number: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Top-K Optimization: Sort and paginate BEFORE expensive lookups
    const pipeline = [
        { $match: query },
        { $sort: { created_at: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
            $addFields: {
                classObjectId: { $cond: [{ $and: [{ $ne: ["$class_id", null] }, { $ne: ["$class_id", ""] }] }, { $toObjectId: "$class_id" }, null] },
                sectionObjectId: { $cond: [{ $and: [{ $ne: ["$section_id", null] }, { $ne: ["$section_id", ""] }] }, { $toObjectId: "$section_id" }, null] }
            }
        },
        {
            $lookup: {
                from: "classes",
                let: { cid: "$classObjectId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$cid"] } } },
                    { $project: { name: 1 } }
                ],
                as: "classInfo"
            }
        },
        {
            $lookup: {
                from: "sections",
                let: { sid: "$sectionObjectId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
                    { $project: { name: 1 } }
                ],
                as: "sectionInfo"
            }
        },
        {
            $lookup: {
                from: "parents",
                let: { gid: "$guardian_id" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$gid"] } } },
                    { $project: { fatherName: 1, contact: 1, motherName: 1 } } // Project only what list/modals need
                ],
                as: "guardian"
            }
        },
        { $unwind: { path: "$classInfo", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$sectionInfo", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$guardian", preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                id: { $ifNull: ["$roll_number", { $substr: [{ $toString: "$_id" }, 18, 24] }] }, // Fallback to last chars of _id
                status: { $toLower: { $ifNull: ["$admissionStatus", "active"] } } // Map status for frontend
            }
        }
    ];

    const students = await db.collection("students").aggregate(pipeline).toArray();
    const total = await mongo.documentCount(db, "students", query);
    
    res.status(200).json({ success: true, data: students, total });
  } catch (error) {
    console.error("Fetch Students Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Get single student by ID with populated details
const getStudentById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Student ID format" });
    }
    const studentId = new ObjectId(req.params.id);
    const madrasaId = req.user.madrasa_id && ObjectId.isValid(req.user.madrasa_id) ? new ObjectId(req.user.madrasa_id) : null;
    
    const student = await db.collection("students").findOne({ _id: studentId, madrasa_id: madrasaId });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    
    // Fetch related data
    if (student.guardian_id) {
      const parent = await db.collection("parents").findOne({ _id: student.guardian_id });
      student.guardian = parent;
    }
    if (student.class_id) {
      const classInfo = await db.collection("classes").findOne({ _id: new ObjectId(student.class_id) });
      student.class = classInfo;
    }
    if (student.section_id) {
      const section = await db.collection("sections").findOne({ _id: new ObjectId(student.section_id) });
      student.section = section;
    }
    
    res.status(200).json({ success: true, data: student });
  } catch (error) {
    console.error("Get Student Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Create new student (Standalone)
const createStudent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    
    if (madrasaId) {
      const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found." });
      }

      const planLimit = madrasa.subscription?.studentLimit || 150;
      const currentStudentsCount = await db.collection("students").countDocuments({ madrasa_id: madrasaId });

      if (currentStudentsCount >= planLimit) {
        return res.status(403).json({
          success: false,
          message: `Subscription capacity limit exceeded! Your current plan allows up to ${planLimit} students. You currently have ${currentStudentsCount} registered. Please contact Super Admin to upgrade your subscription.`
        });
      }
    }

    const studentData = {
      ...req.body,
      madrasa_id: madrasaId,
      guardian_id: new ObjectId(req.body.guardian_id),
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const student = await mongo.insertOne(db, "students", studentData);
    res.status(201).json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Update student
const updateStudent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Student ID format" });
    }
    const studentId = new ObjectId(req.params.id);
    const madrasaId = req.user.madrasa_id && ObjectId.isValid(req.user.madrasa_id) ? new ObjectId(req.user.madrasa_id) : null;
    
    const payload = { ...req.body };
    payload.updated_at = Date.now();
    
    // Safety: Remove internal or read-only fields that might be contaminated by string values from frontend
    delete payload._id;
    delete payload.madrasa_id; 
    delete payload.userId;
    delete payload.classInfo;
    delete payload.sectionInfo;
    delete payload.guardian;
    delete payload.status;
    delete payload.id;
    
    // Convert IDs if present to ensure they remain ObjectIds in the DB
    if(payload.guardian_id) payload.guardian_id = new ObjectId(payload.guardian_id);

    const result = await db.collection("students").updateOne(
      { _id: studentId, madrasa_id: madrasaId },
      { $set: payload }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    
    res.status(200).json({ success: true, message: "Student updated successfully" });
  } catch (error) {
    console.error("Update Student Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Delete student
const deleteStudent = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Student ID format" });
    }
    const studentId = new ObjectId(req.params.id);
    const madrasaId = req.user.madrasa_id && ObjectId.isValid(req.user.madrasa_id) ? new ObjectId(req.user.madrasa_id) : null;
    
    // 1. Get student to find user reference
    const student = await db.collection("students").findOne({ _id: studentId, madrasa_id: madrasaId });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    
    // 2. Delete student
    await db.collection("students").deleteOne({ _id: studentId });
    
    // 3. Delete associated user
    if (student.student_id) {
        await db.collection("users").deleteOne({ reference_id: student.student_id });
    }
    
    res.status(200).json({ success: true, message: "Student deleted successfully" });
  } catch (error) {
    console.error("Delete Student Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Get student portal data (comprehensive 360-view)
const getStudentPortalData = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Student ID format" });
    }
    const studentId = new ObjectId(req.params.id);
    const madrasaId = req.user.madrasa_id && ObjectId.isValid(req.user.madrasa_id) ? new ObjectId(req.user.madrasa_id) : null;
    
    // 1. Fetch Student with populated Class, Section, Guardian
    const student = await db.collection("students").findOne({ _id: studentId, madrasa_id: madrasaId });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    
    // Populate relations
    if (student.guardian_id) {
        student.guardian = await db.collection("parents").findOne({ _id: new ObjectId(student.guardian_id) });
    }
    if (student.class_id) {
        student.classInfo = await db.collection("classes").findOne({ _id: new ObjectId(student.class_id) });
    }
    if (student.section_id) {
        student.sectionInfo = await db.collection("sections").findOne({ _id: new ObjectId(student.section_id) });
    }

    // 2. Attendance Summary
    const attendanceRecords = await db.collection("attendance").find({ student_id: req.params.id, type: "student" }).toArray();
    const totalDays = attendanceRecords.length;
    const presentDays = attendanceRecords.filter(r => r.status === "Present").length;
    const attendancePercentage = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : 0;

    // 4. Financial Summary
    // We look for transactions linked to this student (v1 uses reference_id for linking usually)
    const [transactions, reportsRaw] = await Promise.all([
        db.collection("transactions").find({ 
            $or: [
                { reference_id: req.params.id }, 
                { student_id: req.params.id }
            ],
            category: "Fee" 
        }).sort({ date: -1 }).toArray(),
        db.collection("academic_reports").find({ student_id: req.params.id }).sort({ date: -1 }).toArray()
    ]);
    
    const marks = await Promise.all(reportsRaw.map(async (r) => {
        const subject = r.subject_id ? await db.collection("subjects").findOne({ _id: new ObjectId(r.subject_id) }) : null;
        return {
            subject: subject?.name || "Unknown Subject",
            marks: r.marks_obtained,
            grade: r.grade || "N/A"
        };
    }));

    const paidFees = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalFees = student.fees?.total || paidFees + 500; // Fallback or dynamic logic

    // Final formatted response
    const formattedData = {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName || "",
        id: student.roll_number || student._id.toString().slice(-6).toUpperCase(),
        photo: student.photo || "https://api.dicebear.com/7.x/avataaars/svg?seed=" + student.firstName,
        status: student.admissionStatus || "active",
        class: student.classInfo?.name || "N/A",
        section: student.sectionInfo?.name || "N/A",
        rollNo: student.roll_number || "N/A",
        religion: student.religion || "Islam",
        bloodGroup: student.bloodGroup || "O+",
        address: student.address || "N/A",
        phone: student.phone || student.guardian?.contact || "N/A",
        email: student.email || "N/A",
        academic: {
            attendance: parseFloat(attendancePercentage),
            avgGrade: marks.length > 0 ? "B+" : "N/A", // Simplified
            lastExam: reportsRaw.length > 0 ? "Last Assessment" : "N/A",
            lastGPA: marks.length > 0 ? "3.5" : "0.0",
            marks: marks.length > 0 ? marks : [
                { subject: "Mathematics", marks: 0, grade: "N/A" },
                { subject: "English", marks: 0, grade: "N/A" }
            ]
        },
        financial: {
            totalFees: totalFees,
            paidFees: paidFees,
            pendingFees: Math.max(0, totalFees - paidFees),
            history: transactions.length > 0 ? transactions.map(t => ({
                id: t._id,
                date: new Date(t.date).toLocaleDateString(),
                type: t.category,
                amount: t.amount,
                status: "Paid"
            })) : [
                { id: "INV-001", date: "N/A", type: "Admission Fee", amount: 0, status: "Pending" }
            ]
        },
        guardian: {
            father: {
                name: student.guardian?.fatherName || "N/A",
                phone: student.guardian?.contact || "N/A",
                occupation: "N/A",
                photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=father"
            },
            mother: {
                name: student.guardian?.motherName || "N/A",
                phone: "N/A",
                occupation: "N/A",
                photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=mother"
            }
        }
    };

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Portal Data Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // Connection reused
  }
};

// Routes
router.get("/students", getAllStudents);
router.get("/portal/student/:id", getStudentPortalData); // Profile/Portal route
router.get("/students/:id", getStudentById);
router.post("/students", validate(studentSchema), createStudent);
router.put("/students/:id", validate(studentUpdateSchema), updateStudent);
router.delete("/students/:id", deleteStudent);

module.exports = router;
