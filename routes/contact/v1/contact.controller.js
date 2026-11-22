const path = require("path");
let mongoConnect;
try {
  mongoConnect = require(path.resolve(__dirname, "../../../services/mongo-connect"));
} catch (e) {
  mongoConnect = require(`${process.cwd()}/services/mongo-connect`);
}
const { ObjectId } = require("mongodb");

const contactController = {
  // Public: Submit a new contact message
  submitContactMessage: async (req, res) => {
    try {
      const { name, phone, email, message } = req.body;

      // Validation
      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "অনুগ্রহ করে আপনার নাম প্রদান করুন।"
        });
      }

      if ((!phone || !phone.trim()) && (!email || !email.trim())) {
        return res.status(400).json({
          success: false,
          message: "অনুগ্রহ করে আপনার মোবাইল নম্বর অথবা ইমেইল ঠিকানা দিন।"
        });
      }

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          message: "অনুগ্রহ করে আপনার বার্তা লিখুন।"
        });
      }

      const { db } = await mongoConnect();

      const cleanPhone = phone ? phone.trim().replace(/[\s\-()]/g, "") : "";
      const cleanEmail = email ? email.trim().toLowerCase() : "";

      const newMessage = {
        name: name.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        message: message.trim(),
        status: "unread", // "unread", "read", "replied", "resolved"
        adminNotes: "",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection("contact_messages").insertOne(newMessage);

      return res.status(201).json({
        success: true,
        message: "আপনার বার্তা সফলভাবে গৃহীত হয়েছে! আমরা অতি দ্রুত আপনার সাথে যোগাযোগ করব।",
        data: {
          id: result.insertedId,
          ...newMessage
        }
      });
    } catch (error) {
      console.error("Submit Contact Message Error:", error);
      return res.status(500).json({
        success: false,
        message: "বার্তা পাঠাতে সমস্যা হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।"
      });
    }
  },

  // Super Admin: Get all contact messages with search, filter, pagination
  getAllContactMessages: async (req, res) => {
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
          { name: regex },
          { phone: regex },
          { email: regex },
          { message: regex },
          { adminNotes: regex }
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await db.collection("contact_messages").countDocuments(query);
      const items = await db
        .collection("contact_messages")
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      // Stats counts
      const counts = await db.collection("contact_messages").aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      const stats = {
        total: 0,
        unread: 0,
        read: 0,
        replied: 0,
        resolved: 0
      };

      counts.forEach((c) => {
        if (c._id && stats[c._id] !== undefined) {
          stats[c._id] = c.count;
        }
        stats.total += c.count;
      });

      return res.status(200).json({
        success: true,
        data: items,
        stats,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error("Get Contact Messages Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch contact messages"
      });
    }
  },

  // Super Admin: Update status & notes of a contact message
  updateContactMessageStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Message ID" });
      }

      const { db } = await mongoConnect();
      const updateData = {
        updatedAt: new Date()
      };

      if (status) updateData.status = status;
      if (typeof adminNotes === "string") updateData.adminNotes = adminNotes;

      const result = await db.collection("contact_messages").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "Contact message not found" });
      }

      return res.status(200).json({
        success: true,
        message: "স্ট্যাটাস সফলভাবে আপডেট করা হয়েছে",
        data: result
      });
    } catch (error) {
      console.error("Update Contact Message Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update contact message"
      });
    }
  },

  // Super Admin: Delete a contact message
  deleteContactMessage: async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Message ID" });
      }

      const { db } = await mongoConnect();
      const result = await db.collection("contact_messages").deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "Contact message not found" });
      }

      return res.status(200).json({
        success: true,
        message: "বার্তা সফলভাবে মুছে ফেলা হয়েছে"
      });
    } catch (error) {
      console.error("Delete Contact Message Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete contact message"
      });
    }
  }
};

module.exports = contactController;
