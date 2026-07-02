const { MongoClient } = require('mongodb');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function listAdminAndSuperAdmin() {
  const uri = process.env.MONGO_DB_URI;
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db("talimsoft");
    const users = await db.collection("users").find({ role: { $in: ["super_admin", "admin"] } }).toArray();
    
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Listing failed:", err);
  } finally {
    await client.close();
  }
}

listAdminAndSuperAdmin();
