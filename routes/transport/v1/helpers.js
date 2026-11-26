const { ObjectId } = require("mongodb");

const VEHICLE_TYPES = [
  { value: "Bus", label: "বাস (Bus)" },
  { value: "Microbus", label: "মাইক্রোবাস (Microbus)" },
  { value: "Van", label: "স্কুল ভ্যান (Van)" },
  { value: "Auto/CNG", label: "অটো / সিএনজি (Auto/CNG)" },
  { value: "Other", label: "অন্যান্য (Other)" },
];

const EXPENSE_CATEGORIES = [
  { value: "Fuel", label: "জ্বালানি / তেল-গ্যাস (Fuel)" },
  { value: "Maintenance", label: "মেরামত ও সার্ভিসিং (Maintenance)" },
  { value: "Driver Allowance", label: "ড্রাইভার / হেল্পার ভাতা (Allowance)" },
  { value: "Toll & Parking", label: "টোল ও পার্কিং (Toll & Parking)" },
  { value: "Insurance & Tax", label: "ট্যাক্স, ফিটনেস ও ইন্স্যুরেন্স" },
  { value: "Other", label: "অন্যান্য খরচ (Other)" },
];

const TRIP_TYPES = [
  { value: "Both", label: "উভয়মুখী (যাওয়া ও আসা)" },
  { value: "Pickup", label: "শুধু আসা (Morning Pickup)" },
  { value: "Drop", label: "শুধু যাওয়া (Evening Drop)" },
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

const getBangladeshTimeStr = (dateInput = new Date()) => {
  const d = new Date(dateInput);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bdTime = new Date(utc + 6 * 3600000);
  return bdTime.toISOString().slice(11, 16);
};

const computeNetFee = (monthlyFee, waiverPercent) => {
  const fee = Math.max(0, Number(monthlyFee) || 0);
  const waiver = Math.min(100, Math.max(0, Number(waiverPercent) || 0));
  return Math.max(0, Math.round(fee * (1 - waiver / 100)));
};

const TRANSPORT_FEE_REGEX = /transport|bus|van|গাড়ি|পরিবহন|যাতায়াত/i;

const findTransportFeeAmount = (fees) => {
  if (!fees || typeof fees !== "object") return null;
  for (const [key, val] of Object.entries(fees)) {
    if (TRANSPORT_FEE_REGEX.test(key)) {
      const parsed = Number(val);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }
  }
  return null;
};

const buildTransportStudentDoc = async (db, madrasaId, payload) => {
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
  let guardianName = "";
  let guardianContact = student.phone || "";
  let guardianAddress = "";

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
    if (parent) {
      guardianName = parent.fatherName || "";
      guardianContact = parent.contact || guardianContact;
      guardianAddress = parent.address || "";
    }
  }

  let routeDoc = null;
  if (payload.route_id && ObjectId.isValid(payload.route_id)) {
    routeDoc = await db.collection("transport_routes").findOne({
      _id: new ObjectId(payload.route_id),
      madrasa_id: madrasaFilter,
    });
  } else if (payload.route_name) {
    routeDoc = await db.collection("transport_routes").findOne({
      madrasa_id: madrasaFilter,
      route_name: payload.route_name,
    });
  }

  let stoppageFee = null;
  if (routeDoc && payload.stoppage && Array.isArray(routeDoc.stops)) {
    const matchedStop = routeDoc.stops.find(
      (s) => s.stop_name?.toLowerCase() === String(payload.stoppage).trim().toLowerCase()
    );
    if (matchedStop && matchedStop.monthly_fee !== undefined && matchedStop.monthly_fee !== null) {
      stoppageFee = Number(matchedStop.monthly_fee);
    }
  }

  const rawFee =
    payload.monthly_fee !== undefined && payload.monthly_fee !== null && payload.monthly_fee !== ""
      ? Number(payload.monthly_fee)
      : stoppageFee !== null
      ? stoppageFee
      : Number(routeDoc?.default_fee || 0);

  const waiverPercent = Math.min(100, Math.max(0, Number(payload.waiver_percent || 0)));
  const netMonthlyFee = computeNetFee(rawFee, waiverPercent);

  return {
    madrasa_id: toMadrasaObjectId(madrasaId),
    student_id: student._id.toString(),
    student_code: student.student_id || "",
    student_name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
    roll_number: student.roll_number || "",
    class_name: className,
    section_name: sectionName,
    guardian_name: guardianName,
    guardian_contact: guardianContact,
    address: payload.pickup_address || guardianAddress || "",
    route_id: routeDoc ? routeDoc._id.toString() : payload.route_id || "",
    route_name: routeDoc ? routeDoc.route_name : payload.route_name || "",
    vehicle_id: routeDoc?.vehicle_id || payload.vehicle_id || "",
    vehicle_no: routeDoc?.vehicle_no || payload.vehicle_no || "",
    stoppage: payload.stoppage || "",
    trip_type: payload.trip_type || "Both",
    monthly_fee: rawFee,
    waiver_percent: waiverPercent,
    net_monthly_fee: netMonthlyFee,
    status: payload.status || "Active",
    note: payload.note || "",
    updated_at: Date.now(),
  };
};

