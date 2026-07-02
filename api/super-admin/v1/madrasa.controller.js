const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const authService = require(`${root}/services/auth.service`);
const { ObjectId } = require("mongodb");

const getSubscriptionDefaults = (plan, billingCycle) => {
  const normPlan = (plan || "basic").toLowerCase();
  const normCycle = (billingCycle || "monthly").toLowerCase();

  let studentLimit = 150;
  if (normPlan === "standard") studentLimit = 350;
  else if (normPlan === "premium") studentLimit = 500;

  let price = 999;
  if (normPlan === "basic") price = normCycle === "monthly" ? 999 : 9990;
  else if (normPlan === "standard") price = normCycle === "monthly" ? 1499 : 14990;
  else if (normPlan === "premium") price = normCycle === "monthly" ? 1999 : 19990;

  return { studentLimit, price };
};

const madrasaController = {
  createMadrasa: async (req, res) => {
    const { 
      madrasaName, 
      address, 
      adminName, 
      adminEmail, 
      adminPassword, 
      plan, 
      billingCycle, 
      price, 
      nextBillingDate,
      statusMessage
    } = req.body;

    // Validation
    if (!madrasaName || !adminEmail || !adminPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "Madrasa Name, Admin Email, and Admin Password are required." 
      });
    }

    const { db, client, isReplicaSet } = await mongoConnect();
    const session = isReplicaSet ? client.startSession() : null;

    try {
      if (session) session.startTransaction();

      // 1. Check if Admin Email already exists
      const queryOptions = session ? { session } : {};
      const existingUser = await db.collection("users").findOne({ email: adminEmail }, queryOptions);
      if (existingUser) {
        if (session) await session.abortTransaction();
        return res.status(400).json({ success: false, message: "User with this email already exists." });
      }

      // 2. Prepare Subscription Defaults
      const selectedPlan = plan || "basic";
      const selectedCycle = billingCycle || "monthly";
      const defaults = getSubscriptionDefaults(selectedPlan, selectedCycle);
      const finalPrice = price !== undefined && price !== null ? Number(price) : defaults.price;
      const finalStudentLimit = req.body.studentLimit !== undefined && req.body.studentLimit !== null ? Number(req.body.studentLimit) : defaults.studentLimit;

      let finalBillingDate;
      if (nextBillingDate) {
        finalBillingDate = new Date(nextBillingDate);
      } else {
        const days = selectedCycle.toLowerCase() === "yearly" ? 365 : 30;
        finalBillingDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      // 3. Create Madrasa Payload
      const slug = madrasaName.toLowerCase().trim().replace(/ /g, "-").replace(/[^\w-]+/g, "");
      const madrasaPayload = {
        name: madrasaName,
        slug: slug,
        address: address || "",
        contact_email: adminEmail,
        status: "Active", // Active, Suspended, Blocked
        statusMessage: statusMessage || "",
        plan: selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1).toLowerCase(), // E.g., Basic, Standard, Premium (backward compatibility)
        subscription: {
          plan: selectedPlan.toLowerCase(),
          billingCycle: selectedCycle.toLowerCase(),
          price: finalPrice,
          studentLimit: finalStudentLimit,
          status: "active",
          startDate: new Date(),
          nextBillingDate: finalBillingDate
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      const madrasaResult = await db.collection("madrasas").insertOne(madrasaPayload, queryOptions);
      const madrasaId = madrasaResult.insertedId;

      // 4. Create Admin User
      const hashedPassword = await authService.hashPassword(adminPassword);
      const userPayload = {
        username: adminName,
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        madrasa_id: madrasaId,
        created_at: new Date(),
        updated_at: new Date()
      };

      const userResult = await db.collection("users").insertOne(userPayload, queryOptions);

      if (session) await session.commitTransaction();

      res.status(201).json({
        success: true,
        message: "Madrasa and Admin created successfully.",
        data: {
          madrasaId: madrasaId,
          adminId: userResult.insertedId,
          madrasaName: madrasaName
        }
      });

    } catch (error) {
      console.error("Create Madrasa Error:", error);
      if (session) await session.abortTransaction();
      res.status(500).json({ success: false, message: "Internal server error." });
    } finally {
      if (session) session.endSession();
    }
  },

  getAllMadrasas: async (req, res) => {
    const { db } = await mongoConnect();
    try {
      const madrasas = await db.collection("madrasas").find().toArray();
      
      // Enhance madrasas with dynamic statistics (student count and admin user details)
      const enhancedMadrasas = await Promise.all(madrasas.map(async (m) => {
        const studentCount = await db.collection("students").countDocuments({ madrasa_id: m._id });
        const adminUser = await db.collection("users").findOne({ madrasa_id: m._id, role: "admin" });
        
        // Ensure plan is nicely capitalized for frontend
        let planLabel = m.plan;
        if (m.subscription && m.subscription.plan) {
          planLabel = m.subscription.plan.charAt(0).toUpperCase() + m.subscription.plan.slice(1).toLowerCase();
        }
        if (!planLabel) planLabel = "Basic";

        return {
          ...m,
          students: studentCount,
          location: m.address || "N/A",
          admin: adminUser ? adminUser.username : "N/A",
          email: adminUser ? adminUser.email : m.contact_email || "N/A",
          phone: adminUser ? adminUser.phone || "N/A" : "N/A",
          plan: planLabel
        };
      }));

      res.status(200).json({ success: true, data: enhancedMadrasas });
    } catch (error) {
      console.error("Get All Madrasas Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  updateMadrasa: async (req, res) => {
    const { id } = req.params;
    const { name, address, status, statusMessage, plan, billingCycle, price, nextBillingDate, studentLimit } = req.body;
    const { db } = await mongoConnect();
    try {
      const madrasaId = new ObjectId(id);
      const existingMadrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      
      if (!existingMadrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const updateData = {
        updated_at: new Date()
      };

      if (name) updateData.name = name;
      if (address) updateData.address = address;
      if (statusMessage !== undefined) updateData.statusMessage = statusMessage;
      
      if (status) {
        // Normalize status: "Active" / "Suspended" / "Blocked"
        const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        updateData.status = formattedStatus;
        updateData["subscription.status"] = status.toLowerCase();
      }

      // If subscription fields are provided, recalculate capacity limits and standard pricing
      if (plan || billingCycle || price !== undefined || nextBillingDate || studentLimit !== undefined) {
        const currentSub = existingMadrasa.subscription || {};
        const newPlan = plan || currentSub.plan || "basic";
        const newBillingCycle = billingCycle || currentSub.billingCycle || "monthly";

        const defaults = getSubscriptionDefaults(newPlan, newBillingCycle);
        const finalPrice = price !== undefined && price !== null ? Number(price) : defaults.price;
        const finalLimit = studentLimit !== undefined && studentLimit !== null ? Number(studentLimit) : defaults.studentLimit;

        updateData.plan = newPlan.charAt(0).toUpperCase() + newPlan.slice(1).toLowerCase();
        updateData["subscription.plan"] = newPlan.toLowerCase();
        updateData["subscription.billingCycle"] = newBillingCycle.toLowerCase();
        updateData["subscription.price"] = finalPrice;
        updateData["subscription.studentLimit"] = finalLimit;

        if (nextBillingDate) {
          updateData["subscription.nextBillingDate"] = new Date(nextBillingDate);
        }
      }

      const result = await db.collection("madrasas").findOneAndUpdate(
        { _id: madrasaId },
        { $set: updateData },
        { returnDocument: "after", returnOriginal: false }
      );

      const updatedDoc = result.value || result;

      res.status(200).json({ success: true, message: "Madrasa updated successfully", data: updatedDoc });
    } catch (error) {
      console.error("Update Madrasa Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  deleteMadrasa: async (req, res) => {
    const { id } = req.params;
    const { db, client, isReplicaSet } = await mongoConnect();
    const session = isReplicaSet ? client.startSession() : null;
    try {
      if (session) session.startTransaction();
      const queryOptions = session ? { session } : {};
      
      const madrasaId = new ObjectId(id);

      // 1. Delete the Madrasa
      const madrasaResult = await db.collection("madrasas").deleteOne({ _id: madrasaId }, queryOptions);
      if (madrasaResult.deletedCount === 0) {
        if (session) await session.abortTransaction();
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      // 2. Delete all Users associated with this Madrasa
      await db.collection("users").deleteMany({ madrasa_id: madrasaId }, queryOptions);

      if (session) await session.commitTransaction();
      res.status(200).json({ success: true, message: "Madrasa and associated users deleted successfully" });
    } catch (error) {
      console.error("Delete Madrasa Error:", error);
      if (session) await session.abortTransaction();
      res.status(500).json({ success: false, message: "Internal server error" });
    } finally {
      if (session) session.endSession();
    }
  }
};

module.exports = madrasaController;
