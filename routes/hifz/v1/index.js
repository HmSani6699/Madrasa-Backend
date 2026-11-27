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
  getMadrasaFilter,
  toMadrasaObjectId,
  getIdFilter,
  getBangladeshDateStr,
  getBangladeshMonthStr,
  addDays,
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
} = require("./helpers");

router.use(authMiddleware);
router.use(tenantMiddleware);

const staffRoles = ["admin", "mohtamim", "talimat", "teacher"];

/* =========================
   VALIDATION SCHEMAS
========================= */

const settingsSchema = Joi.object({
  hifz_class_ids: Joi.array().items(Joi.string().required()).required(),
});

const lessonSectionSchema = Joi.object({
  para: Joi.string().allow("", null).default(""),
  page: Joi.string().allow("", null).default(""),
  amount: Joi.string().allow("", null).default(""),
  mistakes: Joi.alternatives().try(Joi.number().min(0), Joi.string().allow("", null)).default(""),
});

const dailyRowSchema = Joi.object({
  student_id: Joi.string().required(),
  attendance: Joi.string().valid("উপস্থিত", "অনুপস্থিত", "ছুটি", "").default("উপস্থিত"),
  sabak: lessonSectionSchema.optional(),
  sat_sabak: lessonSectionSchema.optional(),
  amukhta: lessonSectionSchema.optional(),
  daily_tilawat: Joi.string().allow("", null).default(""),
  teacher_signature: Joi.string().allow("", null).default(""),
});

const bulkDailySchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  class_id: Joi.string().required(),
  section_id: Joi.string().allow("", null).default(""),
  entries: Joi.array().items(dailyRowSchema).required(),
});

const weeklyKhataSchema = Joi.object({
  student_id: Joi.string().required(),
  week_start: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  days: Joi.array()
    .items(
      Joi.object({
        date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        attendance: Joi.string().valid("উপস্থিত", "অনুপস্থিত", "ছুটি", "").default(""),
        sabak: lessonSectionSchema.optional(),
        sat_sabak: lessonSectionSchema.optional(),
        amukhta: lessonSectionSchema.optional(),
        daily_tilawat: Joi.string().allow("", null).default(""),
        teacher_signature: Joi.string().allow("", null).default(""),
      })
    )
    .required(),
  weekly_review: Joi.object({
    assigned_saturday_paras: Joi.string().allow("", null).default(""),
    recited_total_paras: Joi.string().allow("", null).default(""),
    recited_which_paras: Joi.string().allow("", null).default(""),
    saturday_lokma_count: Joi.alternatives()
      .try(Joi.number().min(0), Joi.string().allow("", null))
      .default(""),
  }).optional(),
});

/* =========================
   INTERNAL DATA HELPERS
========================= */

const resolveActorDisplayName = async (db, user) => {
  if (!user) return "";
  if (user.name) return user.name;
  try {
    const dbUser = await db.collection("users").findOne({ _id: new ObjectId(user.userId) });
    if (dbUser?.reference_id && ObjectId.isValid(dbUser.reference_id)) {
      const staff = await db.collection("staff").findOne({ _id: new ObjectId(dbUser.reference_id) });
      if (staff?.name) return staff.name;
    }
    return dbUser?.name || dbUser?.username || user.username || "";
  } catch {
    return user.username || "";
  }
};

const fetchClassesAndCounts = async (db, madrasaId) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const [classes, students, settingsDoc] = await Promise.all([
    db.collection("classes").find({ madrasa_id: madrasaFilter }).sort({ name: 1 }).toArray(),
    db
      .collection("students")
      .find(
        {
          madrasa_id: madrasaFilter,
          admissionStatus: { $nin: ["Inactive", "Deactive", "Deactivated"] },
        },
        { projection: { _id: 1, class_id: 1 } }
      )
      .toArray(),
    db.collection("hifz_settings").findOne({ madrasa_id: madrasaFilter }),
  ]);

  const countByClass = {};
  students.forEach((st) => {
    const cid = st.class_id ? st.class_id.toString() : "";
    if (cid) countByClass[cid] = (countByClass[cid] || 0) + 1;
  });

  const hifzClassIds = resolveEffectiveHifzClassIds(settingsDoc, classes);

  const enrichedClasses = classes.map((c) => ({
    _id: c._id.toString(),
    name: c.name,
    studentCount: countByClass[c._id.toString()] || 0,
    isHifz: hifzClassIds.includes(c._id.toString()),
  }));

  return { classes: enrichedClasses, hifzClassIds, settingsConfigured: Boolean(settingsDoc) };
};

