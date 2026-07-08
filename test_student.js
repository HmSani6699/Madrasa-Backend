const { MongoClient } = require('mongodb');
const uri = "mongodb://127.0.0.1:27017/talimsoft";

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('talimsoft'); 
    
    const student = await db.collection('students').findOne({ firstName: "Md Emon" });
    console.log("Class ID:", student.class_id);
    console.log("Section ID:", student.section_id);
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
