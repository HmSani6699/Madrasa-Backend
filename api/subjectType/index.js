const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");

router.use("/v1", authenticate, require("./v1"));

module.exports = router;
