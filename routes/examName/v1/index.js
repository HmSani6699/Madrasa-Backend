const router = require("express").Router();
const root = require("app-root-path");
const { ObjectId } = require("mongodb");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Get all exam names
const getAllExamNames = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    const examNames = await mongo.fetchMany(db, "exam_names", query, {}, { name: 1 });
    const total = await mongo.documentCount(db, "exam_names", query);
    res.status(200).json({ success: true, data: examNames, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single exam name by ID
const getExamNameById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const examName = await mongo.fetchOne(db, "exam_names", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    if (!examName) {
      return res.status(404).json({ success: false, message: "Exam name not found" });
    }
    res.status(200).json({ success: true, data: examName });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new exam name
const createExamName = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const examNameData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const examName = await mongo.insertOne(db, "exam_names", examNameData);
    res.status(201).json({ success: true, data: examName });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update exam name
const updateExamName = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.updateData(
      db,
      "exam_names",
      { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Exam name not found" });
    }
    
    res.status(200).json({ success: true, message: "Exam name updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete exam name
const deleteExamName = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const result = await mongo.deleteData(db, "exam_names", { _id: new ObjectId(req.params.id), madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Exam name not found" });
    }
    
    res.status(200).json({ success: true, message: "Exam name deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/exam-names", getAllExamNames);
router.get("/exam-names/:id", getExamNameById);
router.post("/exam-names", createExamName);
router.put("/exam-names/:id", updateExamName);
router.delete("/exam-names/:id", deleteExamName);

module.exports = router;
