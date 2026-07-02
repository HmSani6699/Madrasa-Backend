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

// Joi Schema for Admission Payload
const admissionSchema = Joi.object({
  academicYear: Joi.string().required(),
  admissionDate: Joi.date().required(),
  position: Joi.string().allow(""),
  guardian: Joi.object({
    fatherName: Joi.string().required(),
    motherName: Joi.string().required(),
    fatherOccupation: Joi.string().allow(""),
    motherOccupation: Joi.string().allow(""),
    contact: Joi.string().required(),
    motherContact: Joi.string().allow(""),
    email: Joi.string().email().allow(""),
    address: Joi.string().required(),
    fatherPhoto: Joi.string().allow(""),
    motherPhoto: Joi.string().allow(""),
    guardianNID: Joi.string().allow("")
  }).required(),
  guardian_id: Joi.string().allow(null, ""),
  students: Joi.array().items(
    Joi.object({
      id: Joi.any(),
      firstName: Joi.string().required(),
      gender: Joi.string().valid("Male", "Female", "Other").required(),
      dateOfBirth: Joi.date().required(),
      bloodGroup: Joi.string().allow(""),
      class_id: Joi.string().required(),
      section_id: Joi.string().allow(""),
      photo: Joi.string().allow(""),
      transport: Joi.object({
        required: Joi.boolean(),
        route: Joi.string().allow("")
      }).optional(),
      hostel: Joi.object({
        required: Joi.boolean(),
        roomType: Joi.string().allow("")
      }).optional(),
      fees: Joi.object().optional(),
      note: Joi.string().allow(""),
      password: Joi.string().allow(""),
      student_id: Joi.string().allow("")
    })
  ).min(1).required()
});

