const { MongoClient } = require('mongodb'); 
async function check() { 
  const client = new MongoClient('mongodb://localhost:27017'); 
  await client.connect(); 
  const db = client.db('talimsoft'); 
  const res = await db.collection('students').find({}, { projection: { firstName: 1, academicYear: 1 } }).sort({created_at: -1}).limit(10).toArray(); 
  console.log(JSON.stringify(res, null, 2)); 
  await client.close(); 
} 
check().catch(console.error);