const upsertTransportStudent = async (db, madrasaId, payload) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const doc = await buildTransportStudentDoc(db, madrasaId, payload);

  const existing = await db.collection("transport_students").findOne({
    madrasa_id: madrasaFilter,
    student_id: doc.student_id,
  });

  if (existing) {
    await db.collection("transport_students").updateOne({ _id: existing._id }, { $set: doc });
    return { _id: existing._id, ...doc, isUpdated: true };
  }

  doc.created_at = Date.now();
  const result = await db.collection("transport_students").insertOne(doc);
  return { _id: result.insertedId, ...doc, isUpdated: false };
};

const syncStudentTransportFromAdmission = async (db, madrasaId, studentDoc) => {
  if (!studentDoc || !studentDoc._id) return null;
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const studentIdStr = studentDoc._id.toString();

  const transportCfg = studentDoc.transport;
  const feeAmount = findTransportFeeAmount(studentDoc.fees);
  const hasExplicitTransport = transportCfg && typeof transportCfg.required === "boolean";

  if (hasExplicitTransport) {
    if (!transportCfg.required) {
      await db.collection("transport_students").updateOne(
        { madrasa_id: madrasaFilter, student_id: studentIdStr },
        { $set: { status: "Inactive", updated_at: Date.now() } }
      );
      return null;
    }

    const resolvedFee =
      transportCfg.monthly_fee !== undefined && transportCfg.monthly_fee !== null && transportCfg.monthly_fee !== ""
        ? Number(transportCfg.monthly_fee)
        : feeAmount !== null
        ? feeAmount
        : undefined;

    return await upsertTransportStudent(db, madrasaId, {
      student_id: studentIdStr,
      route_id: transportCfg.route_id || "",
      route_name: transportCfg.route || "",
      stoppage: transportCfg.stoppage || "",
      trip_type: transportCfg.trip_type || "Both",
      monthly_fee: resolvedFee,
      waiver_percent: Number(transportCfg.waiver_percent || 0),
      status: "Active",
    });
  }

  if (feeAmount !== null && feeAmount > 0) {
    return await upsertTransportStudent(db, madrasaId, {
      student_id: studentIdStr,
      route_name: studentDoc.transport?.route || "",
      monthly_fee: feeAmount,
      trip_type: "Both",
      status: "Active",
    });
  }

  return null;
};

module.exports = {
  VEHICLE_TYPES,
  EXPENSE_CATEGORIES,
  TRIP_TYPES,
  getMadrasaFilter,
  toMadrasaObjectId,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  getBangladeshTimeStr,
  computeNetFee,
  findTransportFeeAmount,
  buildTransportStudentDoc,
  upsertTransportStudent,
  syncStudentTransportFromAdmission,
};
