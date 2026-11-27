const router = require("express").Router();

router.use("/v1/ledger-entries", require("./v1"));

module.exports = router;
