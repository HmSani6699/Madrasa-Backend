const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const { ObjectId } = require("mongodb");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const issueSchema = Joi.object({
  book_id: Joi.string().required(),
  user_type: Joi.string().valid("Student", "Staff").required(),
  student_id: Joi.string().when('user_type', { is: 'Student', then: Joi.required(), otherwise: Joi.optional().allow("") }),
  staff_id: Joi.string().when('user_type', { is: 'Staff', then: Joi.required(), otherwise: Joi.optional().allow("") }),
  issue_date: Joi.date().default(Date.now),
  due_date: Joi.date().required(),
  remarks: Joi.string().allow("")
});

const returnSchema = Joi.object({
    return_date: Joi.date().default(Date.now),
    remarks: Joi.string().allow("")
});

// Get all issues
const getAllIssues = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.user_type) query.user_type = req.query.user_type;
    if (req.query.student_id) query.student_id = req.query.student_id;
    if (req.query.status) query.status = req.query.status; // Issued, Returned
    
    const issues = await mongo.fetchMany(db, "book_issues", query, {}, { issue_date: -1 });
    
    // Populate book info manually or aggregations
    // For simplicity, fetching basic info
    
    res.status(200).json({ success: true, data: issues });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Issue a book
const issueBook = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { book_id } = req.body;
    const madrasaId = req.user.madrasa_id;
    
    // Check availability
    const book = await mongo.fetchOne(db, "books", { _id: book_id, madrasa_id: madrasaId });
    if (!book) return res.status(404).json({ success: false, message: "Book not found" });
    
    if (book.available_qty <= 0) {
        return res.status(400).json({ success: false, message: "Book not available" });
    }

    const issueData = {
      ...req.body,
      madrasa_id: madrasaId,
      status: "Issued",
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const issue = await mongo.insertOne(db, "book_issues", issueData);
    
    // Decrease qty
    await db.collection("books").updateOne({ _id: new ObjectId(book_id), madrasa_id: madrasaId }, { $inc: { available_qty: -1 } });
    
    res.status(201).json({ success: true, data: issue });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Return a book
const returnBook = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const issueId = req.params.id;
    const madrasaId = req.user.madrasa_id;
    const issue = await mongo.fetchOne(db, "book_issues", { _id: issueId, madrasa_id: madrasaId });
    
    if (!issue) return res.status(404).json({ success: false, message: "Issue record not found" });
    if (issue.status === "Returned") return res.status(400).json({ success: false, message: "Book already returned" });

    // Mark as returned
    await db.collection("book_issues").updateOne(
        { _id: new ObjectId(issueId), madrasa_id: madrasaId },
        { 
            $set: { 
                status: "Returned", 
                return_date: req.body.return_date || new Date(),
                updated_at: Date.now()
            } 
        }
    );

    // Increase qty
    await db.collection("books").updateOne({ _id: new ObjectId(issue.book_id), madrasa_id: madrasaId }, { $inc: { available_qty: 1 } });
    
    res.status(200).json({ success: true, message: "Book returned successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/book-issues", getAllIssues);
router.post("/book-issues/issue", validate(issueSchema), issueBook);
router.post("/book-issues/return/:id", validate(returnSchema), returnBook);

module.exports = router;
