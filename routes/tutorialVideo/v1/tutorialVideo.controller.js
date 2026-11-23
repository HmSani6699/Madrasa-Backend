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
  const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }
  return trimmed;
};

// Helper: Compute high-quality thumbnail
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

// Default seed tutorial videos for the system so it starts pre-loaded
const DEFAULT_TUTORIAL_VIDEOS = [
  {
    panelKey: "admin",
    menuKey: "admission-create",
    path: "/admin/admission/create",
    mainMenu: "ভর্তি",
    mainMenuEn: "Admission",
    subMenu: "ভর্তি ফর্ম",
    subMenuEn: "Create Admission",
    title: "ভর্তি ফর্ম পূরণ ও নতুন শিক্ষার্থী ভর্তি প্রক্রিয়া",
    description: "নতুন শিক্ষার্থীর ভর্তি ফর্ম সঠিকভাবে পূরণ, ছবি ও নথি আপলোড এবং স্বয়ংক্রিয় রোল ও রেজিস্ট্রেশন আইডি তৈরির সম্পূর্ণ নির্দেশিকা।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০৩:৪৫ মিনিট",
    order: 1,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    panelKey: "admin",
    menuKey: "admission-list",
    path: "/admin/student/list",
    mainMenu: "ভর্তি",
    mainMenuEn: "Admission",
    subMenu: "ছাত্র-ছাত্রী তালিকা",
    subMenuEn: "Student List",
    title: "সকল শিক্ষার্থী তালিকা ও প্রোফাইল অনুসন্ধান",
    description: "ক্লাস ও সেকশন অনুযায়ী শিক্ষার্থীদের তালিকা ফিল্টারিং, প্রোফাইল দেখা ও স্টুডেন্ট ডাটা এক্সপোর্ট করার নিয়ম।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০২:৩০ মিনিট",
    order: 2,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    panelKey: "admin",
    menuKey: "admission-online",
    path: "/admin/admissions/online",
    mainMenu: "ভর্তি",
    mainMenuEn: "Admission",
    subMenu: "অনলাইন ভর্তি",
    subMenuEn: "Online Admission",
    title: "অনলাইন ভর্তি আবেদন যাচাই ও অনুমোদন",
    description: "অভিভাবকদের পাঠানো অনলাইন আবেদন যাচাই-বাছাই ও এক ক্লিকে ভর্তি তালিকায় অন্তর্ভুক্ত করার উপায়।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০৩:১০ মিনিট",
    order: 3,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    panelKey: "admin",
    menuKey: "dashboard",
    path: "/admin",
    mainMenu: "ড্যাশবোর্ড",
    mainMenuEn: "Dashboard",
    subMenu: "ওভারভিউ",
    subMenuEn: "Overview",
    title: "মূল ড্যাশবোর্ড পরিচিতি ও গুরুত্বপূর্ণ পরিসংখ্যান",
    description: "মাদ্রাসার দৈনিক উপস্থিতি, ফি কালেকশন, মোট শিক্ষার্থী ও শিক্ষক-কর্মচারীর সার্বিক পরিসংখ্যান সহজে পর্যবেক্ষণ।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০২:১৫ মিনিট",
    order: 0,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    panelKey: "admin",
    menuKey: "fees-collect",
    path: "/admin/accounting/fees/collect",
    mainMenu: "অফিস হিসাবরক্ষণ",
    mainMenuEn: "Office Accounting",
    subMenu: "ফি গ্রহণ",
    subMenuEn: "Collect Fees",
    title: "শিক্ষার্থীদের ফি গ্রহণ ও রশিদ প্রিন্ট",
    description: "মাসিক বেতন, পরীক্ষা ফি ও অন্যান্য ফি কালেকশন, ডিসকাউন্ট প্রয়োগ ও স্বয়ংক্রিয় মানি রিসিট প্রিন্টের বিস্তারিত গাইড।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০৪:০৫ মিনিট",
    order: 4,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    panelKey: "admin",
    menuKey: "attendance-student",
    path: "/admin/attendance/student",
    mainMenu: "উপস্থিতি",
    mainMenuEn: "Attendance",
    subMenu: "ছাত্র উপস্থিতি",
    subMenuEn: "Student Attendance",
    title: "দৈনিক ছাত্র হাজিরা ও অনুপস্থিতি এসএমএস",
    description: "ক্লাসভিত্তিক ছাত্র উপস্থিতি গ্রহণ এবং অনুপস্থিত শিক্ষার্থীদের অভিভাবকদের কাছে স্বয়ংক্রিয় সতর্কবার্তা এসএমএস প্রেরণ।",
    videoUrl: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
    embedUrl: "https://www.youtube-nocookie.com/embed/ScMzIvxBSi4",
    youtubeId: "ScMzIvxBSi4",
    thumbnailUrl: "https://img.youtube.com/vi/ScMzIvxBSi4/hqdefault.jpg",
    duration: "০২:৫০ মিনিট",
    order: 5,
    isPublished: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const tutorialVideoController = {
  // Public: Get all published tutorial videos
  getPublicTutorialVideos: async (req, res) => {
    try {
      const { panelKey } = req.query;
      const { db } = await mongoConnect();
      const collection = db.collection("demo_tutorial_videos");

      // Auto-seed if collection is completely empty
      const count = await collection.countDocuments();
      if (count === 0) {
        await collection.insertMany(DEFAULT_TUTORIAL_VIDEOS);
      }

      const filter = { isPublished: true };
      if (panelKey) {
        filter.panelKey = panelKey;
      }

      const videos = await collection.find(filter).sort({ order: 1, createdAt: 1 }).toArray();

      return res.status(200).json({
        success: true,
        data: videos,
        total: videos.length
      });
    } catch (error) {
      console.error("Get Public Tutorial Videos Error:", error);
      // Return defaults on error so frontend never breaks
      return res.status(200).json({
        success: true,
        data: DEFAULT_TUTORIAL_VIDEOS,
        total: DEFAULT_TUTORIAL_VIDEOS.length
      });
    }
  },

  // Super Admin: Get all tutorial videos (published & unpublished)
  getAllTutorialVideos: async (req, res) => {
    try {
      const { panelKey, search, isPublished } = req.query;
      const { db } = await mongoConnect();
      const collection = db.collection("demo_tutorial_videos");

      // Auto-seed if empty
      const count = await collection.countDocuments();
      if (count === 0) {
        await collection.insertMany(DEFAULT_TUTORIAL_VIDEOS);
      }

      const filter = {};
      if (panelKey && panelKey !== "all") {
        filter.panelKey = panelKey;
      }
      if (isPublished !== undefined && isPublished !== "all") {
        filter.isPublished = isPublished === "true" || isPublished === true;
      }
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { title: regex },
          { mainMenu: regex },
          { subMenu: regex },
          { path: regex },
          { description: regex }
        ];
      }

      const videos = await collection.find(filter).sort({ order: 1, updatedAt: -1 }).toArray();

      return res.status(200).json({
        success: true,
        data: videos,
        total: videos.length
      });
    } catch (error) {
      console.error("Get All Tutorial Videos Error:", error);
      return res.status(500).json({
        success: false,
        message: "টিউটোরিয়াল ভিডিও লোড করতে ব্যর্থ হয়েছে"
      });
    }
  },

  // Super Admin: Create or Upsert a tutorial video for a menu item
  upsertTutorialVideo: async (req, res) => {
    try {
      const {
        id,
        panelKey = "admin",
        menuKey,
        path,
        mainMenu,
        mainMenuEn,
        subMenu,
        subMenuEn,
        title,
        description,
        videoUrl,
        duration,
        isPublished = true,
        order = 0
      } = req.body;

      if (!videoUrl || !videoUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: "ভিডিও লিঙ্ক প্রদান করা আবশ্যক"
        });
      }

      const embedUrl = computeEmbedUrl(videoUrl);
      const youtubeId = extractYouTubeId(videoUrl);
      const thumbnailUrl = computeThumbnailUrl(videoUrl);

      const { db } = await mongoConnect();
      const collection = db.collection("demo_tutorial_videos");

      const updatePayload = {
        panelKey,
        menuKey: menuKey || (path ? path.replace(/^\//, '').replace(/\//g, '-') : "general"),
        path: path || "",
        mainMenu: mainMenu?.trim() || "প্রধান মেনু",
        mainMenuEn: mainMenuEn?.trim() || "Main Menu",
        subMenu: subMenu?.trim() || "সাবমেনু",
        subMenuEn: subMenuEn?.trim() || "Submenu",
        title: title?.trim() || `${mainMenu || "ফিচার"} - ${subMenu || "টিউটোরিয়াল"}`,
        description: description?.trim() || "",
        videoUrl: videoUrl.trim(),
        embedUrl,
        youtubeId,
        thumbnailUrl,
        duration: duration?.trim() || "",
        isPublished: Boolean(isPublished),
        order: Number(order) || 0,
        updatedAt: new Date()
      };

      if (id && ObjectId.isValid(id)) {
        // Update by ID
        const result = await collection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatePayload }
        );
        const updatedDoc = await collection.findOne({ _id: new ObjectId(id) });
        return res.status(200).json({
          success: true,
          message: "ভিডিও টিউটোরিয়াল সফলভাবে আপডেট হয়েছে",
          data: updatedDoc
        });
      }

      // If matched by path or menuKey + panelKey, upsert
      const query = path 
        ? { panelKey, path } 
        : { panelKey, menuKey: updatePayload.menuKey };

      const existing = await collection.findOne(query);

      if (existing) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: updatePayload }
        );
        const updatedDoc = await collection.findOne({ _id: existing._id });
        return res.status(200).json({
          success: true,
          message: "ভিডিও টিউটোরিয়াল সফলভাবে আপডেট হয়েছে",
          data: updatedDoc
        });
      }

      // Insert new
      updatePayload.createdAt = new Date();
      const insertResult = await collection.insertOne(updatePayload);
      const newDoc = await collection.findOne({ _id: insertResult.insertedId });

      return res.status(201).json({
        success: true,
        message: "নতুন ভিডিও টিউটোরিয়াল সফলভাবে যুক্ত হয়েছে",
        data: newDoc
      });
    } catch (error) {
      console.error("Upsert Tutorial Video Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও টিউটোরিয়াল সংরক্ষণ করতে ব্যর্থ হয়েছে"
      });
    }
  },

  // Super Admin: Toggle Publish Status
  togglePublishStatus: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "ভুল আইডি" });
      }

      const { db } = await mongoConnect();
      const collection = db.collection("demo_tutorial_videos");

      const item = await collection.findOne({ _id: new ObjectId(id) });
      if (!item) {
        return res.status(404).json({ success: false, message: "ভিডিও পাওয়া যায়নি" });
      }

      const newStatus = !item.isPublished;
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isPublished: newStatus, updatedAt: new Date() } }
      );

      return res.status(200).json({
        success: true,
        message: newStatus ? "ভিডিও সফলভাবে পাবলিশ করা হয়েছে" : "ভিডিও আনপাবলিশ (ড্রাফট) করা হয়েছে",
        data: { _id: id, isPublished: newStatus }
      });
    } catch (error) {
      console.error("Toggle Publish Status Error:", error);
      return res.status(500).json({
        success: false,
        message: "স্ট্যাটাস পরিবর্তন ব্যর্থ হয়েছে"
      });
    }
  },

  // Super Admin: Delete tutorial video
  deleteTutorialVideo: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "ভুল আইডি" });
      }

      const { db } = await mongoConnect();
      const result = await db.collection("demo_tutorial_videos").deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "ভিডিও পাওয়া যায়নি" });
      }

      return res.status(200).json({
        success: true,
        message: "ভিডিও সফলভাবে মুছে ফেলা হয়েছে"
      });
    } catch (error) {
      console.error("Delete Tutorial Video Error:", error);
      return res.status(500).json({
        success: false,
        message: "ভিডিও মুছতে সমস্যা হয়েছে"
      });
    }
  }
};

module.exports = tutorialVideoController;
