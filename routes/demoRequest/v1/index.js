const router = require("express").Router();
const demoRequestController = require("./demoRequest.controller");

// Public route for fetching dynamic demo video settings
router.get("/video", demoRequestController.getPublicDemoVideo);

// Public route for fetching tutorial videos
const tutorialVideoController = require("../../tutorialVideo/v1/tutorialVideo.controller");
router.get("/tutorial-videos", tutorialVideoController.getPublicTutorialVideos);

// Public routes for submitting demo requests
router.post("/", demoRequestController.submitDemoRequest);
router.post("/submit", demoRequestController.submitDemoRequest);

module.exports = router;
