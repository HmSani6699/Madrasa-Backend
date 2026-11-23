const router = require("express").Router();
const tutorialVideoController = require("./tutorialVideo.controller");
const authMiddleware = require("../../../middleware/authenticate");
const rbacMiddleware = require("../../../middleware/rbacMiddleware");

// Public route: fetch all published tutorial videos
router.get("/public", tutorialVideoController.getPublicTutorialVideos);

// Super Admin Protected Routes
router.get("/", authMiddleware, rbacMiddleware(["super_admin"]), tutorialVideoController.getAllTutorialVideos);
router.post("/", authMiddleware, rbacMiddleware(["super_admin"]), tutorialVideoController.upsertTutorialVideo);
router.put("/:id", authMiddleware, rbacMiddleware(["super_admin"]), tutorialVideoController.upsertTutorialVideo);
router.patch("/:id/status", authMiddleware, rbacMiddleware(["super_admin"]), tutorialVideoController.togglePublishStatus);
router.delete("/:id", authMiddleware, rbacMiddleware(["super_admin"]), tutorialVideoController.deleteTutorialVideo);

module.exports = router;
