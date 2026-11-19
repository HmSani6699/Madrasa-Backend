const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const seedRates = async (db) => {
  const defaultRates = {
    singleSmsRate: 0.30,
    bulkSmsRate: 0.25,
    maskingSmsRate: 0.40,
    updated_at: new Date()
  };
  await db.collection("sms_rates").insertOne(defaultRates);
  return defaultRates;
};

const smsController = {
  // 1. Get SMS Rates (With Auto Seeding)
  getSmsRates: async (req, res) => {
    const { db } = await mongoConnect();
    try {
      let rates = await db.collection("sms_rates").findOne();
      if (!rates) {
        rates = await seedRates(db);
      }
      res.status(200).json({ success: true, data: rates });
    } catch (error) {
      console.error("Get SMS Rates Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  // 2. Update SMS Rates
  updateSmsRates: async (req, res) => {
    const { singleSmsRate, bulkSmsRate, maskingSmsRate } = req.body;
    const { db } = await mongoConnect();
    try {
      const updateData = {
        singleSmsRate: Number(singleSmsRate || 0.30),
        bulkSmsRate: Number(bulkSmsRate || 0.25),
        maskingSmsRate: Number(maskingSmsRate || 0.40),
        updated_at: new Date()
      };

      let rates = await db.collection("sms_rates").findOne();
      if (!rates) {
        await db.collection("sms_rates").insertOne(updateData);
      } else {
        await db.collection("sms_rates").updateOne(
          { _id: rates._id },
          { $set: updateData }
        );
      }

      res.status(200).json({ success: true, message: "SMS Rates updated successfully", data: updateData });
    } catch (error) {
      console.error("Update SMS Rates Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  // 3. Get All Recharge Requests
  getAllRecharges: async (req, res) => {
    const { db } = await mongoConnect();
    try {
      const recharges = await db.collection("sms_recharges")
        .find()
        .sort({ created_at: -1 })
        .toArray();
      res.status(200).json({ success: true, data: recharges });
    } catch (error) {
      console.error("Get All Recharges Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  // 4. Process (Approve / Reject) Recharge Request
  processRecharge: async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'Approved' or 'Rejected'
    const { db } = await mongoConnect();

    try {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid Request ID format" });
      }

      if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status option" });
      }

      const rechargeRequest = await db.collection("sms_recharges").findOne({ _id: new ObjectId(id) });
      if (!rechargeRequest) {
        return res.status(404).json({ success: false, message: "Recharge request not found" });
      }

      if (rechargeRequest.status !== 'Pending') {
        return res.status(400).json({ success: false, message: "This request has already been processed" });
      }

      // Update recharge request status
      await db.collection("sms_recharges").updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            status, 
            processed_at: new Date() 
          } 
        }
      );

      // If approved, increment Madrasa's smsWalletBalance
      if (status === 'Approved') {
        const amount = Number(rechargeRequest.amount);
        const madrasaId = rechargeRequest.madrasaId;

        await db.collection("madrasas").updateOne(
          { _id: new ObjectId(madrasaId) },
          { 
            $inc: { 
              "smsWalletBalance": amount 
            } 
          }
        );
      }

      res.status(200).json({ 
        success: true, 
        message: `Recharge request successfully ${status.toLowerCase()}!` 
      });
    } catch (error) {
      console.error("Process Recharge Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

module.exports = smsController;
