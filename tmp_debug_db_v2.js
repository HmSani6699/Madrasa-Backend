const { MongoClient, ObjectId } = require('mongodb');
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

        // 1. Check all routines
        const allRoutines = await db.collection('class_routines').find({}).toArray();
        console.log(`Total routines found: ${allRoutines.length}`);

        if (allRoutines.length > 0) {
            console.log("\nSample Routine (Full):", JSON.stringify(allRoutines[0], null, 2));
            
            // Check IDs
            const r = allRoutines[0];
            console.log("\nID Analysis:");
            console.log(`madrasa_id: ${r.madrasa_id} (${r.madrasa_id?.constructor.name})`);
            console.log(`class_id: ${r.class_id} (${r.class_id?.constructor.name})`);
            console.log(`section_id: ${r.section_id} (${r.section_id?.constructor.name})`);
            if (r.periods && r.periods[0]) {
                console.log(`teacher_id: ${r.periods[0].teacher_id} (${r.periods[0].teacher_id?.constructor.name})`);
            }
        }

        // 2. Mock the query from TeacherSchedule.jsx
        // Let's find a valid teacher_id from the routines
        let targetTeacherId = null;
        for (const r of allRoutines) {
            if (r.periods && r.periods.length > 0) {
                targetTeacherId = r.periods[0].teacher_id;
                break;
            }
        }

        if (targetTeacherId) {
            console.log(`\nMocking query for teacher_id: ${targetTeacherId}`);
            const teacherIdStr = targetTeacherId.toString();
            
            // This replicates the backend's $or filter logic
            const query = { 
                $or: [
                    { "periods.teacher_id": teacherIdStr },
                    { "periods.teacher_id": new ObjectId(teacherIdStr) }
                ]
            };
            
            const results = await db.collection('class_routines').find(query).toArray();
            console.log(`Find with teacher_id query returned: ${results.length} docs`);
            
            if (results.length === 0) {
                console.log("WARNING: Query failed to find documents. Checking nested paths...");
                // Maybe it's stored differently?
                const sampleDoc = allRoutines[0];
                console.log("Nested structure check:", sampleDoc.periods[0]);
            }
        } else {
            console.log("No teacher_id found in any routine periods.");
        }

    } catch (e) {
        console.error("Debug Error:", e);
    } finally {
        await client.close();
    }
}

debug();
