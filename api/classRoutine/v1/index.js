const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

// Helper to convert to ObjectId if valid hex string
const safeObjectId = (id) => {
    if (!id) return id;
    if (id instanceof ObjectId) return id;
    if (typeof id !== 'string') return id;
    return /^[0-9a-fA-F]{24}$/.test(id) ? new ObjectId(id) : id;
};

// Joi Schema
const routineSchema = Joi.object({
  class_id: Joi.string().required(),
  section_id: Joi.string().required(),
  day: Joi.string().valid("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Saturdy").required(),
  periods: Joi.array().items(
      Joi.object({
          startTime: Joi.string().required(), // HH:mm
          endTime: Joi.string().required(),
          subject_id: Joi.string().required(),
          teacher_id: Joi.string().required(),
          roomNumber: Joi.string().allow("")
      })
  ).min(1).required()
});

// Update method: Merge a period into the routine for a specific day/class/section
const createOrUpdateRoutine = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { class_id, section_id, day, periods } = req.body;
    
    if (!class_id || !section_id || !day || !periods || !periods.length) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const query = { 
        class_id, // Stored as string in this collection based on previous patterns
        section_id, 
        day, 
        madrasa_id: req.user.madrasa_id 
    };
    
    // Fetch existing routine
    const existing = await db.collection("class_routines").findOne(query);
    
    let updatedPeriods = existing ? [...existing.periods] : [];

    for (let newPeriod of periods) {
        // Find if a period already exists at this time
        const index = updatedPeriods.findIndex(p => p.startTime === newPeriod.startTime);
        if (index > -1) {
            updatedPeriods[index] = { ...updatedPeriods[index], ...newPeriod };
        } else {
            updatedPeriods.push(newPeriod);
        }
    }

    // Sort periods by start time
    updatedPeriods.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const updateDocs = {
        class_id,
        section_id,
        day,
        periods: updatedPeriods,
        madrasa_id: req.user.madrasa_id,
        updated_at: Date.now()
    };

    const result = await db.collection("class_routines").updateOne(
        query, 
        { 
            $set: updateDocs,
            $setOnInsert: { created_at: Date.now() }
        }, 
        { upsert: true }
    );
    
    res.status(200).json({ success: true, message: "Routine updated successfully", data: result });
  } catch (error) {
    console.error("Error in createOrUpdateRoutine:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a specific period from a routine
const deletePeriod = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { class_id, section_id, day, startTime } = req.body;
    
    const query = { class_id, section_id, day, madrasa_id: req.user.madrasa_id };
    const routine = await db.collection("class_routines").findOne(query);

    if (!routine) {
        return res.status(404).json({ success: false, message: "Routine not found" });
    }

    const newPeriods = routine.periods.filter(p => p.startTime !== startTime);

    if (newPeriods.length === 0) {
        // If no periods left, delete the entry
        await db.collection("class_routines").deleteOne(query);
    } else {
        await db.collection("class_routines").updateOne(query, {
            $set: { periods: newPeriods, updated_at: Date.now() }
        });
    }

    res.status(200).json({ success: true, message: "Period deleted successfully" });
  } catch (error) {
    console.error("Error in deletePeriod:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all class routines
const getAllRoutines = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { class_id, section_id, day, teacher_id, view } = req.query;
    
    // Build robust query
    const filters = {};
    
    // Madrasa ID filter (always required)
    const mId = req.user.madrasa_id;
    filters.madrasa_id = { $in: [mId, safeObjectId(mId)].filter(Boolean) };

    if (day) filters.day = day;

    if (class_id) {
        filters.class_id = { $in: [class_id, safeObjectId(class_id)].filter(Boolean) };
    }
    
    if (section_id) {
        filters.section_id = { $in: [section_id, safeObjectId(section_id)].filter(Boolean) };
    }

    if (teacher_id) {
        const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
        const combinedTeacherIds = [];
        teacherIds.forEach(id => {
            combinedTeacherIds.push(id.toString());
            const oId = safeObjectId(id);
            if (oId && oId.toString() !== id.toString()) combinedTeacherIds.push(oId);
            else if (oId) combinedTeacherIds.push(oId);
        });
        filters["periods.teacher_id"] = { $in: combinedTeacherIds };
    }
    
    let routines = await db.collection("class_routines").find(filters).toArray();
    
    // Population cache
    const cache = { subjects: {}, staff: {}, classes: {}, sections: {} };

    const populate = async (coll, id, cacheKey) => {
        if (!id) return null;
        const stringId = id.toString();
        if (cache[cacheKey][stringId]) return cache[cacheKey][stringId];
        
        // Try multiple ID formats for population
        const doc = await db.collection(coll).findOne({ 
            $or: [ { _id: id }, { _id: stringId }, { _id: safeObjectId(stringId) } ]
        });
        
        if (doc) cache[cacheKey][stringId] = doc;
        return doc;
    };

    let resultData = [];

    if (view === "teacher") {
        const teacherIds = teacher_id ? (Array.isArray(teacher_id) ? teacher_id : [teacher_id]) : [];
        const stringTeacherIds = teacherIds.map(id => id.toString());

        for (let routine of routines) {
            const classDoc = await populate("classes", routine.class_id, "classes");
            const sectionDoc = await populate("sections", routine.section_id, "sections");

            for (let period of routine.periods) {
                let pTeacherId = period.teacher_id;
                // Safely handle nested ObjectIds if somehow populated deeply
                if (pTeacherId && typeof pTeacherId === 'object' && pTeacherId._id) {
                    pTeacherId = pTeacherId._id;
                }
                const pTeacherIdStr = pTeacherId ? pTeacherId.toString() : null;
                
                if (stringTeacherIds.length > 0 && !stringTeacherIds.includes(pTeacherIdStr)) continue;

                const subjectDoc = await populate("subjects", period.subject_id, "subjects");
                const teacherDoc = await populate("staff", period.teacher_id, "staff");

                resultData.push({
                    ...period,
                    _id: routine._id,
                    day: routine.day,
                    classId: classDoc || { name: "N/A" },
                    sectionId: sectionDoc || { name: "N/A" },
                    subjectId: subjectDoc || { name: "N/A" },
                    teacherId: teacherDoc || { name: "N/A" },
                    roomNo: period.roomNumber || period.roomNo,
                    timeRange: `${period.startTime} - ${period.endTime}`
                });
            }
        }
    } else {
        // Class-centric view
        for (let routine of routines) {
            routine.class = await populate("classes", routine.class_id, "classes");
            routine.section = await populate("sections", routine.section_id, "sections");

            for (let period of routine.periods) {
                // Populate both for safety
                period.subject = await populate("subjects", period.subject_id, "subjects");
                period.teacher = await populate("staff", period.teacher_id, "staff");
                period.subjectId = period.subject;
                period.teacherId = period.teacher;
            }
        }
        resultData = routines;
    }
    
    res.status(200).json({ success: true, data: resultData });
  } catch (error) {
    console.error("Error in getAllRoutines:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete routine
const deleteRoutine = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "class_routines", {
      _id: req.params.id,
      madrasa_id: req.user.madrasa_id
    });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Routine not found" });
    }
    
    res.status(200).json({ success: true, message: "Routine deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/class-routines", getAllRoutines);
router.post("/class-routines", validate(routineSchema), createOrUpdateRoutine);
router.delete("/class-routines/period", deletePeriod);
router.delete("/class-routines/:id", deleteRoutine);

module.exports = router;
