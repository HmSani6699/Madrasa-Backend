const router = require("express").Router();
const portalController = require("./portal.controller");

// Public routes
router.get("/:slug", portalController.getPortalData);
router.get("/:slug/academic-data", portalController.getAcademicData);
router.post("/:slug/admission", portalController.submitOnlineAdmission);

module.exports = router;
