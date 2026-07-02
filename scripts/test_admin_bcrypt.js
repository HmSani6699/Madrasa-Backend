const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function testAdminBcrypt() {
  const uri = process.env.MONGO_DB_URI;
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db("talimsoft");
    const user = await db.collection("users").findOne({ role: "admin" });
    
    if (!user) {
      console.log("Admin user not found");
      return;
    }

    console.log("Admin user:", user.email);

    const testPasswords = ["admin123", "Admin123!", "adminPassword123", "password123", "Password123!"];
    
    for (const pw of testPasswords) {
      const match = await bcrypt.compare(pw, user.password);
      console.log(`Password: "${pw}" -> Match: ${match}`);
    }

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await client.close();
  }
}

testAdminBcrypt();
