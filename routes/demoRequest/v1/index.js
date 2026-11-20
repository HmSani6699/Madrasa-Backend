const router = require("express").Router();
const demoRequestController = require("./demoRequest.controller");

// Public route for fetching dynamic demo video settings
router.get("/video", demoRequestController.getPublicDemoVideo);

// Public routes for submitting demo requests
router.post("/", demoRequestController.submitDemoRequest);
router.post("/submit", demoRequestController.submitDemoRequest);

module.exports = router;
