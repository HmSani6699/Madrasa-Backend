const router = require("express").Router();

router.use("/v1/donations", require("./v1"));

module.exports = router;
