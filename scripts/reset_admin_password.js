const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function resetAdminPassword() {
  const uri = process.env.MONGO_DB_URI;
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db("talimsoft");
    
    // Hash new password
    const newPassword = "AdminPassword123!";
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await db.collection("users").updateOne(
      { role: "admin" },
      { $set: { password: hashedPassword } }
    );
    
    if (result.modifiedCount > 0) {
      console.log("Successfully updated admin password to: " + newPassword);
    } else {
      console.log("Failed to update admin password or admin user not found");
    }
  } catch (err) {
    console.error("Reset failed:", err);
  } finally {
    await client.close();
  }
}

resetAdminPassword();
