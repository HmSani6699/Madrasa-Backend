const router = require("express").Router();
const madrasaController = require("./madrasa.controller");
const plansController = require("./plans.controller");
const smsController = require("./sms.controller");
const demoRequestController = require("../../demoRequest/v1/demoRequest.controller");
const reviewController = require("./review.controller");
const contactController = require("../../contact/v1/contact.controller");
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

// Demo Requests Management Routes
router.get("/demo-requests", demoRequestController.getAllDemoRequests);
router.patch("/demo-requests/:id/status", demoRequestController.updateDemoRequestStatus);
router.put("/demo-requests/:id/status", demoRequestController.updateDemoRequestStatus);
router.delete("/demo-requests/:id", demoRequestController.deleteDemoRequest);

// Demo Video Configuration Routes
router.get("/demo-video", demoRequestController.getDemoVideoSettings);
router.put("/demo-video", demoRequestController.updateDemoVideoSettings);

// Video Reviews Management Routes
router.get("/reviews", reviewController.getAllReviews);
router.get("/reviews/:id", reviewController.getReviewById);
router.post("/reviews", reviewController.createReview);
router.put("/reviews/:id", reviewController.updateReview);
router.patch("/reviews/:id/status", reviewController.toggleReviewStatus);
router.delete("/reviews/:id", reviewController.deleteReview);

// Contact Messages Management Routes
router.get("/contact-messages", contactController.getAllContactMessages);
router.patch("/contact-messages/:id/status", contactController.updateContactMessageStatus);
router.put("/contact-messages/:id/status", contactController.updateContactMessageStatus);
router.delete("/contact-messages/:id", contactController.deleteContactMessage);

module.exports = router;
