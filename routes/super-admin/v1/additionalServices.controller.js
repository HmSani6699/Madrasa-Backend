const root = process.cwd();
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

// Default initial services seed data
const DEFAULT_SERVICES = [
  {
    title: "ভর্তি প্রচারণা ভিডিও ও অ্যানিমেশন",
    category: "ডিজিটাল মিডিয়া ও মার্কেটিং",
    shortDesc: "নতুন শিক্ষাবর্ষে শিক্ষার্থী ভর্তির সংখ্যা বৃদ্ধি করতে প্রফেশনাল ইসলামিক ভিডিও ও সোশ্যাল মিডিয়া বিজ্ঞাপন।",
    description: "আপনার মাদরাসার সার্বিক সুযোগ-সুবিধা, হিফজ ও কিতাব বিভাগের বিশেষত্ব, দক্ষ শিক্ষকবৃন্দ এবং মনোরম পরিবেশ তুলে ধরে আকর্ষণীয় ফুল এইচডি প্রোমো ভিডিও। যা ফেসবুক ও ইউটিউবে প্রচারের মাধ্যমে দ্রুত শিক্ষার্থী ও অভিভাবকদের দৃষ্টি আকর্ষণ করে।",
    features: [
      "১০৮০p ফুল এইচডি প্রফেশনাল ভিডিও ও মোশন গ্রাফিক্স",
      "মার্জিত ইসলামিক ব্যাকগ্রাউন্ড সাউন্ড ও আকর্ষনীয় ভয়েসওভার",
      "ফেসবুক ও ইউটিউব সাইজ অনুযায়ী অপ্টিমাইজড ফরম্যাট",
      "সোশ্যাল মিডিয়া পেজে বুস্টিং ও প্রচারণার টেকনিক্যাল গাইডলাইন"
    ],
    price: "শুরু মাত্র ৩,০০০৳ থেকে",
    badge: "জনপ্রিয় ও ফলপ্রসূ",
    icon: "Video",
    image: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&q=80&w=800",
    order: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "স্মার্ট স্টুডেন্ট আইডি কার্ড ও ফিতা",
    category: "প্রিন্টিং ও ব্র্যান্ডিং",
    shortDesc: "প্রিমিয়াম পিভিসি প্লাস্টিক কার্ড, বারকোড/কিউআর কোড এবং মাদরাসার নামযুক্ত ডিজিটাল প্রিন্টেড ফিতা।",
    description: "শিক্ষার্থীদের সার্বিক নিরাপত্তা ও প্রতিষ্ঠানের আধুনিকায়নে ওয়াটারপ্রুফ টেকসই ডিজিটাল পিভিসি কার্ড। যা মাদরাসা সেবা সফটওয়্যারের সাথে অটো স্ক্যান হয়ে উপস্থিতি ও ফি কালেকশনে কাজ করে।",
    features: [
      "উন্নত মানের ওয়াটারপ্রুফ টেকসই পিভিসি প্লাস্টিক কার্ড",
      "সফটওয়্যার সাপোর্টেড ডিজিটাল কিউআর কোড ও বারকোড",
      "মাদরাসার নাম ও লোগো সম্বলিত প্রিমিয়াম সাটিন ফিতা ও হোল্ডার",
      "সম্পূর্ণ ফ্রি আধুনিক ও আকর্ষণীয় টেমপ্লেট ডিজাইন"
    ],
    price: "প্রতি পিস মাত্র ২৫৳ থেকে",
    badge: "প্রয়োজনীয় সামগ্রী",
    icon: "CreditCard",
    image: "https://images.unsplash.com/photo-1589330694653-dad6bc01cf0e?auto=format&fit=crop&q=80&w=800",
    order: 2,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "মাদরাসার তথ্য সংবলিত কাস্টমাইজড খাতা",
    category: "স্টেশনারি ও প্রিন্টিং",
    shortDesc: "মাদরাসার নাম, মনোগ্রাম, ক্লাসের রুটিন ও ইসলামিক নিয়মাবলী যুক্ত দৃষ্টিনন্দন খাতা ও ডায়েরি।",
    description: "শিক্ষার্থীদের ক্লাসের পড়া, হোমওয়ার্ক ও পরীক্ষার জন্য প্রিমিয়াম ৮০ জিএসএম স্মুথ পেপারের কাস্টমাইজড খাতা। খাতার কভারে মাদরাসার পরিচিতি, লক্ষ্য-উদ্দেশ্য ও জরুরি যোগাযোগের নম্বর থাকায় প্রতিষ্ঠানের ব্র্যান্ডিং ছড়িয়ে পড়ে।",
    features: [
      "মাদরাসার নিজস্ব লোগো ও ছবিযুক্ত চাররঙা গ্লসি প্রচ্ছদ",
      "৮০ জিএসএম প্রিমিয়াম স্মুথ হোয়াইট পেপার (লিখতে অত্যন্ত আরামদায়ক)",
      "ক্লাস ওয়ার্ক, হোমওয়ার্ক, হিফজ ট্র্যাকার ও পরীক্ষার জন্য উপযোগী",
      "বিভিন্ন সাইজ (দস্তা, ডিমাই) এবং পেজ সংখ্যায় কাস্টমাইজ করার সুবিধা"
    ],
    price: "প্রতি পিস মাত্র ৩৫৳ থেকে",
    badge: "ব্র্যান্ডিং সামগ্রী",
    icon: "BookOpen",
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=800",
    order: 3,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    title: "স্মার্ট পিওএস মেশিন ও প্রিন্টার",
    category: "হার্ডওয়্যার ও অটোমেশন",
    shortDesc: "সফটওয়্যারের সাথে কানেক্টেড তাত্ক্ষণিক ফি কালেকশন মানি রিসিট ও টোকেন প্রিন্টিং ডিভাইস।",
    description: "মাদরাসার হিসাব শাখায় ফি গ্রহণ করা মাত্রই শিক্ষার্থী ও অভিভাবকদের হাতে স্বয়ংক্রিয়ভাবে মানি রিসিট তুলে দেওয়ার জন্য ক্লাউড সমর্থিত ব্লুটুথ ও ওয়াইফাই থার্মাল পিওএস প্রিন্টার। কোনো কালি লাগেনা, বিদ্যুৎ সাশ্রয়ী ও দীর্ঘস্থায়ী।",
    features: [
      "মাদ্রাসা সেবা সফটওয়্যারের সাথে ওয়ান-ক্লিক অটো কানেক্টিভিটি",
      "দ্রুতগতির অটো কাটিং ২ বা ৩ ইঞ্চি থার্মাল পেপার প্রিন্টিং (নো ইংক)",
      "ওয়াইফাই, ব্লুটুথ এবং ইউএসবি কেবল সংযোগ সুবিধা",
      "১ বছরের অফিসিয়াল রিপ্লেসমেন্ট ওয়ারেন্টি ও ফ্রি টেকনিক্যাল সাপোর্ট"
    ],
    price: "শুরু মাত্র ৫,৫০০৳ থেকে",
    badge: "স্মার্ট হার্ডওয়্যার",
    icon: "Printer",
    image: "https://images.unsplash.com/photo-1556742049-0a67e557224d?auto=format&fit=crop&q=80&w=800",
    order: 4,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const seedServicesIfEmpty = async (db) => {
  try {
    const count = await db.collection("additional_services").countDocuments();
    if (count === 0) {
      await db.collection("additional_services").insertMany(DEFAULT_SERVICES);
      console.log("Seeded initial additional services successfully");
    }
  } catch (err) {
    console.error("Seed additional services error:", err);
  }
};

const additionalServicesController = {
  // Public: Get all active services for frontend display
  getPublicServices: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      await seedServicesIfEmpty(db);

      const services = await db
        .collection("additional_services")
        .find({ isActive: true })
        .sort({ order: 1, createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        data: services
      });
    } catch (error) {
      console.error("Get Public Additional Services Error:", error);
      return res.status(200).json({
        success: true,
        data: DEFAULT_SERVICES
      });
    }
  },

  // Super Admin: Get all services (with search, status filter, category filter)
  getAllServices: async (req, res) => {
    try {
      const { status, search, category } = req.query;
      const { db } = await mongoConnect();
      await seedServicesIfEmpty(db);

      let query = {};
      if (status === "active") query.isActive = true;
      if (status === "inactive") query.isActive = false;

      if (category && category.trim() && category !== "all") {
        query.category = category.trim();
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [
          { title: regex },
          { category: regex },
          { shortDesc: regex },
          { description: regex },
          { price: regex }
        ];
      }

      const services = await db
        .collection("additional_services")
        .find(query)
        .sort({ order: 1, createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        count: services.length,
        data: services
      });
    } catch (error) {
      console.error("Super Admin Get Services Error:", error);
      return res.status(500).json({
        success: false,
        message: "সেবা ও সামগ্রী তালিকা লোড করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Get single service by ID
  getServiceById: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর সেবা আইডি।" });
      }

      const { db } = await mongoConnect();
      const service = await db.collection("additional_services").findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ success: false, message: "সেবা পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        data: service
      });
    } catch (error) {
      console.error("Get Service By ID Error:", error);
      return res.status(500).json({
        success: false,
        message: "সেবা লোড করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Create a new service/product
  createService: async (req, res) => {
    try {
      const {
        title,
        category,
        shortDesc,
        description,
        features,
        price,
        badge,
        icon,
        image,
        order,
        isActive
      } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: "সেবার শিরোনাম/নাম আবশ্যক।" });
      }

      let parsedFeatures = [];
      if (Array.isArray(features)) {
        parsedFeatures = features.map(f => typeof f === "string" ? f.trim() : "").filter(Boolean);
      } else if (typeof features === "string") {
        parsedFeatures = features.split("\n").map(f => f.trim()).filter(Boolean);
      }

      const parsedOrder = order !== undefined && order !== null && !isNaN(Number(order))
        ? Number(order)
        : 1;

      const newService = {
        title: title.trim(),
        category: category?.trim() || "সাধারণ সেবা",
        shortDesc: shortDesc?.trim() || "",
        description: description?.trim() || "",
        features: parsedFeatures,
        price: price?.trim() || "আলোচনা সাপেক্ষে",
        badge: badge?.trim() || "",
        icon: icon?.trim() || "Sparkles",
        image: image?.trim() || "",
        order: parsedOrder,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const { db } = await mongoConnect();
      const result = await db.collection("additional_services").insertOne(newService);

      return res.status(201).json({
        success: true,
        message: "নতুন সেবা সফলভাবে যুক্ত হয়েছে।",
        data: {
          _id: result.insertedId,
          ...newService
        }
      });
    } catch (error) {
      console.error("Create Service Error:", error);
      return res.status(500).json({
        success: false,
        message: "সেবা তৈরি করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Update a service/product
  updateService: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর সেবা আইডি।" });
      }

      const {
        title,
        category,
        shortDesc,
        description,
        features,
        price,
        badge,
        icon,
        image,
        order,
        isActive
      } = req.body;

      const updateData = {
        updatedAt: new Date()
      };

      if (title !== undefined) updateData.title = title.trim();
      if (category !== undefined) updateData.category = category.trim();
      if (shortDesc !== undefined) updateData.shortDesc = shortDesc.trim();
      if (description !== undefined) updateData.description = description.trim();
      if (price !== undefined) updateData.price = price.trim();
      if (badge !== undefined) updateData.badge = badge.trim();
      if (icon !== undefined) updateData.icon = icon.trim();
      if (image !== undefined) updateData.image = image.trim();
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      if (order !== undefined && !isNaN(Number(order))) {
        updateData.order = Number(order);
      }

      if (features !== undefined) {
        if (Array.isArray(features)) {
          updateData.features = features.map(f => typeof f === "string" ? f.trim() : "").filter(Boolean);
        } else if (typeof features === "string") {
          updateData.features = features.split("\n").map(f => f.trim()).filter(Boolean);
        }
      }

      const { db } = await mongoConnect();
      const result = await db
        .collection("additional_services")
        .updateOne({ _id: new ObjectId(id) }, { $set: updateData });

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "সেবা পাওয়া যায়নি।" });
      }

      const updated = await db.collection("additional_services").findOne({ _id: new ObjectId(id) });

      return res.status(200).json({
        success: true,
        message: "সেবা সফলভাবে আপডেট হয়েছে।",
        data: updated
      });
    } catch (error) {
      console.error("Update Service Error:", error);
      return res.status(500).json({
        success: false,
        message: "সেবা আপডেট করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Toggle status
  toggleServiceStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর সেবা আইডি।" });
      }

      const { db } = await mongoConnect();
      const result = await db
        .collection("additional_services")
        .updateOne(
          { _id: new ObjectId(id) },
          { $set: { isActive: Boolean(isActive), updatedAt: new Date() } }
        );

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "সেবা পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        message: `সেবাটি সফলভাবে ${isActive ? "সক্রিয়" : "নিষ্ক্রিয়"} করা হয়েছে।`
      });
    } catch (error) {
      console.error("Toggle Service Status Error:", error);
      return res.status(500).json({
        success: false,
        message: "স্ট্যাটাস পরিবর্তন করতে সমস্যা হয়েছে।"
      });
    }
  },

  // Super Admin: Delete a service/product
  deleteService: async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "অকার্যকর সেবা আইডি।" });
      }

      const { db } = await mongoConnect();
      const result = await db.collection("additional_services").deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "সেবা পাওয়া যায়নি।" });
      }

      return res.status(200).json({
        success: true,
        message: "সেবাটি সফলভাবে মুছে ফেলা হয়েছে।"
      });
    } catch (error) {
      console.error("Delete Service Error:", error);
      return res.status(500).json({
        success: false,
        message: "সেবা মুছতে সমস্যা হয়েছে।"
      });
    }
  }
};

module.exports = additionalServicesController;