// Create new admission (No transaction - standalone MongoDB compatible)
const createAdmission = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    
    const payload = req.body;
    const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
    let guardianId = null;
    let guardianUserId = null;

    // Enforce student limit based on subscription plan capacity
    if (madrasaId) {
      const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found." });
      }

      const planLimit = madrasa.subscription?.studentLimit || 150;
      const currentStudentsCount = await db.collection("students").countDocuments({ madrasa_id: madrasaId });
      const newStudentsCount = payload.students ? payload.students.length : 0;

      if (currentStudentsCount + newStudentsCount > planLimit) {
        return res.status(403).json({
          success: false,
          message: `Subscription capacity limit exceeded! Your current plan allows up to ${planLimit} students. You currently have ${currentStudentsCount} registered, and you tried to add ${newStudentsCount}. Please contact Super Admin to upgrade your subscription.`
        });
      }
    }

    // 1. Check if Guardian exists by guardian_id OR contact number and madrasa_id
    let existingGuardian = null;
    if (payload.guardian_id && ObjectId.isValid(payload.guardian_id)) {
      existingGuardian = await db.collection("parents").findOne({ 
        _id: new ObjectId(payload.guardian_id), 
        madrasa_id: madrasaId 
      });
    }

    if (!existingGuardian) {
      existingGuardian = await db.collection("parents").findOne({ 
        contact: payload.guardian.contact, 
        madrasa_id: madrasaId 
      });
    }

    if (existingGuardian) {
      guardianId = existingGuardian._id;
      guardianUserId = existingGuardian.userId;
      
      // Only update existing guardian details if an explicit guardian_id wasn't provided
      if (!payload.guardian_id) {
        await db.collection("parents").updateOne(
          { _id: guardianId },
          { $set: { ...payload.guardian, updated_at: Date.now() } }
        );
      }
    } else {
      // Create User for Guardian
      const guardianPassword = await authService.hashPassword(payload.guardian.contact);
      const guardianUser = await db.collection("users").insertOne({
        username: payload.guardian.contact,
        email: payload.guardian.email || "",
        password: guardianPassword,
        role: "parent",
        madrasa_id: madrasaId,
        created_at: Date.now(),
        updated_at: Date.now()
      });
      
      guardianUserId = guardianUser.insertedId;

      // Create new Guardian Profile
      const guardianData = {
        ...payload.guardian,
        userId: guardianUserId,
        madrasa_id: madrasaId,
        created_at: Date.now(),
        updated_at: Date.now()
      };
      
      const newGuardian = await db.collection("parents").insertOne(guardianData);
      guardianId = newGuardian.insertedId;
      
      // Link user back to profile
      await db.collection("users").updateOne({ _id: guardianUserId }, { $set: { reference_id: guardianId } });
    }

    // 2. Create Students
    const studentUserUpdates = [];
    const studentDocs = [];

    for (const student of payload.students) {
        // Exclude UI specific fields
        const { id, password, class: className, ...studentData } = student;
        
        // Generate Student User Credentials
        const username = `ST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const studentPasswordRaw = password || "123456";
        const studentPasswordHash = await authService.hashPassword(studentPasswordRaw);

        const studentUser = await db.collection("users").insertOne({
            username: username,
            password: studentPasswordHash,
            role: "student",
            madrasa_id: madrasaId,
            created_at: Date.now(),
            updated_at: Date.now()
        });

        const studentDoc = {
            ...studentData,
            userId: studentUser.insertedId,
            guardian_id: guardianId,
            madrasa_id: madrasaId,
            academicYear: payload.academicYear,
            admissionDate: payload.admissionDate,
            admissionStatus: "Active",
            roll_number: student.roll_number || "",
            class_id: student.class_id || null,
            section_id: student.section_id || null,
            created_at: Date.now(),
            updated_at: Date.now()
        };
        
        studentDocs.push(studentDoc);
        studentUserUpdates.push({ userId: studentUser.insertedId, username, password: studentPasswordRaw });
    }

    const studentsResult = await db.collection("students").insertMany(studentDocs);
    const studentIds = Object.values(studentsResult.insertedIds);

    // Update Users with reference_ids
    for (let i = 0; i < studentIds.length; i++) {
        await db.collection("users").updateOne(
            { _id: studentUserUpdates[i].userId },
            { $set: { reference_id: studentIds[i] } }
        );
    }
    
    res.status(201).json({ 
        success: true, 
        message: "Admission processed successfully",
        data: {
            guardianId: guardianId,
            studentIds: studentIds,
            credentials: studentUserUpdates.map(s => ({ username: s.username, password: s.password }))
        }
    });

  } catch (error) {
    console.error("Admission Error:", error);
    
    // Better handling for RangeError/BSON size issues
    if (error.name === 'RangeError' || error.message.includes('OUT_OF_RANGE') || error.message.includes('BSON')) {
        return res.status(413).json({ 
            success: false, 
            message: "Payload too large. Please reduce the size of photos or the number of students in a single request.",
            details: error.message
        });
    }

    res.status(500).json({ success: false, message: error.message });
  }
};

// Update existing admission (No transaction - standalone MongoDB compatible)
const updateAdmission = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const payload = req.body;
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
        const guardianId = payload.guardianId ? new ObjectId(payload.guardianId) : null;

        if (!guardianId) throw new Error("Guardian ID is required for update");

        // 1. Update Guardian
        if (payload.guardian) {
            await db.collection("parents").updateOne(
                { _id: guardianId, madrasa_id: madrasaId },
                { $set: { ...payload.guardian, updated_at: Date.now() } }
            );
        }

        // 2. Update Students (Batch update)
        if (payload.students && Array.isArray(payload.students)) {
            for (const student of payload.students) {
                if (student._id) {
                    const { _id, userId, ...updateData } = student;
                    await db.collection("students").updateOne(
                        { _id: new ObjectId(_id), madrasa_id: madrasaId },
                        { $set: { ...updateData, updated_at: Date.now() } }
                    );
                }
            }
        }

        res.status(200).json({ success: true, message: "Admission updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all admissions (Students with Guardian info)
const getAdmissions = async (req, res) => {
    try {
        const { db, client } = await mongoConnect();
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
        const query = { madrasa_id: madrasaId };

        if (req.query.class_id) query.class_id = req.query.class_id;
        if (req.query.section_id) query.section_id = req.query.section_id;
        if (req.query.academicYear) query.academicYear = req.query.academicYear;
        if (req.query.gender) query.gender = req.query.gender;
        if (req.query.bloodGroup) query.bloodGroup = req.query.bloodGroup;
        if (req.query.religion) query.religion = req.query.religion;

        if (req.query.startDate && req.query.endDate) {
            query.admissionDate = {
                $gte: req.query.startDate,
                $lte: req.query.endDate
            };
        } else if (req.query.startDate) {
            query.admissionDate = { $gte: req.query.startDate };
        } else if (req.query.endDate) {
            query.admissionDate = { $lte: req.query.endDate };
        }

        if (req.query.search) {
            query.$or = [
                { firstName: { $regex: req.query.search, $options: 'i' } },
                { student_id: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const pipeline = [
            { $match: query },
            { $sort: { created_at: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
                $lookup: {
                    from: "parents",
                    localField: "guardian_id",
                    foreignField: "_id",
                    as: "guardian"
                }
            },
            { $unwind: { path: "$guardian", preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    classObjectId: { 
                        $convert: { 
                            input: "$class_id", 
                            to: "objectId", 
                            onError: null, 
                            onNull: null 
                        } 
                    }
                }
            },
            {
                $lookup: {
                    from: "classes",
                    localField: "classObjectId",
                    foreignField: "_id",
                    as: "classInfo"
                }
            },
            { $unwind: { path: "$classInfo", preserveNullAndEmptyArrays: true } }
        ];

        const [data, total] = await Promise.all([
            db.collection("students").aggregate(pipeline).toArray(),
            db.collection("students").countDocuments(query)
        ]);

        res.status(200).json({ success: true, data, total });
    } catch (error) {
        console.error("Fetch Admissions Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Admission (Delete Student, check if guardian should remain)
const deleteAdmission = async (req, res) => {
    try {
        const { db, client } = await mongoConnect();
        const studentId = new ObjectId(req.params.id);
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

        // Find student to get guardian_id and userId
        const student = await db.collection("students").findOne({ _id: studentId, madrasa_id: madrasaId });
        if (!student) return res.status(404).json({ success: false, message: "Student not found" });

        // Delete student record
        await db.collection("students").deleteOne({ _id: studentId });
        
        // Delete student user
        if (student.userId) {
            await db.collection("users").deleteOne({ _id: student.userId });
        }

        res.status(200).json({ success: true, message: "Admission deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Online Admission Admin Endpoints (Multi-tenant)
const getOnlineAdmissions = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const [data, total] = await Promise.all([
            db.collection("online_admissions").find({ madrasa_id: madrasaId })
                .sort({ created_at: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .toArray(),
            db.collection("online_admissions").countDocuments({ madrasa_id: madrasaId })
        ]);

        res.status(200).json({ success: true, data, total });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getOnlineAdmissionById = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const { id } = req.params;
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;
        const data = await db.collection("online_admissions").findOne({ _id: new ObjectId(id), madrasa_id: madrasaId });
        if (!data) return res.status(404).json({ success: false, message: "Application not found" });
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateOnlineAdmissionStatus = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const { id } = req.params;
        const { status } = req.body;
        const madrasaId = req.user.madrasa_id ? new ObjectId(req.user.madrasa_id) : null;

        // Update status in online_admissions
        const updateResult = await db.collection("online_admissions").findOneAndUpdate(
            { _id: new ObjectId(id), madrasa_id: madrasaId },
            { $set: { status, updated_at: new Date() } },
            { returnDocument: "after" }
        );

        const application = updateResult.value || updateResult;

        if (!application) {
            return res.status(404).json({ success: false, message: "Application not found" });
        }

        res.status(200).json({ success: true, message: `Application ${status} and processed` });
    } catch (error) {
        console.error("Update Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Routes
router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/online-admission", rbacMiddleware(['admin']), getOnlineAdmissions);
router.get("/online-admission/:id", rbacMiddleware(['admin']), getOnlineAdmissionById);
router.put("/online-admission/:id/status", rbacMiddleware(['admin']), updateOnlineAdmissionStatus);

router.get("/admission", rbacMiddleware(['admin']), getAdmissions);
router.post("/admission", rbacMiddleware(['admin']), validate(admissionSchema), createAdmission);
router.put("/admission", rbacMiddleware(['admin']), updateAdmission);
router.delete("/admission/:id", rbacMiddleware(['admin']), deleteAdmission);

module.exports = router;
