const router = require("express").Router();
const root = process.cwd();
const portalController = require("./portal.controller");
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);

// Authenticated Madrasa Admin/Mohtamim portal settings routes (registered before /:slug)
router.get(
  "/manage/settings",
  authMiddleware,
  tenantMiddleware,
  rbacMiddleware(["admin", "mohtamim", "super_admin"]),
  portalController.getManagedPortalSettings
);
router.put(
  "/manage/settings",
  authMiddleware,
  tenantMiddleware,
  rbacMiddleware(["admin", "mohtamim", "super_admin"]),
  portalController.updateManagedPortalSettings
);

// Public routes
router.get("/:slug", portalController.getPortalData);
router.get("/:slug/academic-data", portalController.getAcademicData);
router.post("/:slug/admission", portalController.submitOnlineAdmission);
router.post("/:slug/contact", portalController.submitPortalContact);

module.exports = router;
