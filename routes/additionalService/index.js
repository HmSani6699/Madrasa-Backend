const router = require("express").Router();
const additionalServicesController = require("../super-admin/v1/additionalServices.controller");

// Public route for additional services on frontend
router.get("/", additionalServicesController.getPublicServices);

module.exports = router;
