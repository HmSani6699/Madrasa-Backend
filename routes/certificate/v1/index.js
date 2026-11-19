const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const { ObjectId } = require("mongodb");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const certificateSchema = Joi.object({
  type: Joi.string().valid("ID Card", "Transfer Certificate", "Character Certificate", "Testimonial", "Appreciation").required(),
  student_id: Joi.string().required(),
  issue_date: Joi.date().default(Date.now),
  remarks: Joi.string().allow("")
});

// Generate Serial Number (Simple timestamp + random implementation for now)
// In production, might want sequential per year/type
const generateSerial = () => {
    return `CERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Issue Certificate
const issueCertificate = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { student_id, type } = req.body;
    const madrasaId = req.user.madrasa_id;
    
    // Fetch current student data for snapshot
    const student = await mongo.fetchOne(db, "students", { _id: student_id, madrasa_id: madrasaId });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    // Look up class/section names if needed for snapshot
    let className = "";
    let sectionName = "";

    if (student.class_id) {
        const c = await mongo.fetchOne(db, "classes", { _id: student.class_id, madrasa_id: madrasaId });
        if (c) className = c.name;
    }
    if (student.section_id) {
        const s = await mongo.fetchOne(db, "sections", { _id: student.section_id, madrasa_id: madrasaId });
        if (s) sectionName = s.name;
    }

    const certData = {
      ...req.body,
      madrasa_id: madrasaId,
      certificate_no: generateSerial(),
      content_snapshot: {
          name: `${student.firstName} ${student.lastName || ""}`.trim(),
          roll_number: student.roll_number,
          class: className,
          section: sectionName,
          guardian_name: student.guardian_id ? "Linked Guardian" : "", // Could fetch guardian
          dob: student.dateOfBirth
      },
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const cert = await mongo.insertOne(db, "certificates", certData);
    res.status(201).json({ success: true, data: cert });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get All Issued Certificates
const getAllCertificates = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
      const query = { madrasa_id: req.user.madrasa_id };
      if (req.query.student_id) query.student_id = req.query.student_id;
      if (req.query.type) query.type = req.query.type;
      
      const certs = await mongo.fetchMany(db, "certificates", query, {}, { issue_date: -1 });
      res.status(200).json({ success: true, data: certs });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
};

// Get Data for ID Cards (Student)
const getStudentIdCardData = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
        const madrasaId = req.user.madrasa_id;
        const query = { status: "Active", madrasa_id: madrasaId };
        if (req.query.class_id) query.class_id = req.query.class_id;
        if (req.query.section_id) query.section_id = req.query.section_id;

        const students = await mongo.fetchMany(db, "students", query, {}, { roll_number: 1 });
        
        // We need to populate Class and Section names for the ID card
        // Doing strictly one-by-one or manual map for simplicity in current architecture
        // Ideally use aggregation with $lookup
        
        const enhancedStudents = await Promise.all(students.map(async (s) => {
            let className = "";
            let sectionName = "";
            if (s.class_id) {
                const c = await mongo.fetchOne(db, "classes", { _id: s.class_id, madrasa_id: madrasaId });
                if (c) className = c.name;
            }
            if (s.section_id) {
                 const sec = await mongo.fetchOne(db, "sections", { _id: s.section_id, madrasa_id: madrasaId });
                 if (sec) sectionName = sec.name;
            }
            
            return {
                _id: s._id,
                name: s.firstName, // Assuming full name logic
                roll_number: s.roll_number,
                class: className,
                section: sectionName,
                blood_group: s.bloodGroup,
                photo: s.photo,
                dob: s.dateOfBirth,
                parent_contact: "N/A" // Placeholder, needs guardian lookup
            };
        }));

        res.status(200).json({ success: true, data: enhancedStudents });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        // await // client.close();
    }
};


// Get Data for ID Cards (Staff)
const getStaffIdCardData = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
        const madrasaId = req.user.madrasa_id;
        const query = { status: "Active", madrasa_id: madrasaId };
        if (req.query.role) query.role = req.query.role;

        const staff = await mongo.fetchMany(db, "staff", query, {}, { name: 1 });
        
        const enhancedStaff = await Promise.all(staff.map(async (s) => {
             let deptName = "";
             let desigName = "";
             // Fetch dept/designation if IDs exist
             if (s.department_id) {
                 const d = await mongo.fetchOne(db, "departments", { _id: s.department_id, madrasa_id: madrasaId });
                 if (d) deptName = d.name;
             }
             if (s.designation_id) {
                 const deg = await mongo.fetchOne(db, "designations", { _id: s.designation_id, madrasa_id: madrasaId });
                 if (deg) desigName = deg.name;
             }
             
             return {
                 _id: s._id,
                 name: s.name,
                 role: s.role,
                 department: deptName,
                 designation: desigName,
                 blood_group: s.bloodGroup,
                 photo: s.photo,
                 phone: s.phone,
                 join_date: s.joinDate
             };
        }));

        res.status(200).json({ success: true, data: enhancedStaff });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        // await // client.close();
    }
};


// Routes
router.post("/certificates", validate(certificateSchema), issueCertificate);
router.get("/certificates", getAllCertificates);
router.get("/cards/students", getStudentIdCardData);
router.get("/cards/staff", getStaffIdCardData);

module.exports = router;
