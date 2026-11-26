const router = require("express").Router();
const root = process.cwd();
const Joi = require("joi");
const { ObjectId } = require("mongodb");

const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const {
  VEHICLE_TYPES,
  EXPENSE_CATEGORIES,
  TRIP_TYPES,
  getMadrasaFilter,
  toMadrasaObjectId,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  getBangladeshTimeStr,
  buildTransportStudentDoc,
  upsertTransportStudent,
} = require("./helpers");

router.use(authMiddleware);
router.use(tenantMiddleware);

const allowedRoles = ["admin", "mohtamim", "accountant", "talimat"];

/* =========================
   VALIDATION SCHEMAS
========================= */

const vehicleSchema = Joi.object({
  vehicle_no: Joi.string().trim().required(),
  vehicle_name: Joi.string().trim().allow("", null),
  vehicle_type: Joi.string().valid("Bus", "Microbus", "Van", "Auto/CNG", "Other").default("Van"),
  seat_capacity: Joi.number().integer().min(1).max(200).default(14),
  driver_name: Joi.string().trim().required(),
  driver_phone: Joi.string().trim().required(),
  driver_license: Joi.string().trim().allow("", null),
  helper_name: Joi.string().trim().allow("", null),
  helper_phone: Joi.string().trim().allow("", null),
  fitness_expiry: Joi.string().allow("", null),
  tax_token_expiry: Joi.string().allow("", null),
  insurance_expiry: Joi.string().allow("", null),
  status: Joi.string().valid("Active", "Maintenance", "Inactive").default("Active"),
  note: Joi.string().allow("", null),
});

const stopSchema = Joi.object({
  stop_name: Joi.string().trim().required(),
  pickup_time: Joi.string().allow("", null),
  drop_time: Joi.string().allow("", null),
  monthly_fee: Joi.number().min(0).default(0),
  landmark: Joi.string().allow("", null),
});

const routeSchema = Joi.object({
  route_name: Joi.string().trim().required(),
  route_code: Joi.string().trim().allow("", null),
  vehicle_id: Joi.string().allow("", null),
  start_point: Joi.string().trim().allow("", null),
  end_point: Joi.string().trim().allow("", null),
  morning_start_time: Joi.string().allow("", null),
  afternoon_return_time: Joi.string().allow("", null),
  default_fee: Joi.number().min(0).default(1000),
  stops: Joi.array().items(stopSchema).default([]),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  note: Joi.string().allow("", null),
});

const enrollStudentSchema = Joi.object({
  student_id: Joi.string().required(),
  route_id: Joi.string().allow("", null),
  route_name: Joi.string().allow("", null),
  stoppage: Joi.string().allow("", null),
  pickup_address: Joi.string().allow("", null),
  trip_type: Joi.string().valid("Both", "Pickup", "Drop").default("Both"),
  monthly_fee: Joi.number().min(0).optional(),
  waiver_percent: Joi.number().min(0).max(100).default(0),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  note: Joi.string().allow("", null),
});

const bulkEnrollSchema = Joi.object({
  student_ids: Joi.array().items(Joi.string().required()).min(1).required(),
  route_id: Joi.string().required(),
  stoppage: Joi.string().allow("", null),
  trip_type: Joi.string().valid("Both", "Pickup", "Drop").default("Both"),
  monthly_fee: Joi.number().min(0).optional(),
  waiver_percent: Joi.number().min(0).max(100).default(0),
});

const dailyTripStatusSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  student_id: Joi.string().required(),
  trip: Joi.string().valid("pickup", "return").required(),
  status: Joi.string().valid("pending", "boarded", "dropped", "absent").required(),
  note: Joi.string().allow("", null),
});

const bulkDailyTripSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  route_id: Joi.string().allow("", null),
  trip: Joi.string().valid("pickup", "return").required(),
  status: Joi.string().valid("pending", "boarded", "dropped", "absent").required(),
  student_ids: Joi.array().items(Joi.string()).optional(),
});

const expenseSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  vehicle_id: Joi.string().allow("", null),
  category: Joi.string()
    .valid("Fuel", "Maintenance", "Driver Allowance", "Toll & Parking", "Insurance & Tax", "Other")
    .required(),
  title: Joi.string().trim().required(),
  quantity: Joi.number().min(0).allow(null, ""),
  unit: Joi.string().allow("", null),
  odometer_km: Joi.number().min(0).allow(null, ""),
  amount: Joi.number().positive().required(),
  paid_by: Joi.string().allow("", null),
  account_id: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
});

const generateBillsSchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
});

const collectBillSchema = Joi.object({
  paid_amount: Joi.number().positive().required(),
  payment_method: Joi.string().default("Cash"),
  account_id: Joi.string().allow("", null),
  remarks: Joi.string().allow("", null),
});

/* =========================
   1. DASHBOARD KPI SUMMARY
========================= */

