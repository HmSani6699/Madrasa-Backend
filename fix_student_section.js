const { MongoClient } = require('mongodb');
const uri = "mongodb://127.0.0.1:27017/talimsoft";

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('talimsoft'); 
    
    await db.collection('students').updateOne(
        { firstName: "Md Emon" },
        { $set: { section_id: "6a45e5b47422efcf2da9bb72" } }
    );
    console.log("Updated Md Emon section_id to A");
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
