const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const seedPlans = async (db) => {
  const defaultPlans = [
    {
      name: "Basic",
      priceMonthly: 999,
      priceYearly: 9990,
      studentLimit: 150,
      description: "Suitable for small size madrasas",
      features: ["Admin Dashboard", "Teacher Dashboard", "Parent Dashboard", "Attendance Management", "Fee Management", "Exam Management"],
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      name: "Standard",
      priceMonthly: 1499,
      priceYearly: 14990,
      studentLimit: 350,
      description: "Great for medium size madrasas",
      features: ["Admin/Teacher/Parent Dashboards", "Attendance Management", "Fee Management", "Exam Management", "Syllabus Manager"],
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      name: "Premium",
      priceMonthly: 1999,
      priceYearly: 19990,
      studentLimit: 500,
      description: "Complete package for large scale madrasas",
      features: ["Unlimited Roles", "Custom Domain Portal", "Premium Dashboards", "All Academic & Financial Modules"],
      created_at: new Date(),
      updated_at: new Date()
    }
  ];
  await db.collection("plans").insertMany(defaultPlans);
};

const plansController = {
  getAllPlans: async (req, res) => {
    const { db } = await mongoConnect();
    try {
      const count = await db.collection("plans").countDocuments();
      if (count === 0) {
        await seedPlans(db);
      }
      const plans = await db.collection("plans").find().toArray();
      res.status(200).json({ success: true, data: plans });
    } catch (error) {
      console.error("Get All Plans Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  getPlanById: async (req, res) => {
    const { id } = req.params;
    const { db } = await mongoConnect();
    try {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Plan ID format" });
      }
      const plan = await db.collection("plans").findOne({ _id: new ObjectId(id) });
      if (!plan) {
        return res.status(404).json({ success: false, message: "Plan not found" });
      }
      res.status(200).json({ success: true, data: plan });
    } catch (error) {
      console.error("Get Plan By ID Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  createPlan: async (req, res) => {
    const { name, priceMonthly, priceYearly, studentLimit, description, features } = req.body;
    
    if (!name || priceMonthly === undefined || priceYearly === undefined || studentLimit === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: "Name, priceMonthly, priceYearly, and studentLimit are required." 
      });
    }

    const { db } = await mongoConnect();
    try {
      const newPlan = {
        name,
        priceMonthly: Number(priceMonthly),
        priceYearly: Number(priceYearly),
        studentLimit: Number(studentLimit),
        description: description || "",
        features: Array.isArray(features) ? features : [],
        created_at: new Date(),
        updated_at: new Date()
      };

      const result = await db.collection("plans").insertOne(newPlan);
      res.status(201).json({ 
        success: true, 
        message: "Plan created successfully", 
        data: { ...newPlan, _id: result.insertedId } 
      });
    } catch (error) {
      console.error("Create Plan Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  updatePlan: async (req, res) => {
    const { id } = req.params;
    const { name, priceMonthly, priceYearly, studentLimit, description, features } = req.body;
    const { db } = await mongoConnect();
    try {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Plan ID format" });
      }
      
      const updateData = {
        updated_at: new Date()
      };

      if (name) updateData.name = name;
      if (priceMonthly !== undefined) updateData.priceMonthly = Number(priceMonthly);
      if (priceYearly !== undefined) updateData.priceYearly = Number(priceYearly);
      if (studentLimit !== undefined) updateData.studentLimit = Number(studentLimit);
      if (description !== undefined) updateData.description = description;
      if (features !== undefined) updateData.features = Array.isArray(features) ? features : [];

      const result = await db.collection("plans").findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after", returnOriginal: false }
      );

      const updatedDoc = result.value || result;
      if (!updatedDoc) {
        return res.status(404).json({ success: false, message: "Plan not found" });
      }

      res.status(200).json({ success: true, message: "Plan updated successfully", data: updatedDoc });
    } catch (error) {
      console.error("Update Plan Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  deletePlan: async (req, res) => {
    const { id } = req.params;
    const { db } = await mongoConnect();
    try {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Plan ID format" });
      }
      const result = await db.collection("plans").deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, message: "Plan not found" });
      }
      res.status(200).json({ success: true, message: "Plan deleted successfully" });
    } catch (error) {
      console.error("Delete Plan Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

module.exports = plansController;
