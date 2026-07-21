const { MongoClient } = require("mongodb");

async function run() {
  const uri = "mongodb://localhost:27017"; // Assuming local MongoDB or it might be in .env. Let's check .env
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("school_management"); // Wait, what is the DB name? Let's use the mongo-connect service.
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

// Let's actually use the existing mongo-connect service from backend.
const mongoConnect = require("./services/mongo-connect");
const mongo = require("./services/mongo-crud");

async function test() {
  const { db, client } = await mongoConnect();
  const reports = await mongo.fetchMany(db, "academic_reports", {}, {}, {}, 1, 0);
  console.log(JSON.stringify(reports, null, 2));
  process.exit(0);
}
test();
