const axios = require("axios");
const { ObjectId } = require("mongodb");

const DEFAULT_SMS_RATES = {
  singleSmsRate: 0.30,
  bulkSmsRate: 0.25,
  maskingSmsRate: 0.40,
};

const DEFAULT_ATTENDANCE_TEMPLATES = {
  Absent: "আসসালামু আলাইকুম। {student_name} আজ ({date}) {madrasa_name}-এ অনুপস্থিত রয়েছে।",
  Late: "আসসালামু আলাইকুম। {student_name} আজ ({date}) {madrasa_name}-এ দেরিতে উপস্থিত হয়েছে।",
  Present: "আসসালামু আলাইকুম। {student_name} আজ ({date}) {madrasa_name}-এ উপস্থিত হয়েছে।",
};

const DEFAULT_SMS_SETTINGS = {
  admission: false,
  fees: false,
  attendance: false,
  attendanceTrigger: "absent_only", // "absent_only" | "absent_late" | "all"
  attendanceTemplates: { ...DEFAULT_ATTENDANCE_TEMPLATES },
};

const VALID_ATTENDANCE_TRIGGERS = ["absent_only", "absent_late", "all"];

const getMadrasaFilter = (madrasaId) => {
  if (!madrasaId) return madrasaId;
  return ObjectId.isValid(madrasaId)
    ? { $in: [madrasaId.toString(), new ObjectId(madrasaId)] }
    : madrasaId;
};

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
};

const getBangladeshDateStr = (dateInput = new Date()) => {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bdTime = new Date(utc + 6 * 3600000);
  return bdTime.toISOString().slice(0, 10);
};

const getMadrasaSmsSettings = (madrasa) => {
  const saved = madrasa?.smsSettings || {};
  const trigger = VALID_ATTENDANCE_TRIGGERS.includes(saved.attendanceTrigger)
    ? saved.attendanceTrigger
    : DEFAULT_SMS_SETTINGS.attendanceTrigger;

  return {
    admission: Boolean(saved.admission),
    fees: Boolean(saved.fees),
    attendance: Boolean(saved.attendance),
    attendanceTrigger: trigger,
    attendanceTemplates: {
      Absent: saved.attendanceTemplates?.Absent || DEFAULT_ATTENDANCE_TEMPLATES.Absent,
      Late: saved.attendanceTemplates?.Late || DEFAULT_ATTENDANCE_TEMPLATES.Late,
      Present: saved.attendanceTemplates?.Present || DEFAULT_ATTENDANCE_TEMPLATES.Present,
    },
  };
};

const getSmsRates = async (db) => {
  const rates = await db.collection("sms_rates").findOne();
  return {
    singleSmsRate: Number(rates?.singleSmsRate ?? DEFAULT_SMS_RATES.singleSmsRate),
    bulkSmsRate: Number(rates?.bulkSmsRate ?? DEFAULT_SMS_RATES.bulkSmsRate),
    maskingSmsRate: Number(rates?.maskingSmsRate ?? DEFAULT_SMS_RATES.maskingSmsRate),
  };
};

const calculateSmsSegments = (message = "") => {
  const text = String(message);
  if (!text.length) return 0;
  const isUnicode = Array.from(text).some((ch) => ch.charCodeAt(0) > 127);
  const singleLimit = isUnicode ? 70 : 160;
  const multiLimit = isUnicode ? 67 : 153;
  return text.length <= singleLimit ? 1 : Math.ceil(text.length / multiLimit);
};

const renderTemplate = (template, vars = {}) => {
  let output = String(template || "");
  Object.entries(vars).forEach(([key, value]) => {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), value ?? "");
  });
  return output.trim();
};

const normalizePhone = (phone) => {
  if (!phone) return "";
  const cleaned = String(phone).trim().replace(/[^\d+]/g, "");
  return cleaned.length >= 10 ? cleaned : "";
};

/**
 * Optional external SMS gateway hook.
 * If SMS_GATEWAY_URL is configured in .env, dispatches HTTP request;
 * otherwise operates in simulated mode for safe local development.
 */
const sendViaGateway = async ({ to, message, smsType }) => {
  const gatewayUrl = process.env.SMS_GATEWAY_URL;
  if (!gatewayUrl) {
    return { ok: true, mode: "simulated", providerResponse: "Gateway URL not configured; logged locally" };
  }

  try {
    const apiKey = process.env.SMS_GATEWAY_API_KEY || "";
    const senderId = process.env.SMS_GATEWAY_SENDER_ID || "";
    const response = await axios.post(
      gatewayUrl,
      {
        api_key: apiKey,
        senderid: senderId,
        number: to,
        message,
        type: smsType,
      },
      { timeout: 5000 }
    );
    return { ok: true, mode: "sent", providerResponse: response.data };
  } catch (error) {
    return { ok: false, mode: "failed", error: error.message };
  }
};

