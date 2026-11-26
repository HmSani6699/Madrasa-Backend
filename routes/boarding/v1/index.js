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
  MEAL_PLANS,
  getMadrasaFilter,
  toMadrasaObjectId,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  getWeekdayName,
  ensureDefaultSchedules,
  computeNetFee,
  getPlanConfig,
  buildBoardingStudentDoc,
  upsertBoardingStudent,
} = require("./helpers");

router.use(authMiddleware);
router.use(tenantMiddleware);

const allowedRoles = ["admin", "mohtamim", "accountant", "talimat"];

/* =========================
   VALIDATION SCHEMAS
========================= */

const enrollStudentSchema = Joi.object({
  student_id: Joi.string().required(),
  residential_type: Joi.string().valid("Residential", "Non-Residential", "Lillah").required(),
  meal_plan_id: Joi.string().required(),
  meal_plan_name: Joi.string().allow("", null),
  allowed_meals: Joi.object({
    breakfast: Joi.boolean().required(),
    lunch: Joi.boolean().required(),
    dinner: Joi.boolean().required(),
  }).optional(),
  monthly_fee: Joi.number().min(0).default(0),
  waiver_percent: Joi.number().min(0).max(100).default(0),
  billing_mode: Joi.string().valid("Fixed", "MealRate").default("Fixed"),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  note: Joi.string().allow("", null),
});

const bulkEnrollSchema = Joi.object({
  student_ids: Joi.array().items(Joi.string().required()).min(1).required(),
  residential_type: Joi.string().valid("Residential", "Non-Residential", "Lillah").required(),
  meal_plan_id: Joi.string().required(),
  monthly_fee: Joi.number().min(0).default(0),
  waiver_percent: Joi.number().min(0).max(100).default(0),
  billing_mode: Joi.string().valid("Fixed", "MealRate").default("Fixed"),
});

const scheduleUpdateSchema = Joi.object({
  meal_name: Joi.string().valid("Breakfast", "Lunch", "Dinner").optional(),
  meal_name_bn: Joi.string().optional(),
  start_time: Joi.string().required(),
  end_time: Joi.string().required(),
  default_menu: Joi.string().allow("").required(),
  weekly_menu: Joi.object().optional(),
});

const toggleMealSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  student_id: Joi.string().required(),
  meal: Joi.string().valid("breakfast", "lunch", "dinner").required(),
  value: Joi.number().valid(0, 1).required(),
});

const bulkToggleSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  meal: Joi.string().valid("breakfast", "lunch", "dinner", "all").required(),
  value: Joi.number().valid(0, 1).required(),
  student_ids: Joi.array().items(Joi.string()).optional(),
});

const deliverMealSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  meal: Joi.string().valid("breakfast", "lunch", "dinner").required(),
  student_id: Joi.string().optional(),
  student_ids: Joi.array().items(Joi.string()).optional(),
  delivered: Joi.boolean().default(true),
  mark_all: Joi.boolean().default(false),
});

const guestMealSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  guest_name: Joi.string().required(),
  guest_type: Joi.string().valid("Teacher", "Guest", "Guardian").default("Guest"),
  breakfast: Joi.number().valid(0, 1).default(0),
  lunch: Joi.number().valid(0, 1).default(0),
  dinner: Joi.number().valid(0, 1).default(0),
  count: Joi.number().integer().min(1).default(1),
  note: Joi.string().allow("", null),
});

const bazarSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  item_name: Joi.string().required(),
  category: Joi.string().valid("Fresh", "Dry", "Fuel").required(),
  quantity: Joi.number().positive().required(),
  unit: Joi.string().default("kg"),
  unit_price: Joi.number().min(0).required(),
  total_cost: Joi.number().min(0).optional(),
  buyer_name: Joi.string().allow("", null),
  notes: Joi.string().allow("", null),
  add_to_inventory: Joi.boolean().default(false),
});

const inventorySchema = Joi.object({
  item_name: Joi.string().required(),
  current_stock: Joi.number().min(0).default(0),
  unit: Joi.string().default("kg"),
  min_alert_level: Joi.number().min(0).default(5),
});

const inventoryAdjustSchema = Joi.object({
  type: Joi.string().valid("in", "out").required(),
  quantity: Joi.number().positive().required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: Joi.string().allow("", null),
});

const generateBillsSchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  billing_mode: Joi.string().valid("Fixed", "MealRate", "Auto").default("Auto"),
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

    const [
      boardingStudents,
      todayLogs,
      todayGuests,
      todayBazar,
      monthBazar,
      monthLogs,
      monthGuests,
      monthBills,
      inventoryItems,
      schedules,
    ] = await Promise.all([
      db.collection("boarding_students").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("daily_meal_logs").find({ madrasa_id: madrasaFilter, date: today }).toArray(),
      db.collection("boarding_guest_meals").find({ madrasa_id: madrasaFilter, date: today }).toArray(),
      db.collection("boarding_bazar").find({ madrasa_id: madrasaFilter, date: today }).toArray(),
      db.collection("boarding_bazar").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
      db.collection("daily_meal_logs").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
      db.collection("boarding_guest_meals").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
      db.collection("boarding_bills").find({ madrasa_id: madrasaFilter, month: currentMonth }).toArray(),
      db.collection("boarding_inventory").find({ madrasa_id: madrasaFilter }).toArray(),
      ensureDefaultSchedules(db, req.user.madrasa_id),
    ]);

    const activeStudents = boardingStudents.filter((s) => s.status === "Active");
    const residentialCount = activeStudents.filter((s) => s.residential_type === "Residential").length;
    const nonResidentialCount = activeStudents.filter((s) => s.residential_type === "Non-Residential").length;
    const lillahCount = activeStudents.filter((s) => s.residential_type === "Lillah").length;

    const logByStudent = new Map(todayLogs.map((l) => [l.student_id.toString(), l]));

    let studentBreakfast = 0;
    let studentLunch = 0;
    let studentDinner = 0;
    let deliveredBreakfast = 0;
    let deliveredLunch = 0;
    let deliveredDinner = 0;

    for (const st of activeStudents) {
      const log = logByStudent.get(st.student_id.toString());
      const b = log ? Number(log.breakfast || 0) : st.allowed_meals?.breakfast ? 1 : 0;
      const l = log ? Number(log.lunch || 0) : st.allowed_meals?.lunch ? 1 : 0;
      const d = log ? Number(log.dinner || 0) : st.allowed_meals?.dinner ? 1 : 0;
      studentBreakfast += b;
      studentLunch += l;
      studentDinner += d;
      if (b && log?.breakfast_delivered) deliveredBreakfast += 1;
      if (l && log?.lunch_delivered) deliveredLunch += 1;
      if (d && log?.dinner_delivered) deliveredDinner += 1;
    }

    let guestBreakfast = 0;
    let guestLunch = 0;
    let guestDinner = 0;

    for (const g of todayGuests) {
      const qty = Number(g.count || 1);
      guestBreakfast += Number(g.breakfast || 0) * qty;
      guestLunch += Number(g.lunch || 0) * qty;
      guestDinner += Number(g.dinner || 0) * qty;
    }

    const breakfastCount = studentBreakfast + guestBreakfast;
    const lunchCount = studentLunch + guestLunch;
    const dinnerCount = studentDinner + guestDinner;

    const todayBazarCost = todayBazar.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
    const monthBazarCost = monthBazar.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
    const monthCollected = monthBills.reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);
    const monthExpected = monthBills.reduce((sum, b) => sum + Number(b.net_payable || 0), 0);

    const monthStudentMeals = monthLogs.reduce(
      (sum, l) => sum + Number(l.breakfast || 0) + Number(l.lunch || 0) + Number(l.dinner || 0),
      0
    );
    const monthGuestMeals = monthGuests.reduce((sum, g) => {
      const qty = Number(g.count || 1);
      return sum + (Number(g.breakfast || 0) + Number(g.lunch || 0) + Number(g.dinner || 0)) * qty;
    }, 0);
    const totalMealsThisMonth = monthStudentMeals + monthGuestMeals;
    const mealRate = totalMealsThisMonth > 0 ? Number((monthBazarCost / totalMealsThisMonth).toFixed(2)) : 0;

    const lowStockItems = inventoryItems.filter(
      (item) => Number(item.current_stock || 0) <= Number(item.min_alert_level || 0)
    );

    res.status(200).json({
      success: true,
      data: {
        date: today,
        month: currentMonth,
        mealsToday: {
          breakfast: breakfastCount,
          lunch: lunchCount,
          dinner: dinnerCount,
          total: breakfastCount + lunchCount + dinnerCount,
          studentBreakfast,
          studentLunch,
          studentDinner,
          guestBreakfast,
          guestLunch,
          guestDinner,
          deliveredBreakfast,
          deliveredLunch,
          deliveredDinner,
          deliveredTotal: deliveredBreakfast + deliveredLunch + deliveredDinner,
        },
        studentsSummary: {
          total: activeStudents.length,
          inactive: boardingStudents.length - activeStudents.length,
          residential: residentialCount,
          nonResidential: nonResidentialCount,
          lillah: lillahCount,
        },
        todayBazarCost,
        monthlyFinance: {
          collected: monthCollected,
          expected: monthExpected,
          bazarExpense: monthBazarCost,
          balance: monthCollected - monthBazarCost,
          totalMeals: totalMealsThisMonth,
          mealRate,
        },
        lowStockCount: lowStockItems.length,
        lowStockItems,
        schedules,
        mealPlans: MEAL_PLANS,
      },
    });
  } catch (error) {
    console.error("Boarding Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   2. STUDENT ENROLLMENT & MEAL PLANS
========================= */

const getAdmissionStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { residential_filter = "all", search = "" } = req.query;

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

    const [students, classes, sections, parents, enrolledBoarding] = await Promise.all([
      db.collection("students").find(query).sort({ created_at: -1 }).toArray(),
      db.collection("classes").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("sections").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("parents").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("boarding_students").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const classMap = new Map(classes.map((c) => [c._id.toString(), c.name]));
    const sectionMap = new Map(sections.map((s) => [s._id.toString(), s.name]));
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));
    const enrolledMap = new Map(enrolledBoarding.map((b) => [b.student_id.toString(), b]));

    let formatted = students.map((st) => {
      const isHostel = Boolean(st.hostel?.required);
      const guardian = st.guardian_id ? parentMap.get(st.guardian_id.toString()) : null;
      const boardingRecord = enrolledMap.get(st._id.toString()) || null;

      return {
        _id: st._id,
        student_code: st.student_id || "",
        roll_number: st.roll_number || "",
        name: `${st.firstName || ""} ${st.lastName || ""}`.trim(),
        class_name: st.class_id ? classMap.get(st.class_id.toString()) || "N/A" : "N/A",
        section_name: st.section_id ? sectionMap.get(st.section_id.toString()) || "" : "",
        guardian_name: guardian?.fatherName || "",
        guardian_contact: guardian?.contact || st.phone || "",
        hostel_required: isHostel,
        admission_residential_status: isHostel ? "Residential" : "Non-Residential",
        is_enrolled: Boolean(boardingRecord),
        boarding_status: boardingRecord?.status || null,
        boarding_id: boardingRecord?._id || null,
      };
    });

    if (residential_filter === "residential") {
      formatted = formatted.filter((s) => s.hostel_required);
    } else if (residential_filter === "non-residential") {
      formatted = formatted.filter((s) => !s.hostel_required);
    } else if (residential_filter === "not-enrolled") {
      formatted = formatted.filter((s) => !s.is_enrolled);
    }

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Admission Students Fetch Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBoardingStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { residential_type, status, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (residential_type && residential_type !== "all") {
      query.residential_type = residential_type;
    }
    if (status && status !== "all") {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { student_name: { $regex: search, $options: "i" } },
        { student_code: { $regex: search, $options: "i" } },
        { roll_number: { $regex: search, $options: "i" } },
        { class_name: { $regex: search, $options: "i" } },
      ];
    }

    const students = await db
      .collection("boarding_students")
      .find(query)
      .sort({ created_at: -1 })
      .toArray();

    res.status(200).json({ success: true, data: students, mealPlans: MEAL_PLANS });
  } catch (error) {
    console.error("Get Boarding Students Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const enrollBoardingStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const { isUpdated, ...doc } = await upsertBoardingStudent(db, req.user.madrasa_id, req.body);

    if (isUpdated) {
      return res.status(200).json({
        success: true,
        message: "Student boarding plan updated successfully",
        data: doc,
      });
    }

    res.status(201).json({
      success: true,
      message: "Student enrolled in boarding successfully",
      data: doc,
    });
  } catch (error) {
    console.error("Enroll Boarding Student Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const bulkEnrollBoardingStudents = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const { student_ids, residential_type, meal_plan_id, monthly_fee, waiver_percent, billing_mode } =
      req.body;

    let enrolledCount = 0;
    for (const student_id of student_ids) {
      await upsertBoardingStudent(db, req.user.madrasa_id, {
        student_id,
        residential_type,
        meal_plan_id,
        monthly_fee,
        waiver_percent,
        billing_mode,
        status: "Active",
      });
      enrolledCount++;
    }

    res.status(201).json({
      success: true,
      message: `${enrolledCount} students enrolled in boarding`,
    });
  } catch (error) {
    console.error("Bulk Enroll Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateBoardingStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid boarding student ID" });
    }

    const existing = await db.collection("boarding_students").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Boarding student not found" });
    }

    const merged = {
      student_id: existing.student_id,
      residential_type: req.body.residential_type || existing.residential_type,
      meal_plan_id: req.body.meal_plan_id || existing.meal_plan_id,
      meal_plan_name: req.body.meal_plan_name,
      allowed_meals: req.body.allowed_meals || existing.allowed_meals,
      monthly_fee: req.body.monthly_fee ?? existing.monthly_fee,
      waiver_percent: req.body.waiver_percent ?? existing.waiver_percent,
      billing_mode: req.body.billing_mode || existing.billing_mode,
      status: req.body.status || existing.status,
      note: req.body.note ?? existing.note,
    };

    const doc = await buildBoardingStudentDoc(db, req.user.madrasa_id, merged);
    await db.collection("boarding_students").updateOne({ _id: existing._id }, { $set: doc });

    res.status(200).json({
      success: true,
      message: "Boarding student updated successfully",
      data: { _id: existing._id, ...doc },
    });
  } catch (error) {
    console.error("Update Boarding Student Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteBoardingStudent = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const result = await db.collection("boarding_students").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Boarding student not found" });
    }

    res.status(200).json({ success: true, message: "Student removed from boarding" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   3. MEAL SCHEDULES & WEEKLY MENU
========================= */

const getSchedules = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const schedules = await ensureDefaultSchedules(db, req.user.madrasa_id);
    const order = { Breakfast: 1, Lunch: 2, Dinner: 3 };
    schedules.sort((a, b) => (order[a.meal_name] || 99) - (order[b.meal_name] || 99));
    res.status(200).json({ success: true, data: schedules });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateSchedule = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid schedule ID" });
    }

    const updateData = {
      ...req.body,
      updated_at: Date.now(),
    };

    const result = await db.collection("meal_schedules").updateOne(
      { _id: new ObjectId(req.params.id), madrasa_id: madrasaFilter },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Schedule not found" });
    }

    res.status(200).json({ success: true, message: "Meal schedule updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   4. DAILY MEAL ROSTER & ATTENDANCE
========================= */

const getDailyRoster = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const date = req.query.date || getBangladeshDateStr();
    const { residential_type, class_name, search } = req.query;

    const studentQuery = { madrasa_id: madrasaFilter, status: "Active" };
    if (residential_type && residential_type !== "all") {
      studentQuery.residential_type = residential_type;
    }
    if (class_name && class_name !== "all") {
      studentQuery.class_name = class_name;
    }
    if (search) {
      studentQuery.$or = [
        { student_name: { $regex: search, $options: "i" } },
        { student_code: { $regex: search, $options: "i" } },
        { roll_number: { $regex: search, $options: "i" } },
      ];
    }

    const [activeStudents, logs, guestMeals, schedules] = await Promise.all([
      db.collection("boarding_students").find(studentQuery).sort({ student_name: 1 }).toArray(),
      db.collection("daily_meal_logs").find({ madrasa_id: madrasaFilter, date }).toArray(),
      db.collection("boarding_guest_meals").find({ madrasa_id: madrasaFilter, date }).sort({ created_at: -1 }).toArray(),
      ensureDefaultSchedules(db, req.user.madrasa_id),
    ]);

    const logMap = new Map(logs.map((l) => [l.student_id.toString(), l]));

    const roster = activeStudents.map((st) => {
      const log = logMap.get(st.student_id.toString());
      const breakfast = log ? Number(log.breakfast || 0) : st.allowed_meals?.breakfast ? 1 : 0;
      const lunch = log ? Number(log.lunch || 0) : st.allowed_meals?.lunch ? 1 : 0;
      const dinner = log ? Number(log.dinner || 0) : st.allowed_meals?.dinner ? 1 : 0;

      return {
        _id: st._id,
        student_id: st.student_id,
        student_code: st.student_code,
        student_name: st.student_name,
        roll_number: st.roll_number,
        class_name: st.class_name,
        residential_type: st.residential_type,
        meal_plan_name: st.meal_plan_name,
        allowed_meals: st.allowed_meals,
        breakfast,
        lunch,
        dinner,
        breakfast_delivered: Boolean(log?.breakfast_delivered),
        lunch_delivered: Boolean(log?.lunch_delivered),
        dinner_delivered: Boolean(log?.dinner_delivered),
        guest_count: Number(log?.guest_count || 0),
      };
    });

    const summary = roster.reduce(
      (acc, r) => {
        acc.studentBreakfast += r.breakfast;
        acc.studentLunch += r.lunch;
        acc.studentDinner += r.dinner;
        if (r.breakfast && r.breakfast_delivered) acc.deliveredBreakfast += 1;
        if (r.lunch && r.lunch_delivered) acc.deliveredLunch += 1;
        if (r.dinner && r.dinner_delivered) acc.deliveredDinner += 1;
        return acc;
      },
      {
        studentBreakfast: 0,
        studentLunch: 0,
        studentDinner: 0,
        deliveredBreakfast: 0,
        deliveredLunch: 0,
        deliveredDinner: 0,
        guestBreakfast: 0,
        guestLunch: 0,
        guestDinner: 0,
      }
    );

    guestMeals.forEach((g) => {
      const qty = Number(g.count || 1);
      summary.guestBreakfast += Number(g.breakfast || 0) * qty;
      summary.guestLunch += Number(g.lunch || 0) * qty;
      summary.guestDinner += Number(g.dinner || 0) * qty;
    });

    summary.totalBreakfast = summary.studentBreakfast + summary.guestBreakfast;
    summary.totalLunch = summary.studentLunch + summary.guestLunch;
    summary.totalDinner = summary.studentDinner + summary.guestDinner;

    const weekday = getWeekdayName(date);
    const todayMenu = schedules.map((s) => ({
      meal_name: s.meal_name,
      meal_name_bn: s.meal_name_bn,
      start_time: s.start_time,
      end_time: s.end_time,
      menu: s.weekly_menu?.[weekday] || s.default_menu,
    }));

    res.status(200).json({
      success: true,
      data: {
        date,
        weekday,
        roster,
        guestMeals,
        summary,
        todayMenu,
      },
    });
  } catch (error) {
    console.error("Daily Roster Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const toggleMeal = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { date, student_id, meal, value } = req.body;

    const student = await db.collection("boarding_students").findOne({
      madrasa_id: madrasaFilter,
      student_id: student_id.toString(),
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Boarding student not found" });
    }

    const existing = await db.collection("daily_meal_logs").findOne({
      madrasa_id: madrasaFilter,
      date,
      student_id: student_id.toString(),
    });

    if (existing) {
      await db.collection("daily_meal_logs").updateOne(
        { _id: existing._id },
        {
          $set: {
            [meal]: value,
            ...(value === 0 ? { [`${meal}_delivered`]: false } : {}),
            updated_at: Date.now(),
          },
        }
      );
    } else {
      const doc = {
        madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
        date,
        student_id: student_id.toString(),
        boarding_student_id: student._id.toString(),
        breakfast: student.allowed_meals?.breakfast ? 1 : 0,
        lunch: student.allowed_meals?.lunch ? 1 : 0,
        dinner: student.allowed_meals?.dinner ? 1 : 0,
        breakfast_delivered: false,
        lunch_delivered: false,
        dinner_delivered: false,
        guest_count: 0,
        [meal]: value,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      await db.collection("daily_meal_logs").insertOne(doc);
    }

    res.status(200).json({ success: true, message: "Meal status updated" });
  } catch (error) {
    console.error("Toggle Meal Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const bulkToggleMeals = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { date, meal, value, student_ids } = req.body;

    const studentQuery = { madrasa_id: madrasaFilter, status: "Active" };
    if (student_ids && student_ids.length > 0) {
      studentQuery.student_id = { $in: student_ids };
    }

    const students = await db.collection("boarding_students").find(studentQuery).toArray();
    const existingLogs = await db
      .collection("daily_meal_logs")
      .find({ madrasa_id: madrasaFilter, date })
      .toArray();
    const logMap = new Map(existingLogs.map((l) => [l.student_id.toString(), l]));

    const ops = [];
    for (const st of students) {
      const existing = logMap.get(st.student_id.toString());
      const fields =
        meal === "all"
          ? { breakfast: value, lunch: value, dinner: value }
          : { [meal]: value };

      if (existing) {
        ops.push({
          updateOne: {
            filter: { _id: existing._id },
            update: { $set: { ...fields, updated_at: Date.now() } },
          },
        });
      } else {
        ops.push({
          insertOne: {
            document: {
              madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
              date,
              student_id: st.student_id.toString(),
              boarding_student_id: st._id.toString(),
              breakfast: st.allowed_meals?.breakfast ? 1 : 0,
              lunch: st.allowed_meals?.lunch ? 1 : 0,
              dinner: st.allowed_meals?.dinner ? 1 : 0,
              breakfast_delivered: false,
              lunch_delivered: false,
              dinner_delivered: false,
              guest_count: 0,
              ...fields,
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          },
        });
      }
    }

    if (ops.length > 0) {
      await db.collection("daily_meal_logs").bulkWrite(ops);
    }

    res.status(200).json({ success: true, message: "Bulk meal update completed" });
  } catch (error) {
    console.error("Bulk Toggle Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deliverMeals = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { date, meal, student_id, student_ids, delivered, mark_all } = req.body;
    const deliveredField = `${meal}_delivered`;

    const studentQuery = { madrasa_id: madrasaFilter, status: "Active" };
    if (Array.isArray(student_ids) && student_ids.length > 0) {
      studentQuery.student_id = { $in: student_ids.map((id) => id.toString()) };
    } else if (!mark_all && student_id) {
      studentQuery.student_id = student_id.toString();
    }

    const students = await db.collection("boarding_students").find(studentQuery).toArray();
    const existingLogs = await db
      .collection("daily_meal_logs")
      .find({ madrasa_id: madrasaFilter, date })
      .toArray();
    const logMap = new Map(existingLogs.map((l) => [l.student_id.toString(), l]));

    const ops = [];
    for (const st of students) {
      const existing = logMap.get(st.student_id.toString());
      const isMealOn = existing ? Number(existing[meal] || 0) === 1 : Boolean(st.allowed_meals?.[meal]);
      if (mark_all && !isMealOn) continue;

      if (existing) {
        ops.push({
          updateOne: {
            filter: { _id: existing._id },
            update: { $set: { [deliveredField]: delivered, updated_at: Date.now() } },
          },
        });
      } else {
        ops.push({
          insertOne: {
            document: {
              madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
              date,
              student_id: st.student_id.toString(),
              boarding_student_id: st._id.toString(),
              breakfast: st.allowed_meals?.breakfast ? 1 : 0,
              lunch: st.allowed_meals?.lunch ? 1 : 0,
              dinner: st.allowed_meals?.dinner ? 1 : 0,
              breakfast_delivered: false,
              lunch_delivered: false,
              dinner_delivered: false,
              [deliveredField]: delivered,
              guest_count: 0,
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          },
        });
      }
    }

    if (ops.length > 0) {
      await db.collection("daily_meal_logs").bulkWrite(ops);
    }

    res.status(200).json({ success: true, message: "Delivery status updated" });
  } catch (error) {
    console.error("Deliver Meals Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const addGuestMeal = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const doc = {
      ...req.body,
      madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const result = await db.collection("boarding_guest_meals").insertOne(doc);
    res.status(201).json({
      success: true,
      message: "Guest meal added",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteGuestMeal = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }
    const result = await db.collection("boarding_guest_meals").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Guest meal record not found" });
    }
    res.status(200).json({ success: true, message: "Guest meal removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   5. BAZAR & EXPENSES
========================= */

const getBazarList = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { start_date, end_date, category, month, search } = req.query;

    const query = { madrasa_id: madrasaFilter };
    if (category && category !== "all") query.category = category;
    if (month) {
      query.date = new RegExp(`^${month}-`);
    } else if (start_date && end_date) {
      query.date = { $gte: start_date, $lte: end_date };
    }
    if (search) {
      query.$or = [
        { item_name: { $regex: search, $options: "i" } },
        { buyer_name: { $regex: search, $options: "i" } },
      ];
    }

    const items = await db
      .collection("boarding_bazar")
      .find(query)
      .sort({ date: -1, created_at: -1 })
      .toArray();

    const summary = items.reduce(
      (acc, i) => {
        const cost = Number(i.total_cost || 0);
        acc.total += cost;
        if (i.category === "Fresh") acc.fresh += cost;
        if (i.category === "Dry") acc.dry += cost;
        if (i.category === "Fuel") acc.fuel += cost;
        return acc;
      },
      { total: 0, fresh: 0, dry: 0, fuel: 0 }
    );

    res.status(200).json({ success: true, data: items, summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createBazarEntry = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);

    const qty = Number(req.body.quantity);
    const unitPrice = Number(req.body.unit_price);
    const computedTotal =
      req.body.total_cost !== undefined ? Number(req.body.total_cost) : Number((qty * unitPrice).toFixed(2));

    let inventoryItemId = null;
    let addedToInventory = false;

    if (req.body.category === "Dry" && req.body.add_to_inventory) {
      const existingInv = await db.collection("boarding_inventory").findOne({
        madrasa_id: madrasaFilter,
        item_name: { $regex: `^${req.body.item_name.trim()}$`, $options: "i" },
      });

      if (existingInv) {
        await db.collection("boarding_inventory").updateOne(
          { _id: existingInv._id },
          { $inc: { current_stock: qty }, $set: { last_updated: Date.now() } }
        );
        inventoryItemId = existingInv._id.toString();
      } else {
        const newInv = {
          madrasa_id: madrasaObjId,
          item_name: req.body.item_name.trim(),
          current_stock: qty,
          unit: req.body.unit || "kg",
          min_alert_level: 5,
          last_updated: Date.now(),
          created_at: Date.now(),
        };
        const invRes = await db.collection("boarding_inventory").insertOne(newInv);
        inventoryItemId = invRes.insertedId.toString();
      }

      await db.collection("boarding_inventory_logs").insertOne({
        madrasa_id: madrasaObjId,
        inventory_id: inventoryItemId,
        item_name: req.body.item_name.trim(),
        type: "in",
        quantity: qty,
        unit: req.body.unit || "kg",
        date: req.body.date,
        note: `বাজার এন্ট্রি হতে স্টকে যোগ (${req.body.buyer_name || "Admin"})`,
        created_at: Date.now(),
      });
      addedToInventory = true;
    }

    const doc = {
      madrasa_id: madrasaObjId,
      date: req.body.date,
      item_name: req.body.item_name.trim(),
      category: req.body.category,
      quantity: qty,
      unit: req.body.unit || "kg",
      unit_price: unitPrice,
      total_cost: computedTotal,
      buyer_name: req.body.buyer_name || "",
      notes: req.body.notes || "",
      added_to_inventory: addedToInventory,
      inventory_item_id: inventoryItemId,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const result = await db.collection("boarding_bazar").insertOne(doc);
    res.status(201).json({
      success: true,
      message: addedToInventory
        ? "বাজার খরচ সংরক্ষণ এবং স্টকে যোগ করা হয়েছে"
        : "বাজার খরচ সংরক্ষণ করা হয়েছে",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    console.error("Create Bazar Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteBazarEntry = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const existing = await db.collection("boarding_bazar").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Bazar entry not found" });
    }

    if (existing.added_to_inventory && existing.inventory_item_id && ObjectId.isValid(existing.inventory_item_id)) {
      const inv = await db.collection("boarding_inventory").findOne({
        _id: new ObjectId(existing.inventory_item_id),
        madrasa_id: madrasaFilter,
      });
      if (inv) {
        const nextStock = Math.max(0, Number(inv.current_stock || 0) - Number(existing.quantity || 0));
        await db.collection("boarding_inventory").updateOne(
          { _id: inv._id },
          { $set: { current_stock: nextStock, last_updated: Date.now() } }
        );
      }
    }

    await db.collection("boarding_bazar").deleteOne({ _id: existing._id });
    res.status(200).json({ success: true, message: "Bazar entry deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   6. DRY INVENTORY & STOCK MANAGEMENT
========================= */

const getInventory = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [items, recentLogs] = await Promise.all([
      db.collection("boarding_inventory").find({ madrasa_id: madrasaFilter }).sort({ item_name: 1 }).toArray(),
      db
        .collection("boarding_inventory_logs")
        .find({ madrasa_id: madrasaFilter })
        .sort({ created_at: -1 })
        .limit(25)
        .toArray(),
    ]);

    const lowStockItems = items.filter(
      (i) => Number(i.current_stock || 0) <= Number(i.min_alert_level || 0)
    );

    res.status(200).json({
      success: true,
      data: items,
      lowStockItems,
      recentLogs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createInventoryItem = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);

    const existing = await db.collection("boarding_inventory").findOne({
      madrasa_id: madrasaFilter,
      item_name: { $regex: `^${req.body.item_name.trim()}$`, $options: "i" },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "এই নামে একটি স্টক আইটেম ইতিমধ্যেই আছে। স্টক বাড়াতে '+ স্টক' ব্যবহার করুন।",
      });
    }

    const doc = {
      madrasa_id: madrasaObjId,
      item_name: req.body.item_name.trim(),
      current_stock: Number(req.body.current_stock || 0),
      unit: req.body.unit || "kg",
      min_alert_level: Number(req.body.min_alert_level ?? 5),
      last_updated: Date.now(),
      created_at: Date.now(),
    };

    const result = await db.collection("boarding_inventory").insertOne(doc);
    if (doc.current_stock > 0) {
      await db.collection("boarding_inventory_logs").insertOne({
        madrasa_id: madrasaObjId,
        inventory_id: result.insertedId.toString(),
        item_name: doc.item_name,
        type: "in",
        quantity: doc.current_stock,
        unit: doc.unit,
        date: getBangladeshDateStr(),
        note: "প্রাথমিক স্টক এন্ট্রি",
        created_at: Date.now(),
      });
    }

    res.status(201).json({
      success: true,
      message: "Inventory item created",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateInventoryItem = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const updateFields = {
      item_name: req.body.item_name.trim(),
      unit: req.body.unit,
      min_alert_level: Number(req.body.min_alert_level ?? 5),
      last_updated: Date.now(),
    };
    if (req.body.current_stock !== undefined) {
      updateFields.current_stock = Number(req.body.current_stock);
    }

    const result = await db.collection("boarding_inventory").updateOne(
      { _id: new ObjectId(req.params.id), madrasa_id: madrasaFilter },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    res.status(200).json({ success: true, message: "Inventory item updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const adjustInventoryStock = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const item = await db.collection("boarding_inventory").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });

    if (!item) {
      return res.status(404).json({ success: false, message: "Inventory item not found" });
    }

    const qty = Number(req.body.quantity);
    const current = Number(item.current_stock || 0);
    if (req.body.type === "out" && qty > current) {
      return res.status(400).json({
        success: false,
        message: `পর্যাপ্ত স্টক নেই (বর্তমান মজুদ: ${current} ${item.unit})`,
      });
    }

    const nextStock = req.body.type === "in" ? current + qty : current - qty;

    await db.collection("boarding_inventory").updateOne(
      { _id: item._id },
      { $set: { current_stock: Number(nextStock.toFixed(2)), last_updated: Date.now() } }
    );

    await db.collection("boarding_inventory_logs").insertOne({
      madrasa_id: toMadrasaObjectId(req.user.madrasa_id),
      inventory_id: item._id.toString(),
      item_name: item.item_name,
      type: req.body.type,
      quantity: qty,
      unit: item.unit,
      date: req.body.date || getBangladeshDateStr(),
      note: req.body.note || (req.body.type === "in" ? "স্টক যোগ" : "দৈনিক রান্নায় খরচ"),
      created_at: Date.now(),
    });

    res.status(200).json({
      success: true,
      message: req.body.type === "in" ? "স্টক যোগ করা হয়েছে" : "দৈনিক খরচ বিয়োগ করা হয়েছে",
      data: { current_stock: Number(nextStock.toFixed(2)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteInventoryItem = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }
    const result = await db.collection("boarding_inventory").deleteOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }
    res.status(200).json({ success: true, message: "Inventory item deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   7. AUTO BILLING, MEAL RATE & REPORTS
========================= */

const calculateMonthMetrics = async (db, madrasaId, month) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const monthRegex = new RegExp(`^${month}-`);

  const [bazarItems, mealLogs, guestMeals, bills] = await Promise.all([
    db.collection("boarding_bazar").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
    db.collection("daily_meal_logs").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
    db.collection("boarding_guest_meals").find({ madrasa_id: madrasaFilter, date: monthRegex }).toArray(),
    db.collection("boarding_bills").find({ madrasa_id: madrasaFilter, month }).toArray(),
  ]);

  const bazarByCategory = { Fresh: 0, Dry: 0, Fuel: 0 };
  let totalBazarCost = 0;
  for (const item of bazarItems) {
    const cost = Number(item.total_cost || 0);
    totalBazarCost += cost;
    if (bazarByCategory[item.category] !== undefined) {
      bazarByCategory[item.category] += cost;
    }
  }

  const mealsPerStudent = new Map();
  let studentMeals = 0;
  for (const l of mealLogs) {
    const m = Number(l.breakfast || 0) + Number(l.lunch || 0) + Number(l.dinner || 0);
    studentMeals += m;
    const key = l.student_id.toString();
    mealsPerStudent.set(key, (mealsPerStudent.get(key) || 0) + m);
  }

  let guestMealsCount = 0;
  for (const g of guestMeals) {
    const qty = Number(g.count || 1);
    guestMealsCount += (Number(g.breakfast || 0) + Number(g.lunch || 0) + Number(g.dinner || 0)) * qty;
  }

  const totalMeals = studentMeals + guestMealsCount;
  const mealRate = totalMeals > 0 ? Number((totalBazarCost / totalMeals).toFixed(2)) : 0;

  const totalBilled = bills.reduce((sum, b) => sum + Number(b.net_payable || 0), 0);
  const totalCollected = bills.reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);
  const totalDue = bills.reduce((sum, b) => sum + Number(b.due_amount || 0), 0);

  return {
    month,
    totalBazarCost,
    bazarByCategory,
    studentMeals,
    guestMealsCount,
    totalMeals,
    mealRate,
    mealsPerStudent,
    totalBilled,
    totalCollected,
    totalDue,
    netProfitLoss: totalCollected - totalBazarCost,
  };
};

const getBills = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const month = req.query.month || getBangladeshMonthStr();

    const [bills, metrics, accounts] = await Promise.all([
      db.collection("boarding_bills").find({ madrasa_id: madrasaFilter, month }).sort({ student_name: 1 }).toArray(),
      calculateMonthMetrics(db, req.user.madrasa_id, month),
      db.collection("accounts").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    res.status(200).json({
      success: true,
      data: bills,
      metrics: {
        month: metrics.month,
        totalBazarCost: metrics.totalBazarCost,
        totalMeals: metrics.totalMeals,
        mealRate: metrics.mealRate,
        totalBilled: metrics.totalBilled,
        totalCollected: metrics.totalCollected,
        totalDue: metrics.totalDue,
      },
      accounts,
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
    const { month, billing_mode = "Auto" } = req.body;

    const [activeStudents, metrics] = await Promise.all([
      db.collection("boarding_students").find({ madrasa_id: madrasaFilter, status: "Active" }).toArray(),
      calculateMonthMetrics(db, req.user.madrasa_id, month),
    ]);

    if (activeStudents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "বিল জেনারেট করার জন্য কোনো সক্রিয় বোর্ডিং ছাত্র পাওয়া যায়নি।",
      });
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const st of activeStudents) {
      const mode = billing_mode === "Auto" ? st.billing_mode || "Fixed" : billing_mode;
      const mealCount = metrics.mealsPerStudent.get(st.student_id.toString()) || 0;
      const isLillah = st.residential_type === "Lillah" || st.meal_plan_id === "lillah_free";

      let grossAmount = 0;
      if (!isLillah) {
        grossAmount =
          mode === "MealRate"
            ? Math.round(mealCount * metrics.mealRate)
            : Number(st.monthly_fee || 0);
      }

      const waiverPercent = isLillah ? 100 : Number(st.waiver_percent || 0);
      const waiverAmount = Math.round(grossAmount * (waiverPercent / 100));
      const netPayable = Math.max(0, grossAmount - waiverAmount);

      const existing = await db.collection("boarding_bills").findOne({
        madrasa_id: madrasaFilter,
        month,
        student_id: st.student_id.toString(),
      });

      if (existing) {
        if (existing.status === "Paid") continue;
        const paid = Number(existing.paid_amount || 0);
        const due = Math.max(0, netPayable - paid);
        const status = netPayable === 0 || due === 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        await db.collection("boarding_bills").updateOne(
          { _id: existing._id },
          {
            $set: {
              billing_mode: mode,
              meal_count: mealCount,
              meal_rate: metrics.mealRate,
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
        await db.collection("boarding_bills").insertOne({
          madrasa_id: madrasaObjId,
          month,
          boarding_student_id: st._id.toString(),
          student_id: st.student_id.toString(),
          student_code: st.student_code,
          student_name: st.student_name,
          roll_number: st.roll_number,
          class_name: st.class_name,
          residential_type: st.residential_type,
          meal_plan_name: st.meal_plan_name,
          billing_mode: mode,
          meal_count: mealCount,
          meal_rate: metrics.mealRate,
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
      message: `${month} মাসের বিল জেনারেট সম্পন্ন (${createdCount}টি নতুন, ${updatedCount}টি আপডেট)`,
    });
  } catch (error) {
    console.error("Generate Bills Error:", error);
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

    const bill = await db.collection("boarding_bills").findOne({
      _id: new ObjectId(req.params.id),
      madrasa_id: madrasaFilter,
    });

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    const payAmount = Number(req.body.paid_amount);
    const prevPaid = Number(bill.paid_amount || 0);
    const newPaid = prevPaid + payAmount;
    const due = Math.max(0, Number(bill.net_payable || 0) - newPaid);
    const status = due <= 0 ? "Paid" : "Partial";
    const receiptNo = `BRD-${Date.now().toString().slice(-6)}`;

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
        category: "Boarding Fee",
        account_id: account._id.toString(),
        account_name: account.name || "Cash",
        amount: payAmount,
        payment_method: req.body.payment_method || "Cash",
        receipt_no: receiptNo,
        description: `Boarding Fee (${bill.month}) - ${bill.student_name}`,
        reference_id: bill.student_id,
        student_id: bill.student_code || bill.student_id,
        student_name: bill.student_name,
        date: new Date(),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      await db.collection("accounts").updateOne(
        { _id: account._id },
        { $inc: { balance: payAmount } }
      );
    }

    await db.collection("boarding_bills").updateOne(
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
      message: `৳ ${payAmount} বোর্ডিং ফি আদায় সফল হয়েছে (${receiptNo})`,
      data: { receipt_no: receiptNo, status, paid_amount: newPaid, due_amount: due },
    });
  } catch (error) {
    console.error("Collect Bill Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getKitchenSlip = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const date = req.query.date || getBangladeshDateStr();
    const weekday = getWeekdayName(date);

    const [activeStudents, logs, guestMeals, schedules] = await Promise.all([
      db.collection("boarding_students").find({ madrasa_id: madrasaFilter, status: "Active" }).toArray(),
      db.collection("daily_meal_logs").find({ madrasa_id: madrasaFilter, date }).toArray(),
      db.collection("boarding_guest_meals").find({ madrasa_id: madrasaFilter, date }).toArray(),
      ensureDefaultSchedules(db, req.user.madrasa_id),
    ]);

    const logMap = new Map(logs.map((l) => [l.student_id.toString(), l]));

    const counts = {
      student: { breakfast: 0, lunch: 0, dinner: 0 },
      guest: { breakfast: 0, lunch: 0, dinner: 0 },
      total: { breakfast: 0, lunch: 0, dinner: 0 },
      byType: {
        Residential: { count: 0, breakfast: 0, lunch: 0, dinner: 0 },
        "Non-Residential": { count: 0, breakfast: 0, lunch: 0, dinner: 0 },
        Lillah: { count: 0, breakfast: 0, lunch: 0, dinner: 0 },
      },
    };

    for (const st of activeStudents) {
      const log = logMap.get(st.student_id.toString());
      const b = log ? Number(log.breakfast || 0) : st.allowed_meals?.breakfast ? 1 : 0;
      const l = log ? Number(log.lunch || 0) : st.allowed_meals?.lunch ? 1 : 0;
      const d = log ? Number(log.dinner || 0) : st.allowed_meals?.dinner ? 1 : 0;

      counts.student.breakfast += b;
      counts.student.lunch += l;
      counts.student.dinner += d;

      const typeBucket = counts.byType[st.residential_type] || counts.byType.Residential;
      typeBucket.count += 1;
      typeBucket.breakfast += b;
      typeBucket.lunch += l;
      typeBucket.dinner += d;
    }

    for (const g of guestMeals) {
      const qty = Number(g.count || 1);
      counts.guest.breakfast += Number(g.breakfast || 0) * qty;
      counts.guest.lunch += Number(g.lunch || 0) * qty;
      counts.guest.dinner += Number(g.dinner || 0) * qty;
    }

    counts.total.breakfast = counts.student.breakfast + counts.guest.breakfast;
    counts.total.lunch = counts.student.lunch + counts.guest.lunch;
    counts.total.dinner = counts.student.dinner + counts.guest.dinner;

    const order = { Breakfast: 1, Lunch: 2, Dinner: 3 };
    const menuList = [...schedules]
      .sort((a, b) => (order[a.meal_name] || 99) - (order[b.meal_name] || 99))
      .map((s) => ({
        meal_name: s.meal_name,
        meal_name_bn: s.meal_name_bn,
        start_time: s.start_time,
        end_time: s.end_time,
        menu: s.weekly_menu?.[weekday] || s.default_menu,
      }));

    res.status(200).json({
      success: true,
      data: {
        date,
        weekday,
        madrasa: {
          name: req.madrasa?.name || "মাদ্রাসা বোর্ডিং বিভাগ",
          address: req.madrasa?.address || "",
          phone: req.madrasa?.phone || "",
        },
        counts,
        menuList,
        guestMeals,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMonthlyReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const month = req.query.month || getBangladeshMonthStr();
    const metrics = await calculateMonthMetrics(db, req.user.madrasa_id, month);
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const activeStudents = await db
      .collection("boarding_students")
      .find({ madrasa_id: madrasaFilter, status: "Active" })
      .toArray();

    res.status(200).json({
      success: true,
      data: {
        month: metrics.month,
        totalBazarCost: metrics.totalBazarCost,
        bazarByCategory: metrics.bazarByCategory,
        studentMeals: metrics.studentMeals,
        guestMealsCount: metrics.guestMealsCount,
        totalMeals: metrics.totalMeals,
        mealRate: metrics.mealRate,
        totalBilled: metrics.totalBilled,
        totalCollected: metrics.totalCollected,
        totalDue: metrics.totalDue,
        netProfitLoss: metrics.netProfitLoss,
        activeStudentsCount: activeStudents.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   ROUTE DEFINITIONS
========================= */

router.get("/dashboard", rbacMiddleware(allowedRoles), getDashboard);

router.get("/admission-students", rbacMiddleware(allowedRoles), getAdmissionStudents);
router.get("/students", rbacMiddleware(allowedRoles), getBoardingStudents);
router.post("/students", rbacMiddleware(allowedRoles), validate(enrollStudentSchema), enrollBoardingStudent);
router.post("/students/bulk", rbacMiddleware(allowedRoles), validate(bulkEnrollSchema), bulkEnrollBoardingStudents);
router.put("/students/:id", rbacMiddleware(allowedRoles), updateBoardingStudent);
router.delete("/students/:id", rbacMiddleware(allowedRoles), deleteBoardingStudent);

router.get("/schedules", rbacMiddleware(allowedRoles), getSchedules);
router.put("/schedules/:id", rbacMiddleware(allowedRoles), validate(scheduleUpdateSchema), updateSchedule);

router.get("/daily-roster", rbacMiddleware(allowedRoles), getDailyRoster);
router.patch("/daily-roster/toggle", rbacMiddleware(allowedRoles), validate(toggleMealSchema), toggleMeal);
router.post("/daily-roster/bulk-toggle", rbacMiddleware(allowedRoles), validate(bulkToggleSchema), bulkToggleMeals);
router.post("/daily-roster/deliver", rbacMiddleware(allowedRoles), validate(deliverMealSchema), deliverMeals);

router.post("/guest-meals", rbacMiddleware(allowedRoles), validate(guestMealSchema), addGuestMeal);
router.delete("/guest-meals/:id", rbacMiddleware(allowedRoles), deleteGuestMeal);

router.get("/bazar", rbacMiddleware(allowedRoles), getBazarList);
router.post("/bazar", rbacMiddleware(allowedRoles), validate(bazarSchema), createBazarEntry);
router.delete("/bazar/:id", rbacMiddleware(allowedRoles), deleteBazarEntry);

router.get("/inventory", rbacMiddleware(allowedRoles), getInventory);
router.post("/inventory", rbacMiddleware(allowedRoles), validate(inventorySchema), createInventoryItem);
router.put("/inventory/:id", rbacMiddleware(allowedRoles), validate(inventorySchema), updateInventoryItem);
router.post("/inventory/:id/adjust", rbacMiddleware(allowedRoles), validate(inventoryAdjustSchema), adjustInventoryStock);
router.delete("/inventory/:id", rbacMiddleware(allowedRoles), deleteInventoryItem);

router.get("/bills", rbacMiddleware(allowedRoles), getBills);
router.post("/bills/generate", rbacMiddleware(allowedRoles), validate(generateBillsSchema), generateMonthlyBills);
router.post("/bills/:id/collect", rbacMiddleware(allowedRoles), validate(collectBillSchema), collectBillPayment);

router.get("/reports/kitchen-slip", rbacMiddleware(allowedRoles), getKitchenSlip);
router.get("/reports/monthly", rbacMiddleware(allowedRoles), getMonthlyReport);

module.exports = router;
