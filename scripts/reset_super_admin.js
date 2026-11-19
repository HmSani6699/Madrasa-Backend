const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const root = process.cwd();
const getMongoConnection = require(`${root}/services/mongo-connect`);

async function resetSuperAdmin() {
  try {
    console.log("CWD:", process.cwd());
    console.log("MONGO_DB_URI_ENV:", process.env.MONGO_DB_URI ? "Present" : "Missing");

    const { client, db } = await getMongoConnection();
    console.log("Connected to MongoDB.");

    const result = await db.collection("users").deleteMany({ role: "super_admin" });
    console.log(`Deleted ${result.deletedCount} Super Admin user(s).`);

    await client.close();
    console.log("Connection closed.");
  } catch (error) {
    console.error("Reset Error:", error);
    process.exit(1);
  }
}

resetSuperAdmin();
