const { MongoClient } = require('mongodb'); 
async function fix() { 
  const client = new MongoClient('mongodb://localhost:27017'); 
  await client.connect(); 
  const db = client.db('talimsoft'); 
  const res = await db.collection('students').updateMany({ academicYear: '2026' }, { $set: { academicYear: '2025-2026' } }); 
  console.log(res); 
  await client.close(); 
} 
fix().catch(console.error);