/**
 * Atomically check & deduct madrasa wallet balance, dispatch SMS, and persist sms_logs.
 */
const dispatchSmsBatch = async (
  db,
  { madrasaId, recipients = [], smsType = "Single", category = "general", dateKey = null }
) => {
  const madrasaObjectId = toObjectId(madrasaId);
  if (!madrasaObjectId) {
    return { sentCount: 0, skippedReason: "invalid_madrasa" };
  }

  const validRecipients = recipients
    .map((r) => ({ ...r, to: normalizePhone(r.to) }))
    .filter((r) => r.to && r.message);

  if (validRecipients.length === 0) {
    return { sentCount: 0, skippedReason: "no_valid_recipients" };
  }

  const rates = await getSmsRates(db);
  let ratePerUnit = rates.singleSmsRate;
  if (smsType === "Bulk") ratePerUnit = rates.bulkSmsRate;
  if (smsType === "Masking") ratePerUnit = rates.maskingSmsRate;

  const prepared = validRecipients.map((r) => {
    const segments = Math.max(1, calculateSmsSegments(r.message));
    const cost = Number((segments * ratePerUnit).toFixed(2));
    return { ...r, segments, cost };
  });

  const totalCost = Number(
    prepared.reduce((sum, item) => sum + item.cost, 0).toFixed(2)
  );

  // Atomically reserve/deduct balance only if sufficient funds exist
  const deductResult = await db.collection("madrasas").findOneAndUpdate(
    { _id: madrasaObjectId, smsWalletBalance: { $gte: totalCost } },
    { $inc: { smsWalletBalance: -totalCost } },
    { returnDocument: "after", returnOriginal: false }
  );

  const updatedMadrasa =
    deductResult && Object.prototype.hasOwnProperty.call(deductResult, "value")
      ? deductResult.value
      : deductResult;
  if (!updatedMadrasa) {
    const currentMadrasa = await db.collection("madrasas").findOne(
      { _id: madrasaObjectId },
      { projection: { smsWalletBalance: 1 } }
    );
    return {
      sentCount: 0,
      skippedReason: "insufficient_balance",
      requiredCost: totalCost,
      balance: Number(currentMadrasa?.smsWalletBalance || 0),
    };
  }

  const gatewayResults = await Promise.all(
    prepared.map((item) => sendViaGateway({ to: item.to, message: item.message, smsType }))
  );

  const now = new Date();
  const logsToInsert = [];
  let refundedCost = 0;
  let sentCount = 0;

  prepared.forEach((item, idx) => {
    const gw = gatewayResults[idx];
    const isSuccess = gw.ok;
    if (isSuccess) {
      sentCount += 1;
    } else {
      refundedCost += item.cost;
    }

    logsToInsert.push({
      madrasaId: madrasaObjectId,
      category,
      dateKey,
      studentId: item.studentId ? String(item.studentId) : null,
      attendanceStatus: item.attendanceStatus || null,
      recipientName: item.recipientName || "Parent",
      to: item.to,
      message: item.message,
      smsType,
      segments: item.segments,
      cost: isSuccess ? item.cost : 0,
      status: gw.mode, // "sent" | "simulated" | "failed"
      error: gw.error || null,
      sentAt: now,
    });
  });

  if (refundedCost > 0) {
    await db.collection("madrasas").updateOne(
      { _id: madrasaObjectId },
      { $inc: { smsWalletBalance: Number(refundedCost.toFixed(2)) } }
    );
  }

  if (logsToInsert.length > 0) {
    await db.collection("sms_logs").insertMany(logsToInsert);
  }

  const actualCost = Number((totalCost - refundedCost).toFixed(2));
  return {
    sentCount,
    failedCount: prepared.length - sentCount,
    cost: actualCost,
    remainingBalance: Number((Number(updatedMadrasa.smsWalletBalance || 0) + refundedCost).toFixed(2)),
  };
};

const getAllowedStatuses = (attendanceTrigger) => {
  if (attendanceTrigger === "all") return ["Present", "Absent", "Late"];
  if (attendanceTrigger === "absent_late") return ["Absent", "Late"];
  return ["Absent"];
};

/**
 * Trigger automated attendance SMS notifications after attendance records are saved.
 * Enforces:
 * 1) Madrasa attendance SMS toggle ON
 * 2) Today-only guard (BD timezone) to prevent spamming on historical edits
 * 3) Trigger rule filter (absent_only | absent_late | all)
 * 4) Same-day duplicate prevention per student
 * 5) Wallet balance check without ever failing the attendance save itself
 */
