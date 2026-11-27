const router = require("express").Router();
const root = process.cwd();
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const { triggerAttendanceSms } = require(`${root}/services/sms.service`);
const { getMadrasaFilter } = require(`${root}/routes/boarding/v1/helpers`);

router.use(authMiddleware);
router.use(tenantMiddleware);

// Joi Schemas
const studentAttendanceSchema = Joi.object({
  class_id: Joi.string().required(),
  section_id: Joi.string(),
  date: Joi.date().required(), // YYYY-MM-DD or timestamp
  records: Joi.array().items(
    Joi.object({
      student_id: Joi.string().required(),
      status: Joi.string().valid("Present", "Absent", "Late", "Excused", "Leave").required(),
      remarks: Joi.string().allow("")
    })
  ).min(1).required(),
  takenBy: Joi.string().allow(""),
  sendSms: Joi.boolean().default(true)
});

const staffAttendanceSchema = Joi.object({
  date: Joi.date().required(),
  records: Joi.array().items(
    Joi.object({
      staff_id: Joi.string().required(),
      status: Joi.string().valid("Present", "Absent", "Late", "Leave").required(),
      checkIn: Joi.string().allow(""), // HH:mm
      checkOut: Joi.string().allow(""),
      remarks: Joi.string().allow("")
    })
  ).min(1).required(),
  takenBy: Joi.string().allow("")
});

// Mark student attendance (Bulk)
const markStudentAttendance = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { class_id, section_id, date, records, takenBy, sendSms } = req.body;
    const madrasa_id = req.user.madrasa_id;
    const madrasaFilter = getMadrasaFilter(madrasa_id);

    // Transform records for insertion
    const attendanceDocs = records.map(record => ({
      type: "student",
      madrasa_id,
      class_id,
      section_id,
      student_id: record.student_id,
      date: new Date(date), // Ensure date object
      status: record.status,
      remarks: record.remarks,
      takenBy,
      created_at: Date.now(),
      updated_at: Date.now()
    }));

    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    const deleteQuery = {
      type: "student",
      madrasa_id: madrasaFilter,
      class_id,
      date: { $gte: startOfDay, $lte: endOfDay }
    };
    if (section_id) deleteQuery.section_id = section_id;

    await db.collection("attendance").deleteMany(deleteQuery);

    const result = await db.collection("attendance").insertMany(attendanceDocs);

    let smsSummary = { triggered: false, sentCount: 0 };
    try {
      smsSummary = await triggerAttendanceSms(db, {
        madrasaId: madrasa_id,
        date,
        records,
        sendSms: sendSms !== false,
      });
    } catch (smsErr) {
      console.error("Attendance Auto-SMS Error (attendance still saved):", smsErr);
      smsSummary = { triggered: false, skippedReason: "sms_error", sentCount: 0 };
    }

    res.status(201).json({
      success: true,
      message: "Attendance marked successfully",
      count: result.insertedCount,
      smsSummary,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Mark staff attendance (Bulk)
const markStaffAttendance = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { date, records, takenBy } = req.body;
    const madrasa_id = req.user.madrasa_id;

    const attendanceDocs = records.map(record => ({
      type: "staff",
      madrasa_id,
      staff_id: record.staff_id,
      date: new Date(date),
      status: record.status,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      remarks: record.remarks,
      takenBy,
      created_at: Date.now(),
      updated_at: Date.now()
    }));

    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    // Clear existing for this date
    await db.collection("attendance").deleteMany({
      type: "staff",
      madrasa_id,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    const result = await db.collection("attendance").insertMany(attendanceDocs);
    res.status(201).json({ success: true, message: "Staff attendance marked", count: result.insertedCount });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get attendance report
const getAttendanceReport = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = {
      type: req.query.type, // student or staff
      madrasa_id: getMadrasaFilter(req.user.madrasa_id)
    };

    if (req.query.class_id) query.class_id = req.query.class_id;
    if (req.query.section_id) query.section_id = req.query.section_id;
    if (req.query.student_id) query.student_id = req.query.student_id;
    if (req.query.staff_id) query.staff_id = req.query.staff_id;

    if (req.query.start_date && req.query.end_date) {
      query.date = {
        $gte: new Date(req.query.start_date),
        $lte: new Date(req.query.end_date)
      };
    } else if (req.query.date) {
      const d = new Date(req.query.date);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end = new Date(d); end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }

    const attendance = await mongo.fetchMany(db, "attendance", query, {}, { date: -1 });
    const total = await mongo.documentCount(db, "attendance", query);

    res.status(200).json({ success: true, data: attendance, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};


// Routes
router.post("/attendance/student", validate(studentAttendanceSchema), markStudentAttendance);
router.post("/attendance/staff", validate(staffAttendanceSchema), markStaffAttendance);
router.get("/attendance/report", getAttendanceReport);

module.exports = router;