const fetchActiveStudentsForClass = async (db, madrasaId, classId, sectionId = "") => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const query = {
    madrasa_id: madrasaFilter,
    admissionStatus: { $nin: ["Inactive", "Deactive", "Deactivated"] },
  };
  if (classId && classId !== "all") {
    query.class_id = getIdFilter(classId);
  }
  if (sectionId && sectionId !== "all") {
    query.section_id = getIdFilter(sectionId);
  }

  const students = await db
    .collection("students")
    .find(query, {
      projection: {
        _id: 1,
        firstName: 1,
        lastName: 1,
        roll_number: 1,
        student_id: 1,
        class_id: 1,
        section_id: 1,
        photo: 1,
      },
    })
    .toArray();

  return sortStudentsByRoll(students);
};

/* =========================
   1. SETTINGS (CLASS SELECTION)
========================= */

const getSettings = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const result = await fetchClassesAndCounts(db, req.user.madrasa_id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Hifz getSettings error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateSettings = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);
    const uniqueClassIds = Array.from(new Set(req.body.hifz_class_ids.map(String)));

    await db.collection("hifz_settings").updateOne(
      { madrasa_id: madrasaFilter },
      {
        $set: {
          madrasa_id: madrasaObjId,
          hifz_class_ids: uniqueClassIds,
          updated_by: req.user.userId,
          updated_at: Date.now(),
        },
        $setOnInsert: { created_at: Date.now() },
      },
      { upsert: true }
    );

    const result = await fetchClassesAndCounts(db, req.user.madrasa_id);
    return res.status(200).json({
      success: true,
      message: "হিফজ ক্লাস তালিকা সংরক্ষণ করা হয়েছে",
      data: result,
    });
  } catch (error) {
    console.error("Hifz updateSettings error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   2. DASHBOARD
========================= */

const getDashboard = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const today = req.query.date || getBangladeshDateStr();
    const currentMonth = today.slice(0, 7);
    const weekStart = getSaturdayWeekStart(today);
    const monthRegex = new RegExp(`^${currentMonth}-`);

    const { classes, hifzClassIds, settingsConfigured } = await fetchClassesAndCounts(
      db,
      req.user.madrasa_id
    );

    const hifzClasses = classes.filter((c) => hifzClassIds.includes(c._id));
    const hifzClassIdFilters = hifzClassIds.flatMap((id) =>
      ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]
    );

    let hifzStudents = [];
    if (hifzClassIds.length > 0) {
      hifzStudents = await db
        .collection("students")
        .find(
          {
            madrasa_id: madrasaFilter,
            class_id: { $in: hifzClassIdFilters },
            admissionStatus: { $nin: ["Inactive", "Deactive", "Deactivated"] },
          },
          { projection: { _id: 1, class_id: 1 } }
        )
        .toArray();
    }

    const hifzStudentIds = hifzStudents.map((s) => s._id.toString());
    const studentClassMap = {};
    hifzStudents.forEach((s) => {
      studentClassMap[s._id.toString()] = s.class_id ? s.class_id.toString() : "";
    });

    const [todayEntries, weeklyReviews, monthEntries] = await Promise.all([
      hifzStudentIds.length
        ? db
            .collection("hifz_daily_entries")
            .find({
              madrasa_id: madrasaFilter,
              date: today,
              student_id: { $in: hifzStudentIds },
            })
            .toArray()
        : [],
      hifzStudentIds.length
        ? db
            .collection("hifz_weekly_reviews")
            .find({
              madrasa_id: madrasaFilter,
              week_start_date: weekStart,
              student_id: { $in: hifzStudentIds },
            })
            .toArray()
        : [],
      hifzStudentIds.length
        ? db
            .collection("hifz_daily_entries")
            .find(
              {
                madrasa_id: madrasaFilter,
                date: monthRegex,
                student_id: { $in: hifzStudentIds },
              },
              { projection: { sat_sabak: 1, amukhta: 1 } }
            )
            .toArray()
        : [],
    ]);

    const todaySavedSet = new Set();
    const todaySavedByClass = {};
    todayEntries.forEach((entry) => {
      if (shouldPersistDailyEntry(entry)) {
        todaySavedSet.add(entry.student_id);
        const cid = studentClassMap[entry.student_id] || entry.class_id;
        if (cid) todaySavedByClass[cid] = (todaySavedByClass[cid] || 0) + 1;
      }
    });

    const reviewedStudentsCount = weeklyReviews.filter(
      (r) =>
        cleanStr(r.assigned_saturday_paras) ||
        cleanStr(r.recited_total_paras) ||
        cleanStr(r.recited_which_paras) ||
        r.saturday_lokma_count !== ""
    ).length;

    let monthMistakesTotal = 0;
    monthEntries.forEach((e) => {
      const satErr = Number(e.sat_sabak?.mistakes || 0);
      const amuErr = Number(e.amukhta?.mistakes || 0);
      if (Number.isFinite(satErr)) monthMistakesTotal += satErr;
      if (Number.isFinite(amuErr)) monthMistakesTotal += amuErr;
    });

    const classProgress = hifzClasses.map((cls) => {
      const total = cls.studentCount || 0;
      const entered = todaySavedByClass[cls._id] || 0;
      const percent = total > 0 ? Math.round((entered / total) * 100) : 0;
      return {
        class_id: cls._id,
        class_name: cls.name,
        total_students: total,
        entered_today: entered,
        percent,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        date: today,
        weekInfo: getWeekInfoForDate(today),
        settingsConfigured,
        stats: {
          totalStudents: hifzStudentIds.length,
          todayEntriesCount: todaySavedSet.size,
          weeklyReviewedCount: reviewedStudentsCount,
          monthMistakesTotal,
        },
        classProgress,
        allClasses: classes,
        hifzClassIds,
      },
    });
  } catch (error) {
    console.error("Hifz getDashboard error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   3. DAILY ENTRY (CLASS SHEET)
========================= */

const getDailyEntries = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { class_id, section_id = "", date = getBangladeshDateStr() } = req.query;

    if (!class_id) {
      return res.status(400).json({ success: false, message: "class_id is required" });
    }

    const students = await fetchActiveStudentsForClass(
      db,
      req.user.madrasa_id,
      class_id,
      section_id
    );
    const studentIds = students.map((s) => s._id.toString());

    const [todayDocs, previousDocs] = await Promise.all([
      studentIds.length
        ? db
            .collection("hifz_daily_entries")
            .find({
              madrasa_id: madrasaFilter,
              date,
              student_id: { $in: studentIds },
            })
            .toArray()
        : [],
      studentIds.length
        ? db
            .collection("hifz_daily_entries")
            .aggregate([
              {
                $match: {
                  madrasa_id: madrasaFilter,
                  student_id: { $in: studentIds },
                  date: { $lt: date },
                },
              },
              { $sort: { date: -1 } },
              {
                $group: {
                  _id: "$student_id",
                  doc: { $first: "$$ROOT" },
                },
              },
            ])
            .toArray()
        : [],
    ]);

    const todayMap = Object.fromEntries(todayDocs.map((d) => [d.student_id, d]));
    const prevMap = Object.fromEntries(previousDocs.map((d) => [d._id, d.doc]));

    let enteredCount = 0;
    const rows = students.map((st) => {
      const sid = st._id.toString();
      const entry = todayMap[sid] || null;
      const prev = prevMap[sid] || null;
      if (entry && shouldPersistDailyEntry(entry)) enteredCount += 1;
      return {
        student_id: sid,
        roll_number: st.roll_number || "",
        student_code: st.student_id || "",
        name: formatStudentName(st),
        section_id: st.section_id ? st.section_id.toString() : "",
        entry: entry
          ? {
              attendance: entry.attendance || "উপস্থিত",
              sabak: entry.sabak || { para: "", page: "" },
              sat_sabak: entry.sat_sabak || { para: "", page: "", amount: "", mistakes: "" },
              amukhta: entry.amukhta || { para: "", page: "", amount: "", mistakes: "" },
              daily_tilawat: entry.daily_tilawat || "",
              teacher_signature: entry.teacher_signature || "",
            }
          : null,
        previousEntry: prev
          ? {
              date: prev.date,
              sabak: prev.sabak || { para: "", page: "" },
              sat_sabak: prev.sat_sabak || { para: "", page: "", amount: "", mistakes: "" },
              amukhta: prev.amukhta || { para: "", page: "", amount: "", mistakes: "" },
              daily_tilawat: prev.daily_tilawat || "",
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        date,
        weekInfo: getWeekInfoForDate(date),
        totalStudents: rows.length,
        enteredCount,
        rows,
      },
    });
  } catch (error) {
    console.error("Hifz getDailyEntries error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const saveDailyEntriesBulk = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);
    const { date, class_id, section_id = "", entries } = req.body;
    const actorName = await resolveActorDisplayName(db, req.user);
    const now = Date.now();

    const bulkOps = [];
    let savedCount = 0;

    for (const row of entries) {
      const normalized = normalizeEntryFields(row);
      const persist = shouldPersistDailyEntry(normalized);

      if (!persist) {
        // Delete existing entry if user completely cleared all lesson fields & marked default
        bulkOps.push({
          deleteOne: {
            filter: {
              madrasa_id: madrasaFilter,
              student_id: row.student_id,
              date,
            },
          },
        });
        continue;
      }

      if (hasLessonData(normalized) && !normalized.teacher_signature && actorName) {
        normalized.teacher_signature = actorName;
      }
      if (!normalized.attendance) {
        normalized.attendance = "উপস্থিত";
      }

      savedCount += 1;
      bulkOps.push({
        updateOne: {
          filter: {
            madrasa_id: madrasaFilter,
            student_id: row.student_id,
            date,
          },
          update: {
            $set: {
              madrasa_id: madrasaObjId,
              student_id: row.student_id,
              class_id: String(class_id),
              section_id: cleanStr(section_id),
              date,
              ...normalized,
              saved_by_user_id: String(req.user.userId),
              saved_by_name: actorName,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await db.collection("hifz_daily_entries").bulkWrite(bulkOps);
    }

    return res.status(200).json({
      success: true,
      message: `${savedCount} জন শিক্ষার্থীর দৈনিক তথ্য সংরক্ষণ করা হয়েছে`,
      savedCount,
    });
  } catch (error) {
    console.error("Hifz saveDailyEntriesBulk error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   4. WEEKLY KHATA (STUDENT)
========================= */

const buildWeeklyKhataPayload = async (db, madrasaId, student, targetDate) => {
  const madrasaFilter = getMadrasaFilter(madrasaId);
  const weekStart = getSaturdayWeekStart(targetDate);
  const weekEnd = addDays(weekStart, 6);
  const weekDays = getWeekDaysList(weekStart);
  const weekInfo = getWeekInfoForDate(weekStart);
  const sid = student._id.toString();

  const [entries, review] = await Promise.all([
    db
      .collection("hifz_daily_entries")
      .find({
        madrasa_id: madrasaFilter,
        student_id: sid,
        date: { $gte: weekStart, $lte: weekEnd },
      })
      .toArray(),
    db.collection("hifz_weekly_reviews").findOne({
      madrasa_id: madrasaFilter,
      student_id: sid,
      week_start_date: weekStart,
    }),
  ]);

  const entryMap = Object.fromEntries(entries.map((e) => [e.date, e]));

  const days = weekDays.map((day) => {
    const found = entryMap[day.date];
    return {
      ...day,
      attendance: found?.attendance || "",
      sabak: found?.sabak || { para: "", page: "" },
      sat_sabak: found?.sat_sabak || { para: "", page: "", amount: "", mistakes: "" },
      amukhta: found?.amukhta || { para: "", page: "", amount: "", mistakes: "" },
      daily_tilawat: found?.daily_tilawat || "",
      teacher_signature: found?.teacher_signature || "",
    };
  });

  return {
    student: {
      student_id: sid,
      name: formatStudentName(student),
      roll_number: student.roll_number || "",
      student_code: student.student_id || "",
      class_id: student.class_id ? student.class_id.toString() : "",
      section_id: student.section_id ? student.section_id.toString() : "",
    },
    weekStart,
    weekEnd,
    weekInfo,
    days,
    weekly_review: {
      assigned_saturday_paras: review?.assigned_saturday_paras || "",
      recited_total_paras: review?.recited_total_paras || "",
      recited_which_paras: review?.recited_which_paras || "",
      saturday_lokma_count:
        review?.saturday_lokma_count !== undefined && review?.saturday_lokma_count !== null
          ? review.saturday_lokma_count
          : "",
    },
  };
};

const getWeeklyKhata = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { student_id, week_start = getBangladeshDateStr() } = req.query;

    if (!student_id || !ObjectId.isValid(student_id)) {
      return res.status(400).json({ success: false, message: "Valid student_id is required" });
    }

    const student = await db.collection("students").findOne({
      _id: new ObjectId(student_id),
      madrasa_id: madrasaFilter,
    });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const payload = await buildWeeklyKhataPayload(db, req.user.madrasa_id, student, week_start);
    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    console.error("Hifz getWeeklyKhata error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const saveWeeklyKhata = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const madrasaObjId = toMadrasaObjectId(req.user.madrasa_id);
    const { student_id, week_start, days, weekly_review } = req.body;

    if (!ObjectId.isValid(student_id)) {
      return res.status(400).json({ success: false, message: "Invalid student_id" });
    }

    const student = await db.collection("students").findOne({
      _id: new ObjectId(student_id),
      madrasa_id: madrasaFilter,
    });
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const canonicalWeekStart = getSaturdayWeekStart(week_start);
    const weekEnd = addDays(canonicalWeekStart, 6);
    const actorName = await resolveActorDisplayName(db, req.user);
    const now = Date.now();

    const bulkOps = [];
    for (const row of days) {
      const normalized = normalizeEntryFields(row);
      const persist = shouldPersistDailyEntry(normalized);

      if (!persist) {
        bulkOps.push({
          deleteOne: {
            filter: {
              madrasa_id: madrasaFilter,
              student_id: String(student_id),
              date: row.date,
            },
          },
        });
        continue;
      }

      if (hasLessonData(normalized) && !normalized.teacher_signature && actorName) {
        normalized.teacher_signature = actorName;
      }
      if (!normalized.attendance) {
        normalized.attendance = "উপস্থিত";
      }

      bulkOps.push({
        updateOne: {
          filter: {
            madrasa_id: madrasaFilter,
            student_id: String(student_id),
            date: row.date,
          },
          update: {
            $set: {
              madrasa_id: madrasaObjId,
              student_id: String(student_id),
              class_id: student.class_id ? student.class_id.toString() : "",
              section_id: student.section_id ? student.section_id.toString() : "",
              date: row.date,
              ...normalized,
              saved_by_user_id: String(req.user.userId),
              saved_by_name: actorName,
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await db.collection("hifz_daily_entries").bulkWrite(bulkOps);
    }

    if (weekly_review) {
      const cleanReview = {
        assigned_saturday_paras: cleanStr(weekly_review.assigned_saturday_paras),
        recited_total_paras: cleanStr(weekly_review.recited_total_paras),
        recited_which_paras: cleanStr(weekly_review.recited_which_paras),
        saturday_lokma_count: toNonNegInt(weekly_review.saturday_lokma_count),
      };

      const hasReviewData = Boolean(
        cleanReview.assigned_saturday_paras ||
          cleanReview.recited_total_paras ||
          cleanReview.recited_which_paras ||
          cleanReview.saturday_lokma_count !== ""
      );

      if (hasReviewData) {
        await db.collection("hifz_weekly_reviews").updateOne(
          {
            madrasa_id: madrasaFilter,
            student_id: String(student_id),
            week_start_date: canonicalWeekStart,
          },
          {
            $set: {
              madrasa_id: madrasaObjId,
              student_id: String(student_id),
              class_id: student.class_id ? student.class_id.toString() : "",
              week_start_date: canonicalWeekStart,
              week_end_date: weekEnd,
              ...cleanReview,
              updated_by: String(req.user.userId),
              updated_at: now,
            },
            $setOnInsert: { created_at: now },
          },
          { upsert: true }
        );
      } else {
        await db.collection("hifz_weekly_reviews").deleteOne({
          madrasa_id: madrasaFilter,
          student_id: String(student_id),
          week_start_date: canonicalWeekStart,
        });
      }
    }

    const updated = await buildWeeklyKhataPayload(
      db,
      req.user.madrasa_id,
      student,
      canonicalWeekStart
    );
    return res.status(200).json({
      success: true,
      message: "সাপ্তাহিক হিফজ খাতা সংরক্ষণ করা হয়েছে",
      data: updated,
    });
  } catch (error) {
    console.error("Hifz saveWeeklyKhata error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   5. MONTHLY REPORT & PRINT
========================= */

const buildStudentMonthlySummary = (student, entries = [], reviews = []) => {
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let sabakDays = 0;
  let satSabakMistakes = 0;
  let amukhtaMistakes = 0;
  let latestSabak = null;

  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  for (const e of sortedEntries) {
    if (e.attendance === "উপস্থিত") presentDays += 1;
    else if (e.attendance === "অনুপস্থিত") absentDays += 1;
    else if (e.attendance === "ছুটি") leaveDays += 1;

    if (cleanStr(e.sabak?.para) || cleanStr(e.sabak?.page)) {
      sabakDays += 1;
      latestSabak = {
        date: e.date,
        para: e.sabak.para,
        page: e.sabak.page,
      };
    }

    const sErr = Number(e.sat_sabak?.mistakes || 0);
    const aErr = Number(e.amukhta?.mistakes || 0);
    if (Number.isFinite(sErr)) satSabakMistakes += sErr;
    if (Number.isFinite(aErr)) amukhtaMistakes += aErr;
  }

  let saturdayLokma = 0;
  for (const r of reviews) {
    const l = Number(r.saturday_lokma_count || 0);
    if (Number.isFinite(l)) saturdayLokma += l;
  }

  return {
    student_id: student._id.toString(),
    roll_number: student.roll_number || "",
    name: formatStudentName(student),
    presentDays,
    absentDays,
    leaveDays,
    sabakDays,
    satSabakMistakes,
    amukhtaMistakes,
    saturdayLokma,
    latestSabak,
  };
};

const getMonthlyReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const { class_id, section_id = "", month = getBangladeshMonthStr() } = req.query;

    if (!class_id) {
      return res.status(400).json({ success: false, message: "class_id is required" });
    }

    const students = await fetchActiveStudentsForClass(
      db,
      req.user.madrasa_id,
      class_id,
      section_id
    );
    const studentIds = students.map((s) => s._id.toString());
    const weeks = getMonthSaturdayWeeks(month);
    const monthRegex = new RegExp(`^${month}-`);
    const weekStarts = weeks.map((w) => w.weekStart);

    const [entries, reviews] = await Promise.all([
      studentIds.length
        ? db
            .collection("hifz_daily_entries")
            .find({
              madrasa_id: madrasaFilter,
              student_id: { $in: studentIds },
              date: monthRegex,
            })
            .toArray()
        : [],
      studentIds.length && weekStarts.length
        ? db
            .collection("hifz_weekly_reviews")
            .find({
              madrasa_id: madrasaFilter,
              student_id: { $in: studentIds },
              week_start_date: { $in: weekStarts },
            })
            .toArray()
        : [],
    ]);

    const entriesByStudent = {};
    entries.forEach((e) => {
      if (!entriesByStudent[e.student_id]) entriesByStudent[e.student_id] = [];
      entriesByStudent[e.student_id].push(e);
    });

    const reviewsByStudent = {};
    reviews.forEach((r) => {
      if (!reviewsByStudent[r.student_id]) reviewsByStudent[r.student_id] = [];
      reviewsByStudent[r.student_id].push(r);
    });

    const summaryRows = students.map((st) =>
      buildStudentMonthlySummary(
        st,
        entriesByStudent[st._id.toString()] || [],
        reviewsByStudent[st._id.toString()] || []
      )
    );

    return res.status(200).json({
      success: true,
      data: {
        month,
        weeks,
        rows: summaryRows,
      },
    });
  } catch (error) {
    console.error("Hifz getMonthlyReport error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPrintData = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const {
      student_id = "",
      class_id = "",
      section_id = "",
      month = getBangladeshMonthStr(),
    } = req.query;

    let students = [];
    if (student_id && ObjectId.isValid(student_id)) {
      const st = await db.collection("students").findOne({
        _id: new ObjectId(student_id),
        madrasa_id: madrasaFilter,
      });
      if (st) students = [st];
    } else if (class_id) {
      students = await fetchActiveStudentsForClass(
        db,
        req.user.madrasa_id,
        class_id,
        section_id
      );
    }

    if (students.length === 0) {
      return res.status(200).json({ success: true, data: { month, weeks: [], students: [] } });
    }

    const weeks = getMonthSaturdayWeeks(month);
    const minDate = weeks[0]?.weekStart || `${month}-01`;
    const maxDate = weeks[weeks.length - 1]?.weekEnd || `${month}-31`;
    const studentIds = students.map((s) => s._id.toString());
    const weekStarts = weeks.map((w) => w.weekStart);

    const [entries, reviews, classes] = await Promise.all([
      db
        .collection("hifz_daily_entries")
        .find({
          madrasa_id: madrasaFilter,
          student_id: { $in: studentIds },
          date: { $gte: minDate, $lte: maxDate },
        })
        .toArray(),
      weekStarts.length
        ? db
            .collection("hifz_weekly_reviews")
            .find({
              madrasa_id: madrasaFilter,
              student_id: { $in: studentIds },
              week_start_date: { $in: weekStarts },
            })
            .toArray()
        : [],
      db.collection("classes").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const classMap = Object.fromEntries(classes.map((c) => [c._id.toString(), c.name]));

    const entryMap = {};
    entries.forEach((e) => {
      entryMap[`${e.student_id}_${e.date}`] = e;
    });

    const reviewMap = {};
    reviews.forEach((r) => {
      reviewMap[`${r.student_id}_${r.week_start_date}`] = r;
    });

    const printableStudents = students.map((st) => {
      const sid = st._id.toString();
      const studentWeeks = weeks.map((w) => {
        const days = getWeekDaysList(w.weekStart).map((d) => {
          const found = entryMap[`${sid}_${d.date}`];
          return {
            ...d,
            attendance: found?.attendance || "",
            sabak: found?.sabak || { para: "", page: "" },
            sat_sabak: found?.sat_sabak || { para: "", page: "", amount: "", mistakes: "" },
            amukhta: found?.amukhta || { para: "", page: "", amount: "", mistakes: "" },
            daily_tilawat: found?.daily_tilawat || "",
            teacher_signature: found?.teacher_signature || "",
          };
        });
        const rev = reviewMap[`${sid}_${w.weekStart}`];
        return {
          ...w,
          weekInfo: getWeekInfoForDate(w.weekStart),
          days,
          weekly_review: {
            assigned_saturday_paras: rev?.assigned_saturday_paras || "",
            recited_total_paras: rev?.recited_total_paras || "",
            recited_which_paras: rev?.recited_which_paras || "",
            saturday_lokma_count:
              rev?.saturday_lokma_count !== undefined && rev?.saturday_lokma_count !== null
                ? rev.saturday_lokma_count
                : "",
          },
        };
      });

      return {
        student_id: sid,
        name: formatStudentName(st),
        roll_number: st.roll_number || "",
        class_name: classMap[String(st.class_id)] || "",
        weeks: studentWeeks,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        month,
        weeks,
        students: printableStudents,
      },
    });
  } catch (error) {
    console.error("Hifz getPrintData error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   6. GUARDIAN & STUDENT PORTAL
========================= */

const getPortalKhata = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const role = req.user.role;
    const month = req.query.month || getBangladeshMonthStr();
    const targetDate = req.query.week_start || getBangladeshDateStr();

    let student = null;

    if (role === "guardian") {
      const dbUser = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
      let parent = null;
      if (dbUser?.reference_id && ObjectId.isValid(dbUser.reference_id)) {
        parent = await db.collection("parents").findOne({ _id: new ObjectId(dbUser.reference_id) });
      }
      if (!parent && dbUser) {
        parent = await db.collection("parents").findOne({ userId: dbUser._id });
      }
      if (!parent && req.user.username) {
        parent = await db.collection("parents").findOne({
          contact: req.user.username,
          madrasa_id: madrasaFilter,
        });
      }

      if (!parent) {
        return res.status(404).json({ success: false, message: "Guardian profile not found" });
      }

      const children = await db
        .collection("students")
        .find({
          guardian_id: { $in: [parent._id, parent._id.toString()] },
          madrasa_id: madrasaFilter,
        })
        .toArray();

      if (children.length === 0) {
        return res.status(200).json({ success: true, data: null });
      }

      if (req.query.student_id) {
        student = children.find((c) => c._id.toString() === String(req.query.student_id));
        if (!student) {
          return res.status(403).json({
            success: false,
            message: "Access denied for the requested student",
          });
        }
      } else {
        student = children[0];
      }
    } else if (role === "student") {
      const dbUser = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
      if (dbUser?.reference_id && ObjectId.isValid(dbUser.reference_id)) {
        student = await db.collection("students").findOne({
          _id: new ObjectId(dbUser.reference_id),
          madrasa_id: madrasaFilter,
        });
      }
      if (!student) {
        return res.status(200).json({ success: true, data: null });
      }
    } else if (staffRoles.includes(role) && req.query.student_id && ObjectId.isValid(req.query.student_id)) {
      student = await db.collection("students").findOne({
        _id: new ObjectId(req.query.student_id),
        madrasa_id: madrasaFilter,
      });
    }

    if (!student) {
      return res.status(200).json({ success: true, data: null });
    }

    const sid = student._id.toString();
    const weeks = getMonthSaturdayWeeks(month);
    const monthRegex = new RegExp(`^${month}-`);
    const weekStarts = weeks.map((w) => w.weekStart);

    const [weeklyKhata, monthEntries, monthReviews, classDoc, settingsDoc, allClasses] =
      await Promise.all([
        buildWeeklyKhataPayload(db, req.user.madrasa_id, student, targetDate),
        db
          .collection("hifz_daily_entries")
          .find({ madrasa_id: madrasaFilter, student_id: sid, date: monthRegex })
          .toArray(),
        weekStarts.length
          ? db
              .collection("hifz_weekly_reviews")
              .find({
                madrasa_id: madrasaFilter,
                student_id: sid,
                week_start_date: { $in: weekStarts },
              })
              .toArray()
          : [],
        student.class_id && ObjectId.isValid(student.class_id)
          ? db.collection("classes").findOne({ _id: new ObjectId(student.class_id) })
          : null,
        db.collection("hifz_settings").findOne({ madrasa_id: madrasaFilter }),
        db.collection("classes").find({ madrasa_id: madrasaFilter }).toArray(),
      ]);

    const hifzClassIds = resolveEffectiveHifzClassIds(settingsDoc, allClasses);
    const isHifzStudent =
      (student.class_id && hifzClassIds.includes(student.class_id.toString())) ||
      monthEntries.length > 0 ||
      weeklyKhata.days.some((d) => hasLessonData(d) || d.attendance);

    const monthlySummary = buildStudentMonthlySummary(student, monthEntries, monthReviews);

    return res.status(200).json({
      success: true,
      data: {
        isHifzStudent,
        className: classDoc?.name || "",
        month,
        weeks,
        monthlySummary,
        weeklyKhata,
      },
    });
  } catch (error) {
    console.error("Hifz getPortalKhata error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPortalPrintData = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const role = req.user.role;
    const month = req.query.month || getBangladeshMonthStr();

    let student = null;

    if (role === "guardian") {
      const dbUser = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
      let parent = null;
      if (dbUser?.reference_id && ObjectId.isValid(dbUser.reference_id)) {
        parent = await db.collection("parents").findOne({ _id: new ObjectId(dbUser.reference_id) });
      }
      if (!parent && dbUser) {
        parent = await db.collection("parents").findOne({ userId: dbUser._id });
      }
      if (!parent && req.user.username) {
        parent = await db.collection("parents").findOne({
          contact: req.user.username,
          madrasa_id: madrasaFilter,
        });
      }
      if (parent) {
        const children = await db
          .collection("students")
          .find({
            guardian_id: { $in: [parent._id, parent._id.toString()] },
            madrasa_id: madrasaFilter,
          })
          .toArray();
        student = req.query.student_id
          ? children.find((c) => c._id.toString() === String(req.query.student_id))
          : children[0];
        if (req.query.student_id && !student) {
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
    } else if (role === "student") {
      const dbUser = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
      if (dbUser?.reference_id && ObjectId.isValid(dbUser.reference_id)) {
        student = await db.collection("students").findOne({
          _id: new ObjectId(dbUser.reference_id),
          madrasa_id: madrasaFilter,
        });
      }
    } else if (staffRoles.includes(role) && req.query.student_id && ObjectId.isValid(req.query.student_id)) {
      student = await db.collection("students").findOne({
        _id: new ObjectId(req.query.student_id),
        madrasa_id: madrasaFilter,
      });
    }

    if (!student) {
      return res.status(200).json({ success: true, data: { month, weeks: [], students: [] } });
    }

    req.query.student_id = student._id.toString();
    return await getPrintData(req, res);
  } catch (error) {
    console.error("Hifz getPortalPrintData error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   ROUTE REGISTRATION
========================= */

router.get("/settings", rbacMiddleware(staffRoles), getSettings);
router.put("/settings", rbacMiddleware(staffRoles), validate(settingsSchema), updateSettings);

router.get("/dashboard", rbacMiddleware(staffRoles), getDashboard);
router.get("/daily-entries", rbacMiddleware(staffRoles), getDailyEntries);
router.post(
  "/daily-entries/bulk",
  rbacMiddleware(staffRoles),
  validate(bulkDailySchema),
  saveDailyEntriesBulk
);

router.get("/weekly-khata", rbacMiddleware(staffRoles), getWeeklyKhata);
router.put(
  "/weekly-khata",
  rbacMiddleware(staffRoles),
  validate(weeklyKhataSchema),
  saveWeeklyKhata
);

router.get("/monthly-report", rbacMiddleware(staffRoles), getMonthlyReport);
router.get("/print-data", rbacMiddleware(staffRoles), getPrintData);

router.get(
  "/portal/khata",
  rbacMiddleware(["guardian", "student", ...staffRoles]),
  getPortalKhata
);
router.get(
  "/portal/print-data",
  rbacMiddleware(["guardian", "student", ...staffRoles]),
  getPortalPrintData
);

module.exports = router;
