const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

async function createSuperAdmin() {
  const uri = process.env.MONGO_DB_URI;
  const dbName = process.env.MONGO_DB || 'madrasasheba';
  const client = new MongoClient(uri);

  const email = "admin2@gmail.com";
  const password = "admin2@gmail.com";

  try {
    await client.connect();
    const db = client.db(dbName);

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Upsert or replace existing if any
    const existing = await db.collection("users").findOne({
      $or: [{ email: email }, { username: email }, { role: "super_admin" }]
    });

    if (existing) {
      await db.collection("users").updateOne(
        { _id: existing._id },
        {
          $set: {
            username: email,
            email: email,
            password: hashedPassword,
            role: "super_admin",
            madrasa_id: null,
            updated_at: new Date()
          }
        }
      );
      console.log(`Updated existing super_admin (${existing._id}) in database "${dbName}".`);
    } else {
      const res = await db.collection("users").insertOne({
        username: email,
        email: email,
        password: hashedPassword,
        role: "super_admin",
        madrasa_id: null,
        created_at: new Date()
      });
      console.log(`Created new super_admin with id ${res.insertedId} in database "${dbName}".`);
    }

    console.log("--------------------------------------");
    console.log("Super Admin Credentials:");
    console.log(`Database: ${dbName}`);
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log("--------------------------------------");
  } catch (err) {
    console.error("Failed to create super admin:", err);
  } finally {
    await client.close();
  }
}

createSuperAdmin();
