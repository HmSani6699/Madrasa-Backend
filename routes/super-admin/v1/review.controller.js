const root = process.cwd();
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

// Helper: Extract YouTube 11-char Video ID
const extractYouTubeId = (url) => {
  if (!url || typeof url !== "string") return null;
  const match = url.trim().match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/
  );
  return match ? match[1] : null;
};

// Helper: Compute embed URL
const computeEmbedUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (trimmed.includes("/embed/")) {
    return trimmed;
  }
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    return `https://www.youtube-nocookie.com/embed/${ytId}`;
  }
  return trimmed;
};

// Helper: Compute high quality thumbnail URL
const computeThumbnailUrl = (url, customThumb) => {
  if (customThumb && typeof customThumb === "string" && customThumb.trim()) {
    return customThumb.trim();
  }
  const ytId = extractYouTubeId(url);
  if (ytId) {
    return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  }
  return "";
};

// Default seed reviews
const DEFAULT_REVIEWS = [
  {
    reviewerName: "মাওলানা আবদুর রহমান",
    designation: "প্রিন্সিপাল",
    madrasaName: "দারুল উলুম মাদ্রাসা",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    rating: 5,
    quote: "মাদ্রাসা সেবা ব্যবহার করে আমরা প্রতিষ্ঠানের কাজের গতি কয়েকগুণ বাড়িয়ে নিতে পেরেছি। আলহামদুলিল্লাহ।",
    order: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    reviewerName: "মুফতি সাইফুল ইসলাম",
    designation: "পরিচালক",
    madrasaName: "জামিয়া কাসিমিয়া",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    rating: 5,
    quote: "ফি কালেকশন ও একাউন্টস এতো সহজ আগে কখনো মনে হয়নি। অভিভাবকরাও খুব খুশি এসএমএস সিস্টেমে।",
    order: 2,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    reviewerName: "হাফেজ আবু বকর",
    designation: "শিক্ষক",
    madrasaName: "আল-আমিন একাডেমি",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    rating: 5,
    quote: "বাংলা সাপোর্ট ও ইসলামিক ডিজাইন আমাদের জন্য পারফেক্ট। সাপোর্ট টিম সবসময় আন্তরিক ও তৎপর।",
    order: 3,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const seedReviewsIfEmpty = async (db) => {
  const count = await db.collection("video_reviews").countDocuments();
  if (count === 0) {
    await db.collection("video_reviews").insertMany(DEFAULT_REVIEWS);
  }
};

const reviewController = {
  // Public: Get all active reviews for frontend display
  getPublicReviews: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      await seedReviewsIfEmpty(db);

      const reviews = await db
        .collection("video_reviews")
        .find({ isActive: true })
        .sort({ order: 1, createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        data: reviews
      });
    } catch (error) {
      console.error("Get Public Reviews Error:", error);
      return res.status(200).json({
        success: true,
        data: DEFAULT_REVIEWS
      });
    }
  },

  // Super Admin: Get all reviews (with optional search and status filter)
  getAllReviews: async (req, res) => {
    try {
      const { status, search } = req.query;
      const { db } = await mongoConnect();
      await seedReviewsIfEmpty(db);

      let query = {};
      if (status === "active") query.isActive = true;
      if (status === "inactive") query.isActive = false;

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [
          { reviewerName: regex },
          { madrasaName: regex },
          { designation: regex },
          { quote: regex }
        ];
      }

      const reviews = await db
        .collection("video_reviews")
        .find(query)
        .sort({ order: 1, createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        count: reviews.length,
        data: reviews
      });
    } catch (error) {
      console.error("Super Admin Get Reviews Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও রিভিউ লোড করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Get single review by ID
  getReviewById: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর রিভিউ আইডি।" });
      }

      const { db } = await mongoConnect();
      const review = await db.collection("video_reviews").findOne({ _id: new ObjectId(id) });

      if (!review) {
        return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        data: review
      });
    } catch (error) {
      console.error("Get Review By ID Error:", error);
      return res.status(500).json({
        success: false,
        message: "রিভিউ লোড করতে ব্যর্থ হয়েছে।"
      });
    }
  },

  // Super Admin: Create a new video review
  createReview: async (req, res) => {
    try {
      const {
        reviewerName,
        designation,
        madrasaName,
        videoUrl,
        rating,
        quote,
        order,
        isActive,
        customThumbnail
      } = req.body;

      // Validation
      if (!reviewerName || !reviewerName.trim()) {
        return res.status(400).json({ success: false, message: "রিভিউয়ারের নাম আবশ্যক।" });
      }
      if (!madrasaName || !madrasaName.trim()) {
        return res.status(400).json({ success: false, message: "মাদ্রাসার নাম আবশ্যক।" });
      }
      if (!videoUrl || !videoUrl.trim()) {
        return res.status(400).json({ success: false, message: "ইউটিউব ভিডিও লিঙ্ক আবশ্যক।" });
      }

      const youtubeId = extractYouTubeId(videoUrl);
      const embedUrl = computeEmbedUrl(videoUrl);
      const thumbnailUrl = computeThumbnailUrl(videoUrl, customThumbnail);

      const parsedOrder = order !== undefined && order !== null && !isNaN(Number(order))
        ? Number(order)
        : 1;

      const parsedRating = rating !== undefined && rating !== null && !isNaN(Number(rating))
        ? Math.max(1, Math.min(5, Number(rating)))
        : 5;

      const newReview = {
        reviewerName: reviewerName.trim(),
        designation: designation?.trim() || "মুহতামিম / প্রিন্সিপাল",
        madrasaName: madrasaName.trim(),
        videoUrl: videoUrl.trim(),
        embedUrl,
        youtubeId: youtubeId || "",
        thumbnailUrl,
        rating: parsedRating,
        quote: quote?.trim() || "",
        order: parsedOrder,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const { db } = await mongoConnect();
      const result = await db.collection("video_reviews").insertOne(newReview);

      return res.status(201).json({
        success: true,
        message: "ভিডিও রিভিউ সফলভাবে তৈরি হয়েছে।",
        data: {
          _id: result.insertedId,
          ...newReview
        }
      });
    } catch (error) {
      console.error("Create Review Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও রিভিউ তৈরি করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Update a video review
  updateReview: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর রিভিউ আইডি।" });
      }

      const {
        reviewerName,
        designation,
        madrasaName,
        videoUrl,
        rating,
        quote,
        order,
        isActive,
        customThumbnail
      } = req.body;

      const updateData = {
        updatedAt: new Date()
      };

      if (reviewerName !== undefined) updateData.reviewerName = reviewerName.trim();
      if (designation !== undefined) updateData.designation = designation.trim();
      if (madrasaName !== undefined) updateData.madrasaName = madrasaName.trim();
      if (quote !== undefined) updateData.quote = quote.trim();
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      if (order !== undefined && !isNaN(Number(order))) {
        updateData.order = Number(order);
      }

      if (rating !== undefined && !isNaN(Number(rating))) {
        updateData.rating = Math.max(1, Math.min(5, Number(rating)));
      }

      if (videoUrl && videoUrl.trim()) {
        updateData.videoUrl = videoUrl.trim();
        updateData.embedUrl = computeEmbedUrl(videoUrl);
        updateData.youtubeId = extractYouTubeId(videoUrl) || "";
        updateData.thumbnailUrl = computeThumbnailUrl(videoUrl, customThumbnail);
      } else if (customThumbnail !== undefined) {
        updateData.thumbnailUrl = customThumbnail.trim();
      }

      const { db } = await mongoConnect();
      const result = await db.collection("video_reviews").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        message: "ভিডিও রিভিউ সফলভাবে আপডেট হয়েছে।",
        data: result
      });
    } catch (error) {
      console.error("Update Review Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও রিভিউ আপডেট করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Toggle review active status
  toggleReviewStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর রিভিউ আইডি।" });
      }

      const { db } = await mongoConnect();
      const current = await db.collection("video_reviews").findOne({ _id: new ObjectId(id) });
      if (!current) {
        return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি।" });
      }

      const newStatus = isActive !== undefined ? Boolean(isActive) : !current.isActive;

      const result = await db.collection("video_reviews").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { isActive: newStatus, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      return res.status(200).json({
        success: true,
        message: `রিভিউটি সফলভাবে ${newStatus ? "সক্রিয়" : "নিষ্ক্রিয়"} করা হয়েছে।`,
        data: result
      });
    } catch (error) {
      console.error("Toggle Review Status Error:", error);
      return res.status(500).json({
        success: false,
        message: "স্ট্যাটাস পরিবর্তন করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Delete review
  deleteReview: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর রিভিউ আইডি।" });
      }

      const { db } = await mongoConnect();
      const result = await db.collection("video_reviews").deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "রিভিউ পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        message: "ভিডিও রিভিউ সফলভাবে মুছে ফেলা হয়েছে।"
      });
    } catch (error) {
      console.error("Delete Review Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও রিভিউ মুছতে সমস্যা হয়েছে।"
      });
    }
  }
};

module.exports = reviewController;
