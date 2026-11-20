const root = process.cwd();
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const DEFAULT_DEMO_VIDEO = {
  videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
  embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
  title: "মাদ্রাসা ম্যানেজমেন্ট সফটওয়্যার পরিচিতি ও ডেমো ভিডিও",
  description: "ভিডিওর মাধ্যমে সফটওয়্যারটির সকল আধুনিক ফিচার ও ব্যবহারবিধি বিস্তারিত দেখে নিন",
  isActive: true,
  updatedAt: new Date()
};

const getEmbedUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();

  // If already an embed url
  if (trimmed.includes("/embed/")) {
    return trimmed;
  }

  // YouTube match
  const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;
  }

  // Vimeo match
  const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return trimmed;
};

const demoRequestController = {
  // Public: Submit a new demo request
  submitDemoRequest: async (req, res) => {
    try {
      const {
        madrasaName,
        madrasaType,
        applicantName,
        designation,
        whatsapp,
        phone,
        district,
        address,
        studentCount,
        interestedFeatures,
        notes
      } = req.body;

      // Validation
      if (!madrasaName || !madrasaName.trim()) {
        return res.status(400).json({ success: false, message: "মাদ্রাসার নাম আবশ্যক।" });
      }
      if (!applicantName || !applicantName.trim()) {
        return res.status(400).json({ success: false, message: "আপনার নাম আবশ্যক।" });
      }
      if (!whatsapp || !whatsapp.trim()) {
        return res.status(400).json({ success: false, message: "হোয়াটসঅ্যাপ নম্বর আবশ্যক।" });
      }

      const { db } = await mongoConnect();

      // Clean phone numbers (remove spaces, dashes)
      const cleanWhatsapp = whatsapp.replace(/[\s\-()]/g, "");

      const newRequest = {
        madrasaName: madrasaName.trim(),
        madrasaType: madrasaType?.trim() || "কওমী মাদ্রাসা",
        applicantName: applicantName.trim(),
        designation: designation?.trim() || "মুহতামিম / প্রিন্সিপাল",
        whatsapp: cleanWhatsapp,
        phone: phone ? phone.replace(/[\s\-()]/g, "") : "",
        district: district?.trim() || "",
        address: address?.trim() || "",
        studentCount: studentCount || "১০০-২৫০ জন",
        interestedFeatures: Array.isArray(interestedFeatures) ? interestedFeatures : [],
        notes: notes?.trim() || "",
        status: "pending", // pending, contacted, portal_created, rejected
        adminNotes: "",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection("demo_requests").insertOne(newRequest);

      return res.status(201).json({
        success: true,
        message: "আপনার ফ্রি ডেমোর আবেদনটি সফলভাবে গৃহীত হয়েছে! আমাদের প্রতিনিধি অতি শীঘ্রই আপনার হোয়াটসঅ্যাপে যোগাযোগ করবেন।",
        data: {
          id: result.insertedId,
          ...newRequest
        }
      });
    } catch (error) {
      console.error("Demo Request Submission Error:", error);
      return res.status(500).json({
        success: false,
        message: "আবেদন জমা দিতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।"
      });
    }
  },

  // Super Admin: Get all demo requests with filtering & search
  getAllDemoRequests: async (req, res) => {
    try {
      const { search, status, page = 1, limit = 50 } = req.query;
      const { db } = await mongoConnect();

      let query = {};
      if (status && status !== "all") {
        query.status = status;
      }
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [
          { madrasaName: regex },
          { applicantName: regex },
          { whatsapp: regex },
          { district: regex }
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await db.collection("demo_requests").countDocuments(query);
      const items = await db.collection("demo_requests")
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      return res.status(200).json({
        success: true,
        data: items,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error("Get Demo Requests Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch demo requests"
      });
    }
  },

  // Super Admin: Update status & admin notes
  updateDemoRequestStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Request ID" });
      }

      const { db } = await mongoConnect();
      const updateData = {
        updatedAt: new Date()
      };
      if (status) updateData.status = status;
      if (typeof adminNotes === "string") updateData.adminNotes = adminNotes;

      const result = await db.collection("demo_requests").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "Demo request not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Status updated successfully",
        data: result
      });
    } catch (error) {
      console.error("Update Demo Request Status Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update demo request"
      });
    }
  },

  // Super Admin: Delete demo request
  deleteDemoRequest: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Request ID" });
      }

      const { db } = await mongoConnect();
      const result = await db.collection("demo_requests").deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "Demo request not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Demo request deleted successfully"
      });
    } catch (error) {
      console.error("Delete Demo Request Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete demo request"
      });
    }
  },

  // Public: Get dynamic demo video settings
  getPublicDemoVideo: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      let videoSettings = await db.collection("demo_video_settings").findOne();
      if (!videoSettings) {
        videoSettings = DEFAULT_DEMO_VIDEO;
      }
      return res.status(200).json({
        success: true,
        data: videoSettings
      });
    } catch (error) {
      console.error("Get Public Demo Video Error:", error);
      return res.status(200).json({
        success: true,
        data: DEFAULT_DEMO_VIDEO
      });
    }
  },

  // Super Admin: Get demo video settings
  getDemoVideoSettings: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      let videoSettings = await db.collection("demo_video_settings").findOne();
      if (!videoSettings) {
        await db.collection("demo_video_settings").insertOne({
          ...DEFAULT_DEMO_VIDEO,
          createdAt: new Date()
        });
        videoSettings = await db.collection("demo_video_settings").findOne();
      }
      return res.status(200).json({
        success: true,
        data: videoSettings
      });
    } catch (error) {
      console.error("Get Demo Video Settings Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও সেটিংস লোড করতে ব্যর্থ হয়েছে"
      });
    }
  },

  // Super Admin: Update demo video settings
  updateDemoVideoSettings: async (req, res) => {
    try {
      const { videoUrl, title, description, isActive } = req.body;
      if (!videoUrl || !videoUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: "ভিডিও লিঙ্ক প্রদান করা আবশ্যক"
        });
      }

      const embedUrl = getEmbedUrl(videoUrl);
      const updateData = {
        videoUrl: videoUrl.trim(),
        embedUrl,
        title: title?.trim() || "মাদ্রাসা ম্যানেজমেন্ট সফটওয়্যার পরিচিতি ও ডেমো ভিডিও",
        description: description?.trim() || "ভিডিওর মাধ্যমে সফটওয়্যারটির সকল আধুনিক ফিচার ও ব্যবহারবিধি বিস্তারিত দেখে নিন",
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        updatedAt: new Date()
      };

      const { db } = await mongoConnect();
      let videoSettings = await db.collection("demo_video_settings").findOne();

      if (!videoSettings) {
        await db.collection("demo_video_settings").insertOne({
          ...updateData,
          createdAt: new Date()
        });
      } else {
        await db.collection("demo_video_settings").updateOne(
          { _id: videoSettings._id },
          { $set: updateData }
        );
      }

      const updated = await db.collection("demo_video_settings").findOne();

      return res.status(200).json({
        success: true,
        message: "ভিডিও সেটিংস সফলভাবে আপডেট হয়েছে",
        data: updated
      });
    } catch (error) {
      console.error("Update Demo Video Settings Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও সেটিংস আপডেট করতে সমস্যা হয়েছে"
      });
    }
  }
};

module.exports = demoRequestController;
