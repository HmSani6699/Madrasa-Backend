const { MongoClient } = require('mongodb');
const root = require('app-root-path');
require('dotenv').config({ path: 'd:/MMS/backend/.env' });

async function debug() {
    const uri = process.env.MONGO_DB_URI;
    const dbName = process.env.MONGO_DB;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(dbName);
        console.log("Connected to DB:", dbName);

        const routines = await db.collection('class_routines').find({}).limit(1).toArray();
        console.log("Sample Routine:", JSON.stringify(routines[0], null, 2));

        if (routines[0]) {
            console.log("\nID Types:");
            console.log("class_id type:", typeof routines[0].class_id, routines[0].class_id.constructor.name);
            console.log("section_id type:", typeof routines[0].section_id, routines[0].section_id.constructor.name);
            console.log("madrasa_id type:", typeof routines[0].madrasa_id, routines[0].madrasa_id.constructor.name);
            if (routines[0].periods && routines[0].periods[0]) {
                console.log("teacher_id type:", typeof routines[0].periods[0].teacher_id, routines[0].periods[0].teacher_id.constructor.name);
            }
        }

        const staff = await db.collection('staff').find({}).limit(1).toArray();
        console.log("\nSample Staff:", JSON.stringify(staff[0], null, 2));
        if (staff[0]) {
            console.log("_id type:", typeof staff[0]._id, staff[0]._id.constructor.name);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

debug();
