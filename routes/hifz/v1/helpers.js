const { ObjectId } = require("mongodb");

const WEEKDAY_KEYS = [
  "Saturday",
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

const WEEKDAY_BN = {
  Saturday: "শনিবার",
  Sunday: "রবিবার",
  Monday: "সোমবার",
  Tuesday: "মঙ্গলবার",
  Wednesday: "বুধবার",
  Thursday: "বৃহস্পতিবার",
  Friday: "শুক্রবার",
};

const MONTHS_BN = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

const WEEK_ORDINAL_BN = ["১ম", "২য়", "৩য়", "৪র্থ", "৫ম"];

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

const toBanglaDigits = (val) => {
  if (val === null || val === undefined) return "";
  return String(val).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
};

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

const getIdFilter = (id) => {
  if (!id) return id;
  return ObjectId.isValid(id) ? { $in: [id.toString(), new ObjectId(id)] } : id;
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

const parseUtcDate = (dateStr) => {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const formatUtcDate = (dt) => {
  return dt.toISOString().slice(0, 10);
};

const addDays = (dateStr, days) => {
  const dt = parseUtcDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUtcDate(dt);
};

const getWeekdayKey = (dateStr) => {
  const dt = parseUtcDate(dateStr);
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

const getSaturdayWeekStart = (dateStr) => {
  const dt = parseUtcDate(dateStr);
  const daysSinceSaturday = (dt.getUTCDay() + 1) % 7;
  dt.setUTCDate(dt.getUTCDate() - daysSinceSaturday);
  return formatUtcDate(dt);
};

const getMonthSaturdayWeeks = (monthStr) => {
  const [year, month] = String(monthStr).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (dt.getUTCDay() === 6) {
      const weekStart = formatUtcDate(dt);
      const weekEnd = addDays(weekStart, 6);
      const index = weeks.length + 1;
      weeks.push({
        weekNumber: index,
        ordinalBn: WEEK_ORDINAL_BN[index - 1] || `${toBanglaDigits(index)}ম`,
        weekStart,
        weekEnd,
        shortRangeBn: `${toBanglaDigits(weekStart.slice(8, 10))}/${toBanglaDigits(
          weekStart.slice(5, 7)
        )}-${toBanglaDigits(weekEnd.slice(8, 10))}/${toBanglaDigits(
          weekEnd.slice(5, 7)
        )}`,
      });
    }
  }
  return weeks;
};

const getWeekInfoForDate = (dateStr) => {
  const weekStart = getSaturdayWeekStart(dateStr);
  const weekEnd = addDays(weekStart, 6);
  const monthStr = weekStart.slice(0, 7);
  const weeks = getMonthSaturdayWeeks(monthStr);
  const found = weeks.find((w) => w.weekStart === weekStart) || {
    weekNumber: 1,
    ordinalBn: "১ম",
    weekStart,
    weekEnd,
  };
  const [year, month] = monthStr.split("-").map(Number);
  return {
    ...found,
    monthStr,
    year,
    monthNameBn: MONTHS_BN[month - 1] || monthStr,
    yearBn: toBanglaDigits(year),
  };
};

const getWeekDaysList = (weekStart) => {
  return WEEKDAY_KEYS.map((weekdayKey, idx) => {
    const date = addDays(weekStart, idx);
    return {
      date,
      weekdayKey,
      weekdayBn: WEEKDAY_BN[weekdayKey],
      shortDateBn: `${toBanglaDigits(date.slice(8, 10))}/${toBanglaDigits(
        date.slice(5, 7)
      )}/${toBanglaDigits(date.slice(2, 4))}`,
    };
  });
};

const cleanStr = (val) => (val === null || val === undefined ? "" : String(val).trim());

const toNonNegInt = (val) => {
  const s = cleanStr(val);
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "";
  return Math.floor(n);
};

const normalizeLessonSection = (obj = {}, withAmountAndMistakes = false) => {
  const base = {
    para: cleanStr(obj.para),
    page: cleanStr(obj.page),
  };
  if (withAmountAndMistakes) {
    base.amount = cleanStr(obj.amount);
    base.mistakes = toNonNegInt(obj.mistakes);
  }
  return base;
};

const normalizeEntryFields = (row = {}) => {
  const attendance = cleanStr(row.attendance);
  const sabak = normalizeLessonSection(row.sabak, false);
  const sat_sabak = normalizeLessonSection(row.sat_sabak, true);
  const amukhta = normalizeLessonSection(row.amukhta, true);
  const daily_tilawat = cleanStr(row.daily_tilawat);
  const teacher_signature = cleanStr(row.teacher_signature);

  return {
    attendance,
    sabak,
    sat_sabak,
    amukhta,
    daily_tilawat,
    teacher_signature,
  };
};

const hasLessonData = (entry) => {
  if (!entry) return false;
  return Boolean(
    entry.sabak?.para ||
      entry.sabak?.page ||
      entry.sat_sabak?.para ||
      entry.sat_sabak?.page ||
      entry.sat_sabak?.amount ||
      entry.sat_sabak?.mistakes !== "" ||
      entry.amukhta?.para ||
      entry.amukhta?.page ||
      entry.amukhta?.amount ||
      entry.amukhta?.mistakes !== "" ||
      entry.daily_tilawat ||
      entry.teacher_signature
  );
};

const shouldPersistDailyEntry = (entry) => {
  if (!entry) return false;
  if (hasLessonData(entry)) return true;
  if (entry.attendance === "অনুপস্থিত" || entry.attendance === "ছুটি") return true;
  return false;
};

const formatStudentName = (st) => {
  return `${st.firstName || ""} ${st.lastName || ""}`.trim() || st.name || "শিক্ষার্থী";
};

const sortStudentsByRoll = (students = []) => {
  return [...students].sort((a, b) => {
    const rollA = parseInt(a.roll_number, 10);
    const rollB = parseInt(b.roll_number, 10);
    const hasNumA = !Number.isNaN(rollA);
    const hasNumB = !Number.isNaN(rollB);
    if (hasNumA && hasNumB && rollA !== rollB) return rollA - rollB;
    if (hasNumA && !hasNumB) return -1;
    if (!hasNumA && hasNumB) return 1;
    return formatStudentName(a).localeCompare(formatStudentName(b));
  });
};

const HIFZ_NAME_REGEX = /হিফজ|hifz|নাজেরা|nazera|নূরানী|nurani|কুরআন|quran/i;

const resolveEffectiveHifzClassIds = (settingsDoc, classes) => {
  if (settingsDoc && Array.isArray(settingsDoc.hifz_class_ids)) {
    return settingsDoc.hifz_class_ids.map(String);
  }
  // Auto-suggest matching Hifz classes only before settings have been saved once
  return classes
    .filter((c) => HIFZ_NAME_REGEX.test(c.name || ""))
    .map((c) => c._id.toString());
};

module.exports = {
  WEEKDAY_KEYS,
  WEEKDAY_BN,
  MONTHS_BN,
  WEEK_ORDINAL_BN,
  toBanglaDigits,
  getMadrasaFilter,
  toMadrasaObjectId,
  getIdFilter,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  addDays,
  getWeekdayKey,
  getSaturdayWeekStart,
  getMonthSaturdayWeeks,
  getWeekInfoForDate,
  getWeekDaysList,
  cleanStr,
  toNonNegInt,
  normalizeEntryFields,
  hasLessonData,
  shouldPersistDailyEntry,
  formatStudentName,
  sortStudentsByRoll,
  resolveEffectiveHifzClassIds,
};
