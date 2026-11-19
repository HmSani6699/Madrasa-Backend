const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

// Joi Schema
const bookSchema = Joi.object({
  title: Joi.string().required(),
  author: Joi.string().required(),
  isbn: Joi.string().allow(""),
  category: Joi.string().required(), // Fiction, Science, etc.
  quantity: Joi.number().min(0).required(),
  shelf_location: Joi.string().allow(""),
  description: Joi.string().allow("")
});

// Get all books
const getAllBooks = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { madrasa_id: req.user.madrasa_id };
    if (req.query.category) query.category = req.query.category;
    if (req.query.author) query.author = { $regex: req.query.author, $options: "i" };
    if (req.query.title) query.title = { $regex: req.query.title, $options: "i" };
    
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 0;
    
    const books = await mongo.fetchMany(db, "books", query, {}, { title: 1 }, limit, page);
    const total = await mongo.documentCount(db, "books", query);
    res.status(200).json({ success: true, data: books, total });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Get single book by ID
const getBookById = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const book = await mongo.fetchOne(db, "books", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    if (!book) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }
    res.status(200).json({ success: true, data: book });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Create new book
const createBook = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const bookData = {
      ...req.body,
      madrasa_id: req.user.madrasa_id,
      available_qty: req.body.quantity, // Initially available = total
      created_at: Date.now(),
      updated_at: Date.now()
    };
    
    const book = await mongo.insertOne(db, "books", bookData);
    res.status(201).json({ success: true, data: book });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Update book
const updateBook = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // If quantity is updated, need to adjust available_qty intelligently
    // For simplicity, we assume robust manual management if total quantity changes
    // or we calculate valid difference.
    
    // Simple approach: Update fields. If quantity increases, increase available.
    // If quantity decreases, ensure it doesn't drop below issued count (total - available).
    
    const result = await mongo.updateData(
      db,
      "books",
      { _id: req.params.id, madrasa_id: req.user.madrasa_id },
      {
        $set: {
          ...req.body,
          updated_at: Date.now()
        }
      }
    );
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }
    
    res.status(200).json({ success: true, message: "Book updated successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Delete book
const deleteBook = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    // Check if issued
    // const issued = await mongo.documentCount(db, "book_issues", { book_id: req.params.id, madrasa_id: req.user.madrasa_id, status: "Issued" });
    
    const result = await mongo.deleteData(db, "books", { _id: req.params.id, madrasa_id: req.user.madrasa_id });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Book not found" });
    }
    
    res.status(200).json({ success: true, message: "Book deleted successfully" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

// Routes
router.get("/books", getAllBooks);
router.get("/books/:id", getBookById);
router.post("/books", validate(bookSchema), createBook);
router.put("/books/:id", validate(bookSchema), updateBook);
router.delete("/books/:id", deleteBook);

module.exports = router;
