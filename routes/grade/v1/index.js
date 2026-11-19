const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const gradeSchema = Joi.object({
  name: Joi.string().required(), // A+, A, A-
  grade_point: Joi.number().required(), // 5.0, 4.0
  min_marks: Joi.number().min(0).max(100).required(),
  max_marks: Joi.number().min(Joi.ref('min_marks')).max(100).required(),
  remarks: Joi.string().allow("")
});

// Create new grade
const createGrade = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { min_marks, max_marks, name } = req.body;
    
    // Check for duplicate name in same madrasa
    const existingName = await mongo.fetchOne(db, "grades", { name, madrasa_id: req.user.madrasa_id });
    if (existingName) {
        return res.status(409).json({ success: false, message: `Grade ${name} already exists` });
    }

    // Check for overlap in same madrasa
    const overlap = await db.collection("grades").findOne({
        madrasa_id: req.user.madrasa_id,
        $or: [
            { min_marks: { $lte: max_marks }, max_marks: { $gte: min_marks } }
        ]
    });

    if (overlap) {
        return res.status(409).json({ 
            success: false, 
            message: `Range [${min_marks}-${max_marks}] overlaps with existing grade ${overlap.name} [${overlap.min_marks}-${overlap.max_marks}]` 
        });
    }

    const gradeData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const grade = await mongo.insertOne(db, "grades", gradeData);
    res.status(201).json({ success: true, data: grade });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update grade
const updateGrade = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { min_marks, max_marks, name } = req.body;
    const id = req.params.id;
    const { ObjectId } = require("mongodb");

    // Check overlap excluding self
    // Complex query: find overlap where _id != currentId
    // Since mongo-crud doesn't support $ne in simple fetchOne easily without raw query, we use raw db
    
    if (min_marks !== undefined && max_marks !== undefined) {
        const overlap = await db.collection("grades").findOne({
            _id: { $ne: new ObjectId(id) },
            madrasa_id: req.user.madrasa_id,
            $or: [
                { min_marks: { $lte: max_marks }, max_marks: { $gte: min_marks } }
            ]
        });

        if (overlap) {
            return res.status(409).json({ 
                success: false, 
                message: `Range overlaps with existing grade ${overlap.name}` 
            });
        }
    }

    const result = await mongo.updateData(
      db,
      "grades",
      { _id: new ObjectId(id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Grade not found" });
    }
    
    res.status(200).json({ success: true, message: "Grade updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// ... keep existing getters ...
// Get all grades
const getAllGrades = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
      const query = { madrasa_id: req.user.madrasa_id };
      const grades = await mongo.fetchMany(db, "grades", query, {}, { min_marks: -1 });
      const total = await mongo.documentCount(db, "grades", query);
      res.status(200).json({ success: true, data: grades, total });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
  };
  
  // Get single grade by ID
  const getGradeById = async (req, res) => {
    const { db, client } = await mongoConnect();
    const { ObjectId } = require("mongodb");
    try {
      const grade = await mongo.fetchOne(db, "grades", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
      if (!grade) {
        return res.status(404).json({ success: false, message: "Grade not found" });
      }
      res.status(200).json({ success: true, data: grade });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
  };

  // Get grade by marks
  const getGradeByMarks = async (req, res) => {
    const { db, client } = await mongoConnect();
    try {
      const marks = parseFloat(req.params.marks);
      
      // Efficient query
      const grade = await db.collection("grades").findOne({
          madrasa_id: req.user.madrasa_id,
          min_marks: { $lte: marks },
          max_marks: { $gte: marks }
      });
      
      if (!grade) {
        return res.status(404).json({ success: false, message: "No grade found for given marks" });
      }
      
      res.status(200).json({ success: true, data: grade });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
  };

  // Delete grade
  const deleteGrade = async (req, res) => {
    const { db, client } = await mongoConnect();
    const { ObjectId } = require("mongodb");
    try {
      const result = await mongo.deleteData(db, "grades", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
      
      if (!result) {
        return res.status(404).json({ success: false, message: "Grade not found" });
      }
      
      res.status(200).json({ success: true, message: "Grade deleted successfully" });
    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      // await // client.close();
    }
  };

// Routes
router.get("/grades", getAllGrades);
router.get("/grades/:id", getGradeById);
router.get("/grades/marks/:marks", getGradeByMarks);
router.post("/grades", validate(gradeSchema), createGrade);
router.put("/grades/:id", validate(gradeSchema), updateGrade);
router.delete("/grades/:id", deleteGrade);

module.exports = router;
