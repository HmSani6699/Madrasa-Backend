const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const root = process.cwd();
const getMongoConnection = require(`${root}/services/mongo-connect`);
const authService = require(`${root}/services/auth.service`);

async function updateSuperAdmin() {
  let client, db;
  try {
    console.log("Connecting to MongoDB...");
    const mongoDbUri = require(`${root}/services/mongo-uri`).generateMongoDbUri();
    console.log("URI being used:", mongoDbUri.replace(/:([^:@]+)@/, ":****@")); // Mask password
    const connection = await getMongoConnection();
    client = connection.client;
    db = connection.db;

    // 1. Delete existing super admin(s)
    console.log("Deleting existing Super Admin users...");
    const deleteResult = await db.collection("users").deleteMany({ role: "super_admin" });
    console.log(`Deleted ${deleteResult.deletedCount} Super Admin user(s).`);

    // 2. Prepare new super admin credentials
    const email = "superadmin@mms.com";
    const password = "SuperAdmin123!";

    console.log(`Hashing password for ${email}...`);
    const hashedPassword = await authService.hashPassword(password);

    // 3. Insert new super admin
    const newUser = {
      username: email,
      email: email,
      password: hashedPassword,
      role: "super_admin",
      madrasa_id: null,
      created_at: new Date()
    };

    console.log("Creating new Super Admin...");
    const insertResult = await db.collection("users").insertOne(newUser);

    if (insertResult.insertedCount === 1 || insertResult.acknowledged) {
      console.log("New Super Admin created successfully!");
      console.log("-----------------------------------------");
      console.log(`Email:    ${email}`);
      console.log(`Password: ${password}`);
      console.log("-----------------------------------------");
    } else {
      console.error("Failed to insert new Super Admin.");
    }

  } catch (error) {
    console.error("Update Error:", error);
  } finally {
    if (client) {
      await client.close();
      console.log("Connection closed.");
    }
  }
}

updateSuperAdmin();
