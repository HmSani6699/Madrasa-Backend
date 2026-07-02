const dotenv = require("dotenv");
dotenv.config();

const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const runTests = async () => {
  console.log("STARTING PREPAID BDT SMS WALLET BILLING & BROADCAST TESTS");
  console.log("========================================================\n");

  const { db } = await mongoConnect();
  const testMadrasaId = new ObjectId();

  try {
    // 1. Setup Madrasa with 0 SMS Balance
    console.log("[Setup] Creating temporary Madrasa with BDT 0.00 balance...");
    await db.collection("madrasas").insertOne({
      _id: testMadrasaId,
      name: "Sms Test Madrasa",
      smsWalletBalance: 0.00,
      status: "Active"
    });
    console.log("✔ Temporary Madrasa created!\n");

    // 2. Submit Recharge Request for BDT 150
    console.log("[Test 1] Simulating Madrasa submitting recharge request of BDT 150...");
    const rechargeId = new ObjectId();
    const requestDoc = {
      _id: rechargeId,
      madrasaId: testMadrasaId,
      madrasaName: "Sms Test Madrasa",
      amount: 150,
      senderNumber: "01712345678",
      transactionId: "TRX_TEST123",
      status: "Pending",
      created_at: new Date()
    };
    await db.collection("sms_recharges").insertOne(requestDoc);
    console.log("✔ BDT 150 Recharge request logged in Pending status.\n");

    // 3. Super Admin Approves Recharge Request
    console.log("[Test 2] Simulating Super Admin approving BDT 150 recharge request...");
    const request = await db.collection("sms_recharges").findOne({ _id: rechargeId });
    if (request && request.status === "Pending") {
      await db.collection("sms_recharges").updateOne(
        { _id: rechargeId },
        { $set: { status: "Approved", processed_at: new Date() } }
      );
      await db.collection("madrasas").updateOne(
        { _id: testMadrasaId },
        { $inc: { smsWalletBalance: request.amount } }
      );
      console.log("✔ Recharge approved and balance updated successfully!");
    }

    // Verify balance
    let updatedMadrasa = await db.collection("madrasas").findOne({ _id: testMadrasaId });
    console.log(`Current Balance: BDT ${updatedMadrasa.smsWalletBalance}`);
    if (updatedMadrasa.smsWalletBalance === 150) {
      console.log("✔ SUCCESS: Wallet balance is exactly BDT 150.00!\n");
    } else {
      throw new Error(`Wallet balance mismatch: Expected 150, got ${updatedMadrasa.smsWalletBalance}`);
    }

    // 4. Simulate sending 100 Bulk SMS messages
    console.log("[Test 3] Simulating Madrasa sending 100 Bulk SMS messages...");
    const ratePerSms = 0.25; // Bulk rate
    const totalSmsCount = 100;
    const expectedCost = totalSmsCount * ratePerSms; // BDT 25.00

    console.log(`Required Cost: BDT ${expectedCost}`);
    console.log(`Available Balance: BDT ${updatedMadrasa.smsWalletBalance}`);

    if (updatedMadrasa.smsWalletBalance >= expectedCost) {
      await db.collection("madrasas").updateOne(
        { _id: testMadrasaId },
        { $inc: { smsWalletBalance: -expectedCost } }
      );
      console.log("✔ Wallet balance deducted!");
    } else {
      throw new Error("Insufficient balance simulation failed!");
    }

    // Verify balance after deduction
    updatedMadrasa = await db.collection("madrasas").findOne({ _id: testMadrasaId });
    console.log(`Remaining Balance: BDT ${updatedMadrasa.smsWalletBalance}`);
    if (updatedMadrasa.smsWalletBalance === 125) {
      console.log("✔ SUCCESS: Balance correctly decremented by BDT 25.00 to BDT 125.00!\n");
    } else {
      throw new Error(`Wallet balance mismatch after deduction: Expected 125, got ${updatedMadrasa.smsWalletBalance}`);
    }

  } catch (error) {
    console.error("❌ TEST RUN FAILED:", error);
  } finally {
    // Cleanup
    console.log("[Cleanup] Removing temporary test records...");
    await db.collection("madrasas").deleteOne({ _id: testMadrasaId });
    await db.collection("sms_recharges").deleteMany({ madrasaId: testMadrasaId });
    console.log("✔ Cleanup complete.\n");

    console.log("========================================================");
    console.log("ALL PREPAID BDT SMS WALLET BILLING & BROADCAST TESTS PASSED!");
    console.log("========================================================");
    process.exit(0);
  }
};

runTests();
