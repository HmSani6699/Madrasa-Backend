const { ObjectId } = require("mongodb");

const MEAL_PLANS = [
  {
    id: "full_3_meals",
    name: "পূর্ণ বোর্ডিং (৩ বেলা)",
    allowed_meals: { breakfast: true, lunch: true, dinner: true },
    default_fee: 3500,
  },
  {
    id: "daycare_lunch",
    name: "ডে-কেয়ার (শুধু দুপুর)",
    allowed_meals: { breakfast: false, lunch: true, dinner: false },
    default_fee: 1500,
  },
  {
    id: "morning_lunch",
    name: "সকাল ও দুপুর (২ বেলা)",
    allowed_meals: { breakfast: true, lunch: true, dinner: false },
    default_fee: 2400,
  },
  {
    id: "lunch_dinner",
    name: "দুপুর ও রাত (২ বেলা)",
    allowed_meals: { breakfast: false, lunch: true, dinner: true },
    default_fee: 2600,
  },
  {
    id: "lillah_free",
    name: "লিল্লাহ / ফ্রি বোর্ডিং (৩ বেলা)",
    allowed_meals: { breakfast: true, lunch: true, dinner: true },
    default_fee: 0,
  },
];

const WEEKDAYS = [
  "Saturday",
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

const DEFAULT_SCHEDULES = [
  {
    meal_name: "Breakfast",
    meal_name_bn: "সকালের নাস্তা",
    start_time: "07:30",
    end_time: "08:30",
    default_menu: "রুটি / ভুনা খিচুড়ি ও ডিম",
    weekly_menu: {
      Saturday: "ভুনা খিচুড়ি ও ডিম",
      Sunday: "রুটি, সবজি ভাজি ও চা",
      Monday: "ভাত, ডাল ও আলু ভর্তা",
      Tuesday: "রুটি, ডিম ভাজি ও সবজি",
      Wednesday: "ভুনা খিচুড়ি ও আচার",
      Thursday: "রুটি, বুটের ডাল ও হালুয়া",
      Friday: "স্পেশাল খিচুড়ি ও ডিম/মাংস",
    },
  },
  {
    meal_name: "Lunch",
    meal_name_bn: "দুপুরের খাবার",
    start_time: "13:30",
    end_time: "14:30",
    default_menu: "সাদা ভাত, ডাল, সবজি ও মাছ/মাংস",
    weekly_menu: {
      Saturday: "সাদা ভাত, পাতলা ডাল ও রুই মাছ",
      Sunday: "সাদা ভাত, সবজি ও মুরগির মাংস",
      Monday: "সাদা ভাত, ডাল ও ডিম কারি",
      Tuesday: "সাদা ভাত, শাক-সবজি ও ছোট মাছ",
      Wednesday: "সাদা ভাত, ডাল ও মুরগির মাংস",
      Thursday: "সাদা ভাত, সবজি ও পাঙ্গাস/তেলাপিয়া মাছ",
      Friday: "স্পেশাল বিরিয়ানি / গরু বা খাসির মাংস",
    },
  },
  {
    meal_name: "Dinner",
    meal_name_bn: "রাতের খাবার",
    start_time: "20:30",
    end_time: "21:30",
    default_menu: "সাদা ভাত, ডাল, ভাজি ও ডিম/মাছ",
    weekly_menu: {
      Saturday: "সাদা ভাত, ডাল ও সবজি ভাজি",
      Sunday: "সাদা ভাত, ডাল ও ডিম ভুনা",
      Monday: "সাদা ভাত, সবজি ও মাছ",
      Tuesday: "সাদা ভাত, মুগ ডাল ও ভর্তা",
      Wednesday: "সাদা ভাত, ডাল ও ডিম/সবজি",
      Thursday: "সাদা ভাত, সবজি ও মাছ",
      Friday: "সাদা ভাত, ডাল ও সবজি ভাজি",
    },
  },
];

const getMadrasaFilter = (madrasaId) => {
  if (!madrasaId) return madrasaId;
  return ObjectId.isValid(madrasaId)
    ? { $in: [madrasaId.toString(), new ObjectId(madrasaId)] }
    : madrasaId;
};

const toMadrasaObjectId = (madrasaId) => {
  if (!madrasaId) return null;
  return ObjectId.isValid(madrasaId) ? new ObjectId(madrasaId) : madrasaId;
};

const getBangladeshDateStr = (dateInput = new Date()) => {
  const d = new Date(dateInput);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bdTime = new Date(utc + 6 * 3600000);
  return bdTime.toISOString().slice(0, 10);
};

const getBangladeshMonthStr = (dateInput = new Date()) => {
  return getBangladeshDateStr(dateInput).slice(0, 7);
};

const getWeekdayName = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return names[dt.getUTCDay()];
};

