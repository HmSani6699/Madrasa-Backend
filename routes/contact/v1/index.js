const router = require("express").Router();
const contactController = require("./contact.controller");

// Health check / info for GET requests
router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Contact API is operational. Submit messages via POST /api/contact",
    endpoint: "/api/contact"
  });
});

// Public routes for submitting contact messages
router.post("/", contactController.submitContactMessage);
router.post("/submit", contactController.submitContactMessage);

module.exports = router;