const triggerAttendanceSms = async (db, { madrasaId, date, records = [], sendSms = true }) => {
  if (!sendSms) {
    return { triggered: false, skippedReason: "disabled_for_submission", sentCount: 0 };
  }

  const madrasaObjectId = toObjectId(madrasaId);
  if (!madrasaObjectId) {
    return { triggered: false, skippedReason: "invalid_madrasa", sentCount: 0 };
  }

  const madrasa = await db.collection("madrasas").findOne({ _id: madrasaObjectId });
  if (!madrasa) {
    return { triggered: false, skippedReason: "madrasa_not_found", sentCount: 0 };
  }

  const settings = getMadrasaSmsSettings(madrasa);
  if (!settings.attendance) {
    return { triggered: false, skippedReason: "setting_disabled", sentCount: 0 };
  }

  const attendanceDateStr = getBangladeshDateStr(date);
  const todayDateStr = getBangladeshDateStr(new Date());
  if (!attendanceDateStr || attendanceDateStr !== todayDateStr) {
    return { triggered: false, skippedReason: "not_today", sentCount: 0 };
  }

  const allowedStatuses = getAllowedStatuses(settings.attendanceTrigger);
  const eligibleRecords = records.filter((r) => allowedStatuses.includes(r.status));
  if (eligibleRecords.length === 0) {
    return { triggered: false, skippedReason: "no_matching_statuses", sentCount: 0 };
  }

  const studentIdsStr = eligibleRecords.map((r) => String(r.student_id));

  // Duplicate guard: skip students who already received an attendance SMS today
  const existingLogs = await db
    .collection("sms_logs")
    .find({
      madrasaId: madrasaObjectId,
      category: "attendance",
      dateKey: attendanceDateStr,
      studentId: { $in: studentIdsStr },
      status: { $in: ["sent", "simulated"] },
    })
    .project({ studentId: 1 })
    .toArray();

  const alreadySentIds = new Set(existingLogs.map((l) => String(l.studentId)));
  const pendingRecords = eligibleRecords.filter(
    (r) => !alreadySentIds.has(String(r.student_id))
  );

  if (pendingRecords.length === 0) {
    return {
      triggered: false,
      skippedReason: "already_sent_today",
      sentCount: 0,
      alreadySentCount: alreadySentIds.size,
    };
  }

  const pendingStudentObjectIds = pendingRecords
    .map((r) => toObjectId(r.student_id))
    .filter(Boolean);

  if (pendingStudentObjectIds.length === 0) {
    return { triggered: false, skippedReason: "no_valid_students", sentCount: 0 };
  }

  const students = await db
    .collection("students")
    .find({
      _id: { $in: pendingStudentObjectIds },
      madrasa_id: getMadrasaFilter(madrasaObjectId),
    })
    .toArray();

  const guardianObjectIds = [
    ...new Set(students.map((s) => toObjectId(s.guardian_id)).filter(Boolean)),
  ];

  const parents = guardianObjectIds.length
    ? await db
        .collection("parents")
        .find({ _id: { $in: guardianObjectIds } })
        .toArray()
    : [];

  const studentMap = new Map(students.map((s) => [s._id.toString(), s]));
  const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));

  const recipients = [];
  for (const record of pendingRecords) {
    const student = studentMap.get(String(record.student_id));
    if (!student) continue;

    const parent = student.guardian_id ? parentMap.get(String(student.guardian_id)) : null;
    const phone = normalizePhone(parent?.contact || parent?.motherContact || student.phone);
    if (!phone) continue;

    const studentName =
      [student.firstName, student.lastName].filter(Boolean).join(" ").trim() ||
      student.name ||
      "শিক্ষার্থী";
    const parentName = parent?.fatherName || parent?.motherName || studentName;

    const template =
      settings.attendanceTemplates[record.status] || DEFAULT_ATTENDANCE_TEMPLATES.Absent;
    const message = renderTemplate(template, {
      student_name: studentName,
      date: attendanceDateStr,
      status: record.status,
      madrasa_name: madrasa.name || "মাদ্রাসা",
    });

    recipients.push({
      to: phone,
      recipientName: parentName,
      message,
      studentId: student._id.toString(),
      attendanceStatus: record.status,
    });
  }

  if (recipients.length === 0) {
    return { triggered: false, skippedReason: "no_guardian_phones", sentCount: 0 };
  }

  const dispatchResult = await dispatchSmsBatch(db, {
    madrasaId: madrasaObjectId,
    recipients,
    smsType: "Single",
    category: "attendance",
    dateKey: attendanceDateStr,
  });

  return {
    triggered: true,
    alreadySentCount: alreadySentIds.size,
    ...dispatchResult,
  };
};

module.exports = {
  DEFAULT_SMS_RATES,
  DEFAULT_ATTENDANCE_TEMPLATES,
  DEFAULT_SMS_SETTINGS,
  VALID_ATTENDANCE_TRIGGERS,
  getMadrasaSmsSettings,
  getSmsRates,
  calculateSmsSegments,
  dispatchSmsBatch,
  triggerAttendanceSms,
  getBangladeshDateStr,
};