const ensureDefaultSchedules = async (db, madrasaId) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const existing = await db
    .collection("meal_schedules")
    .find({ madrasa_id: madrasaFilter })
    .toArray();

  if (existing.length > 0) return existing;

  const docs = DEFAULT_SCHEDULES.map((item) => ({
    ...item,
    madrasa_id: toMadrasaObjectId(madrasaId),
    created_at: Date.now(),
    updated_at: Date.now(),
  }));

  await db.collection("meal_schedules").insertMany(docs);
  return await db
    .collection("meal_schedules")
    .find({ madrasa_id: madrasaFilter })
    .toArray();
};

const computeNetFee = (monthlyFee, waiverPercent, residentialType, mealPlanId) => {
  if (residentialType === "Lillah" || mealPlanId === "lillah_free") {
    return 0;
  }
  const fee = Math.max(0, Number(monthlyFee) || 0);
  const waiver = Math.min(100, Math.max(0, Number(waiverPercent) || 0));
  return Math.max(0, Math.round(fee * (1 - waiver / 100)));
};

const getPlanConfig = (planId) => {
  return MEAL_PLANS.find((p) => p.id === planId) || MEAL_PLANS[0];
};

const BOARDING_FEE_REGEX = /boarding|hostel|বোর্ডিং|খোরাকি|হোস্টেল|আবাসিক/i;

const findBoardingFeeAmount = (fees) => {
  if (!fees || typeof fees !== "object") return null;
  for (const [key, val] of Object.entries(fees)) {
    if (BOARDING_FEE_REGEX.test(key)) {
      const parsed = Number(val);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }
  }
  return null;
};

const buildBoardingStudentDoc = async (db, madrasaId, payload) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  if (!ObjectId.isValid(payload.student_id)) {
    throw new Error("Invalid student ID");
  }

  const student = await db.collection("students").findOne({
    _id: new ObjectId(payload.student_id),
    madrasa_id: madrasaFilter,
  });

  if (!student) {
    throw new Error("Student not found in admission database");
  }

  let className = "N/A";
  let sectionName = "";
  let guardianContact = student.phone || "";

  if (student.class_id && ObjectId.isValid(student.class_id)) {
    const cls = await db.collection("classes").findOne({ _id: new ObjectId(student.class_id) });
    if (cls) className = cls.name;
  }
  if (student.section_id && ObjectId.isValid(student.section_id)) {
    const sec = await db.collection("sections").findOne({ _id: new ObjectId(student.section_id) });
    if (sec) sectionName = sec.name;
  }
  if (student.guardian_id && ObjectId.isValid(student.guardian_id)) {
    const parent = await db.collection("parents").findOne({ _id: new ObjectId(student.guardian_id) });
    if (parent) guardianContact = parent.contact || guardianContact;
  }

  const planConfig = getPlanConfig(payload.meal_plan_id);
  const allowedMeals = payload.allowed_meals || planConfig.allowed_meals;
  const mealPlanName = payload.meal_plan_name || planConfig.name;
  const effectiveWaiver =
    payload.residential_type === "Lillah" || payload.meal_plan_id === "lillah_free"
      ? 100
      : Number(payload.waiver_percent || 0);
  const monthlyFee =
    payload.residential_type === "Lillah" || payload.meal_plan_id === "lillah_free"
      ? 0
      : Number(payload.monthly_fee ?? planConfig.default_fee);
  const netMonthlyFee = computeNetFee(
    monthlyFee,
    effectiveWaiver,
    payload.residential_type,
    payload.meal_plan_id
  );

  return {
    madrasa_id: toMadrasaObjectId(madrasaId),
    student_id: student._id.toString(),
    student_code: student.student_id || "",
    student_name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
    roll_number: student.roll_number || "",
    class_name: className,
    section_name: sectionName,
    guardian_contact: guardianContact,
    residential_type: payload.residential_type,
    meal_plan_id: payload.meal_plan_id,
    meal_plan_name: mealPlanName,
    allowed_meals: allowedMeals,
    monthly_fee: monthlyFee,
    waiver_percent: effectiveWaiver,
    net_monthly_fee: netMonthlyFee,
    billing_mode: payload.billing_mode || "Fixed",
    status: payload.status || "Active",
    note: payload.note || "",
    updated_at: Date.now(),
  };
};

