const router = require("express").Router();
const authController = require("./auth.controller");
const authMiddleware = require("../../../middleware/authenticate");

router.post("/login", authController.login);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);
router.get("/me", authMiddleware, authController.me);
router.use("/setup", require("./setup")); // Initial setup route

module.exports = router;