const getDashboard = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const today = req.query.date || getBangladeshDateStr();
    const currentMonth = today.slice(0, 7);
    const monthRegex = new RegExp(`^${currentMonth}-`);

    const [vehicles, routes, transportStudents, todayLogs, monthExpenses, monthBills] = await Promise.all([
      db.collection("transport_vehicles").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_routes").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_students").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_daily_logs").find({ madrasa_id: madrasaFilter, date: today }).toArray(),
      db.collection("transport_expenses").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
      db.collection("transport_bills").find({ madrasa_id: madrasaFilter, month: currentMonth }).toArray(),
    ]);

    const activeVehicles = vehicles.filter((v) => v.status === "Active");
    const maintenanceVehicles = vehicles.filter((v) => v.status === "Maintenance");
    const totalSeats = activeVehicles.reduce((sum, v) => sum + Number(v.seat_capacity || 0), 0);

    const activeRoutes = routes.filter((r) => r.status === "Active");
    const activeStudents = transportStudents.filter((s) => s.status === "Active");

    const logMap = new Map(todayLogs.map((l) => [l.student_id.toString(), l]));
    let pickupBoarded = 0;
    let pickupDropped = 0;
    let returnBoarded = 0;
    let returnDropped = 0;
    let absentToday = 0;

    for (const st of activeStudents) {
      const log = logMap.get(st.student_id.toString());
      if (!log) continue;
      if (log.pickup_status === "boarded") pickupBoarded++;
      if (log.pickup_status === "dropped") pickupDropped++;
      if (log.return_status === "boarded") returnBoarded++;
      if (log.return_status === "dropped") returnDropped++;
      if (log.pickup_status === "absent" && log.return_status === "absent") absentToday++;
    }

    const totalExpectedMonthly = activeStudents.reduce(
      (sum, s) => sum + Number(s.net_monthly_fee || 0),
      0
    );
    const monthExpenseTotal = monthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const monthCollected = monthBills.reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);
    const monthBilled = monthBills.reduce((sum, b) => sum + Number(b.net_payable || 0), 0);
    const monthDue = monthBills.reduce((sum, b) => sum + Number(b.due_amount || 0), 0);

    // Expiry alerts within 30 days
    const nowDate = new Date(today);
    const limitDate = new Date(nowDate.getTime() + 30 * 86400000);
    const expiryAlerts = [];
    for (const v of vehicles) {
      const checks = [
        { label: "ফিটনেস", date: v.fitness_expiry },
        { label: "ট্যাক্স টোকেন", date: v.tax_token_expiry },
        { label: "ইন্স্যুরেন্স", date: v.insurance_expiry },
      ];
      for (const chk of checks) {
        if (!chk.date) continue;
        const dt = new Date(chk.date);
        if (!Number.isNaN(dt.getTime()) && dt <= limitDate) {
          expiryAlerts.push({
            vehicle_id: v._id,
            vehicle_no: v.vehicle_no,
            doc_type: chk.label,
            expiry_date: chk.date,
            is_expired: dt < nowDate,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        date: today,
        month: currentMonth,
        vehiclesSummary: {
          total: vehicles.length,
          active: activeVehicles.length,
          maintenance: maintenanceVehicles.length,
          inactive: vehicles.length - activeVehicles.length - maintenanceVehicles.length,
          totalSeats,
        },
        routesSummary: {
          total: routes.length,
          active: activeRoutes.length,
        },
        studentsSummary: {
          total: activeStudents.length,
          inactive: transportStudents.length - activeStudents.length,
          bothWay: activeStudents.filter((s) => s.trip_type === "Both").length,
          pickupOnly: activeStudents.filter((s) => s.trip_type === "Pickup").length,
          dropOnly: activeStudents.filter((s) => s.trip_type === "Drop").length,
          expectedMonthlyFee: totalExpectedMonthly,
        },
        todayTrips: {
          totalAssigned: activeStudents.length,
          pickupBoarded,
          pickupDropped,
          returnBoarded,
          returnDropped,
          absentToday,
        },
        monthlyFinance: {
          billed: monthBilled,
          collected: monthCollected,
          due: monthDue,
          expense: monthExpenseTotal,
          balance: monthCollected - monthExpenseTotal,
        },
        expiryAlerts,
        constants: {
          VEHICLE_TYPES,
          EXPENSE_CATEGORIES,
          TRIP_TYPES,
        },
      },
    });
  } catch (error) {
    console.error("Transport Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   2. VEHICLES MANAGEMENT
========================= */

const getVehicles = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { status, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (status && status !== "all") query.status = status;
    if (search) {
      query.$or = [
        { vehicle_no: { $regex: search, $options: "i" } },
        { vehicle_name: { $regex: search, $options: "i" } },
        { driver_name: { $regex: search, $options: "i" } },
        { driver_phone: { $regex: search, $options: "i" } },
      ];
    }

    const [vehicles, routes] = await Promise.all([
      db.collection("transport_vehicles").find(query).sort({ created_at: -1 }).toArray(),
      db.collection("transport_routes").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const routeCountMap = new Map();
    routes.forEach((r) => {
      if (r.vehicle_id) {
        const key = r.vehicle_id.toString();
        routeCountMap.set(key, (routeCountMap.get(key) || 0) + 1);
      }
    });

    const enriched = vehicles.map((v) => ({
      ...v,
      assigned_routes_count: routeCountMap.get(v._id.toString()) || 0,
    }));

    res.status(200).json({ success: true, data: enriched, vehicleTypes: VEHICLE_TYPES });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createVehicle = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const existing = await db.collection("transport_vehicles").findOne({
      madrasa_id: madrasaFilter,
      vehicle_no: req.body.vehicle_no,
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "এই গাড়ির নম্বরটি আগেই যুক্ত করা হয়েছে" });
    }

    const doc = {
      ...req.body,
      madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
      seat_capacity: Number(req.body.seat_capacity || 14),
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const result = await db.collection("transport_vehicles").insertOne(doc);
    res.status(201).json({
      success: true,
      message: "গাড়ি ও ড্রাইভারের তথ্য সংরক্ষিত হয়েছে",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateVehicle = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle ID" });
    }

    const existing = await db.collection("transport_vehicles").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "গাড়ি খুঁজে পাওয়া যায়নি" });
    }

    const updateDoc = {
      ...req.body,
      seat_capacity: Number(req.body.seat_capacity ?? existing.seat_capacity),
      updated_at: Date.now(),
    };

    await db.collection("transport_vehicles").updateOne({ _id: existing._id }, { $set: updateDoc });

    // Sync vehicle_no on routes and transport_students
    if (req.body.vehicle_no && req.body.vehicle_no !== existing.vehicle_no) {
      await Promise.all([
        db.collection("transport_routes").updateMany(
          { madrasa_id: madrasaFilter, vehicle_id: existing._id.toString() },
          { $set: { vehicle_no: req.body.vehicle_no, updated_at: Date.now() } }
        ),
        db.collection("transport_students").updateMany(
          { madrasa_id: madrasaFilter, vehicle_id: existing._id.toString() },
          { $set: { vehicle_no: req.body.vehicle_no, updated_at: Date.now() } }
        ),
      ]);
    }

    res.status(200).json({ success: true, message: "গাড়ির তথ্য আপডেট হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const result = await db.collection("transport_vehicles").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "গাড়ি পাওয়া যায়নি" });
    }

    // Detach from routes
    await db.collection("transport_routes").updateMany(
      { madrasa_id: madrasaFilter, vehicle_id: req.params.id },
      { $set: { vehicle_id: "", vehicle_no: "", updated_at: Date.now() } }
    );

    res.status(200).json({ success: true, message: "গাড়ি তালিকা থেকে মুছে ফেলা হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   3. ROUTES & STOPPAGES
========================= */

const getRoutes = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { status, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (status && status !== "all") query.status = status;
    if (search) {
      query.$or = [
        { route_name: { $regex: search, $options: "i" } },
        { route_code: { $regex: search, $options: "i" } },
        { start_point: { $regex: search, $options: "i" } },
        { end_point: { $regex: search, $options: "i" } },
      ];
    }

    const [routes, vehicles, transportStudents] = await Promise.all([
      db.collection("transport_routes").find(query).sort({ created_at: -1 }).toArray(),
      db.collection("transport_vehicles").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_students").find({ madrasa_id: madrasaFilter, status: "Active" }).toArray(),
    ]);

    const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));
    const studentCountMap = new Map();
    transportStudents.forEach((s) => {
      if (s.route_id) {
        const key = s.route_id.toString();
        studentCountMap.set(key, (studentCountMap.get(key) || 0) + 1);
      }
    });

    const enriched = routes.map((r) => {
      const veh = r.vehicle_id ? vehicleMap.get(r.vehicle_id.toString()) : null;
      return {
        ...r,
        vehicle_no: veh?.vehicle_no || r.vehicle_no || "",
        vehicle_name: veh?.vehicle_name || "",
        vehicle_type: veh?.vehicle_type || "",
        seat_capacity: veh?.seat_capacity || 0,
        driver_name: veh?.driver_name || "",
        driver_phone: veh?.driver_phone || "",
        assigned_students_count: studentCountMap.get(r._id.toString()) || 0,
      };
    });

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createRoute = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    let vehicleNo = "";
    if (req.body.vehicle_id && ObjectId.isValid(req.body.vehicle_id)) {
      const veh = await db.collection("transport_vehicles").findOne({
        _id: new ObjectId(req.body.vehicle_id),
        madrasa_id: madrasaFilter,
      });
      if (veh) vehicleNo = veh.vehicle_no;
    }

    const doc = {
      ...req.body,
      madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
      vehicle_no: vehicleNo,
      default_fee: Number(req.body.default_fee || 0),
      stops: (req.body.stops || []).map((s) => ({
        ...s,
        monthly_fee: Number(s.monthly_fee ?? req.body.default_fee ?? 0),
      })),
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const result = await db.collection("transport_routes").insertOne(doc);
    res.status(201).json({
      success: true,
      message: "নতুন রুট ও স্টপেজ সংরক্ষিত হয়েছে",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateRoute = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid route ID" });
    }

    const existing = await db.collection("transport_routes").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "রুট খুঁজে পাওয়া যায়নি" });
    }

    let vehicleNo = "";
    const nextVehicleId = req.body.vehicle_id !== undefined ? req.body.vehicle_id : existing.vehicle_id;
    if (nextVehicleId && ObjectId.isValid(nextVehicleId)) {
      const veh = await db.collection("transport_vehicles").findOne({
        _id: new ObjectId(nextVehicleId),
        madrasa_id: madrasaFilter,
      });
      if (veh) vehicleNo = veh.vehicle_no;
    }

    const updateDoc = {
      ...req.body,
      vehicle_id: nextVehicleId || "",
      vehicle_no: vehicleNo,
      default_fee: Number(req.body.default_fee ?? existing.default_fee ?? 0),
      stops: Array.isArray(req.body.stops)
        ? req.body.stops.map((s) => ({
            ...s,
            monthly_fee: Number(s.monthly_fee ?? req.body.default_fee ?? 0),
          }))
        : existing.stops,
      updated_at: Date.now(),
    };

    await db.collection("transport_routes").updateOne({ _id: existing._id }, { $set: updateDoc });

    // Sync route_name & vehicle info on assigned students
    await db.collection("transport_students").updateMany(
      { madrasa_id: madrasaFilter, route_id: existing._id.toString() },
      {
        $set: {
          route_name: updateDoc.route_name || existing.route_name,
          vehicle_id: updateDoc.vehicle_id,
          vehicle_no: updateDoc.vehicle_no,
          updated_at: Date.now(),
        },
      }
    );

    res.status(200).json({ success: true, message: "রুটের তথ্য আপডেট হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteRoute = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const result = await db.collection("transport_routes").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "রুট পাওয়া যায়নি" });
    }

    res.status(200).json({ success: true, message: "রুট মুছে ফেলা হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   4. STUDENT TRANSPORT ASSIGNMENT
========================= */

const getAdmissionStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { filter = "all", search = "" } = req.query;

    const query = {
      madrasa_id: madrasaFilter,
      admissionStatus: { $in: ["Active", "active", null] },
    };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { student_id: { $regex: search, $options: "i" } },
        { roll_number: { $regex: search, $options: "i" } },
      ];
    }

    const [students, classes, sections, parents, enrolledTransport] = await Promise.all([
      db.collection("students").find(query).sort({ created_at: -1 }).toArray(),
      db.collection("classes").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("sections").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("parents").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_students").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const classMap = new Map(classes.map((c) => [c._id.toString(), c.name]));
    const sectionMap = new Map(sections.map((s) => [s._id.toString(), s.name]));
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));
    const enrolledMap = new Map(enrolledTransport.map((t) => [t.student_id.toString(), t]));

    let formatted = students.map((st) => {
      const guardian = st.guardian_id ? parentMap.get(st.guardian_id.toString()) : null;
      const transportRec = enrolledMap.get(st._id.toString()) || null;

      return {
        _id: st._id,
        student_code: st.student_id || "",
        roll_number: st.roll_number || "",
        name: `${st.firstName || ""} ${st.lastName || ""}`.trim(),
        class_name: st.class_id ? classMap.get(st.class_id.toString()) || "N/A" : "N/A",
        section_name: st.section_id ? sectionMap.get(st.section_id.toString()) || "" : "",
        guardian_name: guardian?.fatherName || "",
        guardian_contact: guardian?.contact || st.phone || "",
        address: guardian?.address || "",
        transport_required: Boolean(st.transport?.required),
        admission_route: st.transport?.route || "",
        is_enrolled: Boolean(transportRec),
        transport_status: transportRec?.status || null,
        route_name: transportRec?.route_name || "",
        stoppage: transportRec?.stoppage || "",
      };
    });

    if (filter === "transport-required") {
      formatted = formatted.filter((s) => s.transport_required);
    } else if (filter === "not-enrolled") {
      formatted = formatted.filter((s) => !s.is_enrolled);
    }

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTransportStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { route_id, status, class_name, trip_type, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (route_id && route_id !== "all") query.route_id = route_id;
    if (status && status !== "all") query.status = status;
    if (class_name && class_name !== "all") query.class_name = class_name;
    if (trip_type && trip_type !== "all") query.trip_type = trip_type;
    if (search) {
      query.$or = [
        { student_name: { $regex: search, $options: "i" } },
        { student_code: { $regex: search, $options: "i" } },
        { roll_number: { $regex: search, $options: "i" } },
        { route_name: { $regex: search, $options: "i" } },
        { stoppage: { $regex: search, $options: "i" } },
        { guardian_contact: { $regex: search, $options: "i" } },
      ];
    }

    const students = await db
      .collection("transport_students")
      .find(query)
      .sort({ created_at: -1 })
      .toArray();

    res.status(200).json({ success: true, data: students, tripTypes: TRIP_TYPES });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const enrollTransportStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const { isUpdated, ...doc } = await upsertTransportStudent(db, req.user.madrasa_id, req.body);

    res.status(isUpdated ? 200 : 201).json({
      success: true,
      message: isUpdated ? "ছাত্রের ট্রান্সপোর্ট তথ্য আপডেট হয়েছে" : "ছাত্রটি ট্রান্সপোর্টে যুক্ত হয়েছে",
      data: doc,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const bulkEnrollTransportStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const { student_ids, route_id, stoppage, trip_type, monthly_fee, waiver_percent } = req.body;

    let count = 0;
    for (const student_id of student_ids) {
      await upsertTransportStudent(db, req.user.madrasa_id, {
        student_id,
        route_id,
        stoppage,
        trip_type,
        monthly_fee,
        waiver_percent,
        status: "Active",
      });
      count++;
    }

    res.status(201).json({
      success: true,
      message: `${count} জন ছাত্র ট্রান্সপোর্টে যুক্ত হয়েছে`,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateTransportStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const existing = await db.collection("transport_students").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "ট্রান্সপোর্ট ছাত্র পাওয়া যায়নি" });
    }

    const merged = {
      student_id: existing.student_id,
      route_id: req.body.route_id ?? existing.route_id,
      route_name: req.body.route_name ?? existing.route_name,
      stoppage: req.body.stoppage ?? existing.stoppage,
      pickup_address: req.body.pickup_address ?? existing.address,
      trip_type: req.body.trip_type || existing.trip_type,
      monthly_fee: req.body.monthly_fee ?? existing.monthly_fee,
      waiver_percent: req.body.waiver_percent ?? existing.waiver_percent,
      status: req.body.status || existing.status,
      note: req.body.note ?? existing.note,
    };

    const doc = await buildTransportStudentDoc(db, req.user.madrasa_id, merged);
    await db.collection("transport_students").updateOne({ _id: existing._id }, { $set: doc });

    res.status(200).json({
      success: true,
      message: "ছাত্রের ট্রান্সপোর্ট তথ্য আপডেট হয়েছে",
      data: { _id: existing._id, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteTransportStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const result = await db.collection("transport_students").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "তথ্য পাওয়া যায়নি" });
    }

    res.status(200).json({ success: true, message: "ট্রান্সপোর্ট থেকে ছাত্র সরানো হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   5. DAILY PICKUP & DROP TRIP LOG
========================= */

const getDailyTrips = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const date = req.query.date || getBangladeshDateStr();
    const { route_id, search } = req.query;

    const studentQuery = { madrasa_id: madrasaFilter, status: "Active" };
    if (route_id && route_id !== "all") studentQuery.route_id = route_id;
    if (search) {
      studentQuery.$or = [
        { student_name: { $regex: search, $options: "i" } },
        { student_code: { $regex: search, $options: "i" } },
        { stoppage: { $regex: search, $options: "i" } },
      ];
    }

    const [activeStudents, logs, routes] = await Promise.all([
      db.collection("transport_students").find(studentQuery).sort({ route_name: 1, student_name: 1 }).toArray(),
      db.collection("transport_daily_logs").find({ madrasa_id: madrasaFilter, date }).toArray(),
      db.collection("transport_routes").find({ madrasa_id: madrasaFilter, status: "Active" }).toArray(),
    ]);

    const logMap = new Map(logs.map((l) => [l.student_id.toString(), l]));

    const roster = activeStudents.map((st) => {
      const log = logMap.get(st.student_id.toString());
      return {
        _id: st._id,
        student_id: st.student_id,
        student_code: st.student_code,
        student_name: st.student_name,
        roll_number: st.roll_number,
        class_name: st.class_name,
        guardian_contact: st.guardian_contact,
        route_id: st.route_id,
        route_name: st.route_name,
        vehicle_no: st.vehicle_no,
        stoppage: st.stoppage,
        trip_type: st.trip_type,
        pickup_status: log?.pickup_status || "pending",
        pickup_time: log?.pickup_time || "",
        return_status: log?.return_status || "pending",
        return_time: log?.return_time || "",
        note: log?.note || "",
      };
    });

    const summary = roster.reduce(
      (acc, r) => {
        acc.total++;
        if (r.pickup_status === "boarded") acc.pickupBoarded++;
        if (r.pickup_status === "dropped") acc.pickupDropped++;
        if (r.pickup_status === "absent") acc.pickupAbsent++;
        if (r.return_status === "boarded") acc.returnBoarded++;
        if (r.return_status === "dropped") acc.returnDropped++;
        if (r.return_status === "absent") acc.returnAbsent++;
        return acc;
      },
      {
        total: 0,
        pickupBoarded: 0,
        pickupDropped: 0,
        pickupAbsent: 0,
        returnBoarded: 0,
        returnDropped: 0,
        returnAbsent: 0,
      }
    );

    res.status(200).json({
      success: true,
      data: {
        date,
        roster,
        routes,
        summary,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateDailyTripStatus = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { date, student_id, trip, status, note } = req.body;

    const student = await db.collection("transport_students").findOne({
      madrasa_id: madrasaFilter,
      student_id: student_id.toString(),
    });
    if (!student) {
      return res.status(404).json({ success: false, message: "ছাত্র ট্রান্সপোর্টে পাওয়া যায়নি" });
    }

    const timeNow = status === "pending" ? "" : getBangladeshTimeStr();
    const updateFields = {
      [`${trip}_status`]: status,
      [`${trip}_time`]: timeNow,
      updated_at: Date.now(),
    };
    if (note !== undefined) updateFields.note = note;

    const existing = await db.collection("transport_daily_logs").findOne({
      madrasa_id: madrasaFilter,
      date,
      student_id: student_id.toString(),
    });

    if (existing) {
      await db.collection("transport_daily_logs").updateOne({ _id: existing._id }, { $set: updateFields });
    } else {
      await db.collection("transport_daily_logs").insertOne({
        madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
        date,
        student_id: student_id.toString(),
        route_id: student.route_id || "",
        pickup_status: "pending",
        pickup_time: "",
        return_status: "pending",
        return_time: "",
        note: "",
        ...updateFields,
        created_at: Date.now(),
      });
    }

    res.status(200).json({ success: true, message: "ট্রিপ স্ট্যাটাস আপডেট হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const bulkUpdateDailyTripStatus = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { date, route_id, trip, status, student_ids } = req.body;

    const studentQuery = { madrasa_id: madrasaFilter, status: "Active" };
    if (route_id && route_id !== "all") studentQuery.route_id = route_id;
    if (student_ids && student_ids.length > 0) studentQuery.student_id = { $in: student_ids };

    const students = await db.collection("transport_students").find(studentQuery).toArray();
    const existingLogs = await db.collection("transport_daily_logs").find({ madrasa_id: madrasaFilter, date }).toArray();
    const logMap = new Map(existingLogs.map((l) => [l.student_id.toString(), l]));

    const timeNow = status === "pending" ? "" : getBangladeshTimeStr();
    const ops = [];

    for (const st of students) {
      const existing = logMap.get(st.student_id.toString());
      const fields = {
        [`${trip}_status`]: status,
        [`${trip}_time`]: timeNow,
        updated_at: Date.now(),
      };
      if (existing) {
        ops.push({
          updateOne: { filter: { _id: existing._id }, update: { $set: fields } },
        });
      } else {
        ops.push({
          insertOne: {
            document: {
              madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
              date,
              student_id: st.student_id.toString(),
              route_id: st.route_id || "",
              pickup_status: "pending",
              pickup_time: "",
              return_status: "pending",
              return_time: "",
              note: "",
              ...fields,
              created_at: Date.now(),
            },
          },
        });
      }
    }

    if (ops.length > 0) {
      await db.collection("transport_daily_logs").bulkWrite(ops);
    }

    res.status(200).json({ success: true, message: `${ops.length} জন ছাত্রের স্ট্যাটাস আপডেট হয়েছে` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   6. FUEL & MAINTENANCE EXPENSES
========================= */

const getExpenses = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { month, vehicle_id, category, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (month) query.date = new RegExp(`^${month}-`);
    if (vehicle_id && vehicle_id !== "all") query.vehicle_id = vehicle_id;
    if (category && category !== "all") query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { vehicle_no: { $regex: search, $options: "i" } },
        { paid_by: { $regex: search, $options: "i" } },
      ];
    }

    const [expenses, vehicles, accounts] = await Promise.all([
      db.collection("transport_expenses").find(query).sort({ date: -1, created_at: -1 }).toArray(),
      db.collection("transport_vehicles").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("accounts").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const summary = expenses.reduce(
      (acc, item) => {
        const amt = Number(item.amount || 0);
        acc.total += amt;
        if (item.category === "Fuel") acc.fuel += amt;
        else if (item.category === "Maintenance") acc.maintenance += amt;
        else if (item.category === "Driver Allowance") acc.allowance += amt;
        else acc.other += amt;
        return acc;
      },
      { total: 0, fuel: 0, maintenance: 0, allowance: 0, other: 0 }
    );

    res.status(200).json({
      success: true,
      data: expenses,
      summary,
      vehicles,
      accounts,
      categories: EXPENSE_CATEGORIES,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createExpense = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const amount = Number(req.body.amount);

    let vehicleNo = "";
    if (req.body.vehicle_id && ObjectId.isValid(req.body.vehicle_id)) {
      const veh = await db.collection("transport_vehicles").findOne({
        _id: new ObjectId(req.body.vehicle_id),
        madrasa_id: madrasaFilter,
      });
      if (veh) vehicleNo = veh.vehicle_no;
    }

    let transactionId = null;
    if (req.body.account_id && ObjectId.isValid(req.body.account_id)) {
      const account = await db.collection("accounts").findOne({
        _id: new ObjectId(req.body.account_id),
        madrasa_id: madrasaFilter,
      });
      if (!account) {
        return res.status(404).json({ success: false, message: "নির্বাচিত অ্যাকাউন্ট পাওয়া যায়নি" });
      }
      if (Number(account.balance || 0) < amount) {
        return res.status(400).json({
          success: false,
          message: `অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই (বর্তমান ব্যালেন্স: ৳ ${account.balance || 0})`,
        });
      }

      const txRes = await db.collection("transactions").insertOne({
        madrasa_id: req.user.madrasa_id,
        type: "Expense",
        category: "Transport Expense",
        account_id: account._id.toString(),
        account_name: account.name || "Cash",
        amount,
        description: `Transport (${req.body.category}): ${req.body.title}${vehicleNo ? ` [${vehicleNo}]` : ""}`,
        date: new Date(req.body.date),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      transactionId = txRes.insertedId.toString();
      await db.collection("accounts").updateOne({ _id: account._id }, { $inc: { balance: -amount } });
    }

    const doc = {
      madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
      date: req.body.date,
      vehicle_id: req.body.vehicle_id || "",
      vehicle_no: vehicleNo,
      category: req.body.category,
      title: req.body.title,
      quantity: req.body.quantity !== undefined && req.body.quantity !== "" ? Number(req.body.quantity) : null,
      unit: req.body.unit || "",
      odometer_km: req.body.odometer_km !== undefined && req.body.odometer_km !== "" ? Number(req.body.odometer_km) : null,
      amount,
      paid_by: req.body.paid_by || "",
      account_id: req.body.account_id || "",
      transaction_id: transactionId,
      notes: req.body.notes || "",
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const result = await db.collection("transport_expenses").insertOne(doc);
    res.status(201).json({
      success: true,
      message: "পরিবহন খরচ সংরক্ষিত হয়েছে",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const existing = await db.collection("transport_expenses").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "খরচের এন্ট্রি পাওয়া যায়নি" });
    }

    if (existing.transaction_id && ObjectId.isValid(existing.transaction_id)) {
      await db.collection("transactions").deleteOne({ _id: new ObjectId(existing.transaction_id) });
      if (existing.account_id && ObjectId.isValid(existing.account_id)) {
        await db.collection("accounts").updateOne(
          { _id: new ObjectId(existing.account_id) },
          { $inc: { balance: Number(existing.amount || 0) } }
        );
      }
    }

    await db.collection("transport_expenses").deleteOne({ _id: existing._id });
    res.status(200).json({ success: true, message: "খরচের এন্ট্রি মুছে ফেলা হয়েছে" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   7. MONTHLY BILLING & FEE COLLECTION
========================= */

const getBills = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const month = req.query.month || getBangladeshMonthStr();
    const route_id = req.query.route_id;
    const monthRegex = new RegExp(`^${month}-`);

    const billQuery = { madrasa_id: madrasaFilter, month };
    if (route_id && route_id !== "all") billQuery.route_id = route_id;

    const [bills, allMonthBills, expenses, accounts, routes] = await Promise.all([
      db.collection("transport_bills").find(billQuery).sort({ student_name: 1 }).toArray(),
      db.collection("transport_bills").find({ madrasa_id: madrasaFilter, month }).toArray(),
      db.collection("transport_expenses").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
      db.collection("accounts").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("transport_routes").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const totalBilled = allMonthBills.reduce((s, b) => s + Number(b.net_payable || 0), 0);
    const totalCollected = allMonthBills.reduce((s, b) => s + Number(b.paid_amount || 0), 0);
    const totalDue = allMonthBills.reduce((s, b) => s + Number(b.due_amount || 0), 0);
    const totalExpense = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    res.status(200).json({
      success: true,
      data: bills,
      metrics: {
        month,
        totalBilled,
        totalCollected,
        totalDue,
        totalExpense,
        netBalance: totalCollected - totalExpense,
      },
      accounts,
      routes,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const generateMonthlyBills = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);
    const { month } = req.body;

    const activeStudents = await db
      .collection("transport_students")
      .find({ madrasa_id: madrasaFilter, status: "Active" })
      .toArray();

    if (activeStudents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "বিল জেনারেট করার জন্য কোনো সক্রিয় ট্রান্সপোর্ট ছাত্র পাওয়া যায়নি।",
      });
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const st of activeStudents) {
      const grossAmount = Number(st.monthly_fee || 0);
      const waiverPercent = Number(st.waiver_percent || 0);
      const waiverAmount = Math.round(grossAmount * (waiverPercent / 100));
      const netPayable = Math.max(0, grossAmount - waiverAmount);

      const existing = await db.collection("transport_bills").findOne({
        madrasa_id: madrasaFilter,
        month,
        student_id: st.student_id.toString(),
      });

      if (existing) {
        if (existing.status === "Paid") continue;
        const paid = Number(existing.paid_amount || 0);
        const due = Math.max(0, netPayable - paid);
        const status = netPayable === 0 || due === 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";

        await db.collection("transport_bills").updateOne(
          { _id: existing._id },
          {
            $set: {
              route_id: st.route_id,
              route_name: st.route_name,
              stoppage: st.stoppage,
              vehicle_no: st.vehicle_no,
              gross_amount: grossAmount,
              waiver_percent: waiverPercent,
              waiver_amount: waiverAmount,
              net_payable: netPayable,
              due_amount: due,
              status,
              updated_at: Date.now(),
            },
          }
        );
        updatedCount++;
      } else {
        const status = netPayable === 0 ? "Paid" : "Unpaid";
        await db.collection("transport_bills").insertOne({
          madrasa_id: madrasaObjId,
          month,
          transport_student_id: st._id.toString(),
          student_id: st.student_id.toString(),
          student_code: st.student_code,
          student_name: st.student_name,
          roll_number: st.roll_number,
          class_name: st.class_name,
          route_id: st.route_id,
          route_name: st.route_name,
          stoppage: st.stoppage,
          vehicle_no: st.vehicle_no,
          trip_type: st.trip_type,
          gross_amount: grossAmount,
          waiver_percent: waiverPercent,
          waiver_amount: waiverAmount,
          net_payable: netPayable,
          paid_amount: 0,
          due_amount: netPayable,
          status,
          payment_history: [],
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        createdCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `${month} মাসের ট্রান্সপোর্ট বিল জেনারেট সম্পন্ন (${createdCount}টি নতুন, ${updatedCount}টি আপডেট)`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const collectBillPayment = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid bill ID" });
    }

    const bill = await db.collection("transport_bills").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (!bill) {
      return res.status(404).json({ success: false, message: "বিল খুঁজে পাওয়া যায়নি" });
    }

    const payAmount = Number(req.body.paid_amount);
    const prevPaid = Number(bill.paid_amount || 0);
    const newPaid = prevPaid + payAmount;
    const due = Math.max(0, Number(bill.net_payable || 0) - newPaid);
    const status = due <= 0 ? "Paid" : "Partial";
    const receiptNo = `TRN-${Date.now().toString().slice(-6)}`;

    let account = null;
    if (req.body.account_id && ObjectId.isValid(req.body.account_id)) {
      account = await db.collection("accounts").findOne({
        _id: new ObjectId(req.body.account_id),
        madrasa_id: madrasaFilter,
      });
    }
    if (!account) {
      account = await db.collection("accounts").findOne({ madrasa_id: madrasaFilter, type: "Cash" });
    }

    if (account) {
      await db.collection("transactions").insertOne({
        madrasa_id: req.user.madrasa_id,
        type: "Income",
        category: "Transport Fee",
        account_id: account._id.toString(),
        account_name: account.name || "Cash",
        amount: payAmount,
        payment_method: req.body.payment_method || "Cash",
        receipt_no: receiptNo,
        description: `Transport Fee (${bill.month}) - ${bill.student_name} [${bill.route_name || ""}]`,
        reference_id: bill.student_id,
        student_id: bill.student_code || bill.student_id,
        student_name: bill.student_name,
        date: new Date(),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      await db.collection("accounts").updateOne({ _id: account._id }, { $inc: { balance: payAmount } });
    }

    await db.collection("transport_bills").updateOne(
      { _id: bill._id },
      {
        $set: {
          paid_amount: newPaid,
          due_amount: due,
          status,
          last_receipt_no: receiptNo,
          last_payment_date: new Date(),
          updated_at: Date.now(),
        },
        $push: {
          payment_history: {
            amount: payAmount,
            payment_method: req.body.payment_method || "Cash",
            receipt_no: receiptNo,
            remarks: req.body.remarks || "",
            date: new Date(),
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: `৳ ${payAmount} ট্রান্সপোর্ট ফি আদায় সফল হয়েছে (${receiptNo})`,
      data: { receipt_no: receiptNo, status, paid_amount: newPaid, due_amount: due },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   ROUTE DEFINITIONS
========================= */

router.get("/dashboard", rbacMiddleware(allowedRoles), getDashboard);

router.get("/vehicles", rbacMiddleware(allowedRoles), getVehicles);
router.post("/vehicles", rbacMiddleware(allowedRoles), validate(vehicleSchema), createVehicle);
router.put("/vehicles/:id", rbacMiddleware(allowedRoles), validate(vehicleSchema), updateVehicle);
router.delete("/vehicles/:id", rbacMiddleware(allowedRoles), deleteVehicle);

router.get("/routes", rbacMiddleware(allowedRoles), getRoutes);
router.post("/routes", rbacMiddleware(allowedRoles), validate(routeSchema), createRoute);
router.put("/routes/:id", rbacMiddleware(allowedRoles), validate(routeSchema), updateRoute);
router.delete("/routes/:id", rbacMiddleware(allowedRoles), deleteRoute);

router.get("/admission-students", rbacMiddleware(allowedRoles), getAdmissionStudents);
router.get("/students", rbacMiddleware(allowedRoles), getTransportStudents);
router.post("/students", rbacMiddleware(allowedRoles), validate(enrollStudentSchema), enrollTransportStudent);
router.post("/students/bulk", rbacMiddleware(allowedRoles), validate(bulkEnrollSchema), bulkEnrollTransportStudents);
router.put("/students/:id", rbacMiddleware(allowedRoles), updateTransportStudent);
router.delete("/students/:id", rbacMiddleware(allowedRoles), deleteTransportStudent);

router.get("/daily-trips", rbacMiddleware(allowedRoles), getDailyTrips);
router.patch("/daily-trips/status", rbacMiddleware(allowedRoles), validate(dailyTripStatusSchema), updateDailyTripStatus);
router.post("/daily-trips/bulk-status", rbacMiddleware(allowedRoles), validate(bulkDailyTripSchema), bulkUpdateDailyTripStatus);

router.get("/expenses", rbacMiddleware(allowedRoles), getExpenses);
router.post("/expenses", rbacMiddleware(allowedRoles), validate(expenseSchema), createExpense);
router.delete("/expenses/:id", rbacMiddleware(allowedRoles), deleteExpense);

router.get("/bills", rbacMiddleware(allowedRoles), getBills);
router.post("/bills/generate", rbacMiddleware(allowedRoles), validate(generateBillsSchema), generateMonthlyBills);
router.post("/bills/:id/collect", rbacMiddleware(allowedRoles), validate(collectBillSchema), collectBillPayment);

module.exports = router;
