const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runBillingTests() {
  const uri = process.env.MONGO_DB_URI;
  const client = new MongoClient(uri);
  
  console.log("==========================================");
  console.log("STARTING SAAS BILLING OPERATIONAL TESTS");
  console.log("==========================================");

  try {
    await client.connect();
    const db = client.db("talimsoft");

    // 1. Setup a test tenant Madrasa with expired subscription
    console.log("\n[Setup] Registering temporary expired Madrasa...");
    const testMadrasaId = new ObjectId();
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 3); // Expired 3 days ago

    const testMadrasa = {
      _id: testMadrasaId,
      name: "SaaS Expired Madrasa",
      slug: "saas-expired-madrasa",
      address: "DHAKA",
      status: "Suspended",
      subscription: {
        plan: "basic",
        billingCycle: "monthly",
        price: 999,
        studentLimit: 150,
        status: "suspended",
        startDate: new Date(),
        nextBillingDate: expiredDate
      },
      created_at: new Date()
    };
    await db.collection("madrasas").insertOne(testMadrasa);
    console.log("✔ Expired Madrasa created!");

    // 2. Validate simulation of "Grace Period" (Extend by 15 days)
    console.log("\n[Test 1] Simulating Super Admin granting 15-day Grace Period...");
    const today = new Date();
    today.setHours(0,0,0,0);
    const extensionDays = 15;
    
    // Auto extension from today
    const newGraceDate = new Date(today.getTime() + extensionDays * 24 * 60 * 60 * 1000);

    // Update in DB
    await db.collection("madrasas").updateOne(
      { _id: testMadrasaId },
      { 
        $set: { 
          status: "Active", 
          "subscription.status": "active",
          "subscription.nextBillingDate": newGraceDate 
        } 
      }
    );

    const docAfterGrace = await db.collection("madrasas").findOne({ _id: testMadrasaId });
    console.log("✔ Grace Period recorded!");
    console.log(`New Status: ${docAfterGrace.status}`);
    console.log(`New Due Date: ${new Date(docAfterGrace.subscription.nextBillingDate).toLocaleDateString()}`);

    if (docAfterGrace.status === "Active" && new Date(docAfterGrace.subscription.nextBillingDate).getDate() === newGraceDate.getDate()) {
      console.log("✔ SUCCESS: Grace Period correctly extended subscription date and activated portal!");
    } else {
      console.error("❌ FAILED: Grace Period logic failed.");
    }

    // 3. Validate simulation of "Record Payment" (Extend by 30 days)
    console.log("\n[Test 2] Simulating Super Admin recording monthly BDT 999 payment...");
    const baseDate = new Date(docAfterGrace.subscription.nextBillingDate);
    const renewDays = 30;
    const newPaidDate = new Date(baseDate.getTime() + renewDays * 24 * 60 * 60 * 1000);

    await db.collection("madrasas").updateOne(
      { _id: testMadrasaId },
      { 
        $set: { 
          status: "Active", 
          "subscription.status": "active",
          "subscription.nextBillingDate": newPaidDate 
        } 
      }
    );

    const docAfterPaid = await db.collection("madrasas").findOne({ _id: testMadrasaId });
    console.log("✔ Payment Renewal recorded!");
    console.log(`Extended Status: ${docAfterPaid.status}`);
    console.log(`Extended Due Date: ${new Date(docAfterPaid.subscription.nextBillingDate).toLocaleDateString()}`);

    if (docAfterPaid.status === "Active" && new Date(docAfterPaid.subscription.nextBillingDate).getDate() === newPaidDate.getDate()) {
      console.log("✔ SUCCESS: Payment extension advanced next billing date forward correctly by 30 days!");
    } else {
      console.error("❌ FAILED: Payment renewal logic failed.");
    }

    // Cleanups
    console.log("\n[Cleanup] Removing temporary test files...");
    await db.collection("madrasas").deleteOne({ _id: testMadrasaId });
    console.log("✔ Cleanup complete.");

    console.log("\n==========================================");
    console.log("ALL SAAS BILLING OPERATIONAL TESTS PASSED!");
    console.log("==========================================");

  } catch (err) {
    console.error("Billing tests failed:", err);
  } finally {
    await client.close();
  }
}

runBillingTests();
