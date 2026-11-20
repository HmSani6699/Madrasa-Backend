const router = require("express").Router();
const reviewController = require("../super-admin/v1/review.controller");

// Public routes for video reviews
router.get("/", reviewController.getPublicReviews);

module.exports = router;
