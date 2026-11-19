const router = require("express").Router();
const demoRequestController = require("./demoRequest.controller");

// Public routes for submitting demo requests
router.post("/", demoRequestController.submitDemoRequest);
router.post("/submit", demoRequestController.submitDemoRequest);

module.exports = router;
