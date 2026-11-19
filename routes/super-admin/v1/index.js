const router = require("express").Router();
const madrasaController = require("./madrasa.controller");
const plansController = require("./plans.controller");
const smsController = require("./sms.controller");
const authMiddleware = require("../../../middleware/authenticate");
const rbacMiddleware = require("../../../middleware/rbacMiddleware");

// All routes here should be protected and only for Super Admin
router.use(authMiddleware);
router.use(rbacMiddleware(['super_admin']));

// Madrasas Management Routes
router.post("/madrasas", madrasaController.createMadrasa);
router.get("/madrasas", madrasaController.getAllMadrasas);
router.put("/madrasas/:id", madrasaController.updateMadrasa);
router.delete("/madrasas/:id", madrasaController.deleteMadrasa);

// Dynamic Subscription Plans Management Routes
router.get("/plans", plansController.getAllPlans);
router.get("/plans/:id", plansController.getPlanById);
router.post("/plans", plansController.createPlan);
router.put("/plans/:id", plansController.updatePlan);
router.delete("/plans/:id", plansController.deletePlan);

// SMS Wallet & Recharges Configuration Routes
router.get("/sms/rates", smsController.getSmsRates);
router.put("/sms/rates", smsController.updateSmsRates);
router.get("/sms/recharges", smsController.getAllRecharges);
router.put("/sms/recharges/:id", smsController.processRecharge);

module.exports = router;
