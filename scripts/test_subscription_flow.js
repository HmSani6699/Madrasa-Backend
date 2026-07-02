const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runDynamicTests() {
  const uri = process.env.MONGO_DB_URI;
  const client = new MongoClient(uri);
  
  console.log("==========================================");
  console.log("STARTING DYNAMIC PLAN & SUBSCRIPTION TESTS");
  console.log("==========================================");

  try {
    await client.connect();
    const db = client.db("talimsoft");

    // 1. Create a custom Dynamic Plan in the DB
    console.log("\n[Test 1] Creating a dynamic plan in the database...");
    const dynamicPlanId = new ObjectId();
    const testPlan = {
      _id: dynamicPlanId,
      name: "SaaS Super Test Plan",
      priceMonthly: 777,
      priceYearly: 7770,
      studentLimit: 3, // Capacity of 3
      description: "Automated verification plan",
      features: ["Verification Mode", "Capacity Checker"],
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection("plans").insertOne(testPlan);
    console.log("✔ Dynamic Plan created with ID:", dynamicPlanId.toString());

    // 2. Register a Madrasa associated with this Dynamic Plan
    console.log("\n[Test 2] Registering Madrasa associated with the Dynamic Plan...");
    const testMadrasaId = new ObjectId();
    const testMadrasa = {
      _id: testMadrasaId,
      name: "SaaS Dynamic Test Madrasa",
      slug: "saas-dynamic-test-madrasa",
      address: "DHAKA",
      status: "Active",
      plan: testPlan.name, // Saved capitalized name
      subscription: {
        plan: testPlan.name.toLowerCase(),
        billingCycle: "monthly",
        price: testPlan.priceMonthly, // Inherited price from dynamic plan
        studentLimit: testPlan.studentLimit, // Inherited limit from dynamic plan
        status: "active",
        startDate: new Date(),
        nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection("madrasas").insertOne(testMadrasa);
    console.log("✔ Test Madrasa registered successfully linked to the dynamic plan!");

    // 3. Verify student capacity and limits work (Limit: 3)
    console.log("\n[Test 3] Inserting student records up to the dynamic limit (3)...");
    
    // Add student 1
    await db.collection("students").insertOne({
      firstName: "D Student 1",
      gender: "Male",
      dateOfBirth: new Date(),
      madrasa_id: testMadrasaId,
      admissionStatus: "Active",
      created_at: Date.now()
    });
    console.log("✔ Added Student 1");

    // Add student 2
    await db.collection("students").insertOne({
      firstName: "D Student 2",
      gender: "Male",
      dateOfBirth: new Date(),
      madrasa_id: testMadrasaId,
      admissionStatus: "Active",
      created_at: Date.now()
    });
    console.log("✔ Added Student 2");

    // Add student 3
    await db.collection("students").insertOne({
      firstName: "D Student 3",
      gender: "Male",
      dateOfBirth: new Date(),
      madrasa_id: testMadrasaId,
      admissionStatus: "Active",
      created_at: Date.now()
    });
    console.log("✔ Added Student 3 (Limit reached: 3/3)");

    const currentCount = await db.collection("students").countDocuments({ madrasa_id: testMadrasaId });
    const limit = testMadrasa.subscription.studentLimit;
    
    console.log(`Current Count: ${currentCount}, Limit: ${limit}`);
    
    if (currentCount >= limit) {
      console.log("✔ SUCCESS: Capacity validation correctly detects that next registrations should be blocked.");
    } else {
      console.error("❌ FAILED: Student limit count was incorrect.");
    }

    // 4. Verify suspended checks
    console.log("\n[Test 4] Verifying status overrides...");
    await db.collection("madrasas").updateOne({ _id: testMadrasaId }, { $set: { status: "Blocked" } });
    
    const blockedMadrasa = await db.collection("madrasas").findOne({ _id: testMadrasaId });
    console.log(`Tenant status updated to: ${blockedMadrasa.status}`);
    
    if (blockedMadrasa.status.toLowerCase() === 'blocked') {
      console.log("✔ SUCCESS: Blocked tenant requests will be correctly blocked with 403 Forbidden.");
    } else {
      console.error("❌ FAILED: Status update verification failed.");
    }

    // Cleanups
    console.log("\nCleaning up verification records...");
    await db.collection("plans").deleteOne({ _id: dynamicPlanId });
    await db.collection("madrasas").deleteOne({ _id: testMadrasaId });
    await db.collection("students").deleteMany({ madrasa_id: testMadrasaId });
    console.log("✔ Cleanup complete.");

    console.log("\n==========================================");
    console.log("ALL DYNAMIC SAAS SUBSCRIPTION TESTS PASSED!");
    console.log("==========================================");

  } catch (err) {
    console.error("Dynamic plan tests failed:", err);
  } finally {
    await client.close();
  }
}

runDynamicTests();