const upsertBoardingStudent = async (db, madrasaId, payload) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const doc = await buildBoardingStudentDoc(db, madrasaId, payload);

  const existing = await db.collection("boarding_students").findOne({
    madrasa_id: madrasaFilter,
    student_id: doc.student_id,
  });

  if (existing) {
    await db.collection("boarding_students").updateOne({ _id: existing._id }, { $set: doc });
    return { _id: existing._id, ...doc, isUpdated: true };
  }

  doc.created_at = Date.now();
  const result = await db.collection("boarding_students").insertOne(doc);
  return { _id: result.insertedId, ...doc, isUpdated: false };
};

const syncStudentBoardingFromAdmission = async (db, madrasaId, studentDoc) => {
  if (!studentDoc || !studentDoc._id) return null;
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const studentIdStr = studentDoc._id.toString();

  const boardingCfg = studentDoc.boarding;
  const feeAmount = findBoardingFeeAmount(studentDoc.fees);
  const hasExplicitBoarding = boardingCfg && typeof boardingCfg.enrolled === "boolean";

  if (hasExplicitBoarding) {
    if (!boardingCfg.enrolled) {
      await db.collection("boarding_students").updateOne(
        { madrasa_id: madrasaFilter, student_id: studentIdStr },
        { $set: { status: "Inactive", updated_at: Date.now() } }
      );
      return null;
    }

    const resType = boardingCfg.residential_type || "Residential";
    const defaultPlan =
      resType === "Lillah"
        ? "lillah_free"
        : resType === "Non-Residential"
        ? "daycare_lunch"
        : "full_3_meals";
    const planId = boardingCfg.meal_plan_id || defaultPlan;
    const planCfg = getPlanConfig(planId);
    const resolvedFee =
      resType === "Lillah" || planId === "lillah_free"
        ? 0
        : boardingCfg.monthly_fee !== undefined && boardingCfg.monthly_fee !== null
        ? Number(boardingCfg.monthly_fee)
        : feeAmount !== null
        ? feeAmount
        : planCfg.default_fee;

    return await upsertBoardingStudent(db, madrasaId, {
      student_id: studentIdStr,
      residential_type: resType,
      meal_plan_id: planId,
      monthly_fee: resolvedFee,
      waiver_percent: resType === "Lillah" ? 100 : Number(boardingCfg.waiver_percent || 0),
      billing_mode: boardingCfg.billing_mode || "Fixed",
      status: "Active",
    });
  }

  const isHostel = Boolean(studentDoc.hostel?.required);
  const hasBoardingFee = feeAmount !== null && feeAmount > 0;

  if (isHostel || hasBoardingFee) {
    return await upsertBoardingStudent(db, madrasaId, {
      student_id: studentIdStr,
      residential_type: "Residential",
      meal_plan_id: "full_3_meals",
      monthly_fee: feeAmount !== null ? feeAmount : 3500,
      waiver_percent: 0,
      billing_mode: "Fixed",
      status: "Active",
    });
  }

  return null;
};

module.exports = {
  MEAL_PLANS,
  WEEKDAYS,
  getMadrasaFilter,
  toMadrasaObjectId,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  getWeekdayName,
  ensureDefaultSchedules,
  computeNetFee,
  getPlanConfig,
  findBoardingFeeAmount,
  buildBoardingStudentDoc,
  upsertBoardingStudent,
  syncStudentBoardingFromAdmission,
};
