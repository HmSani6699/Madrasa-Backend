const root = require('app-root-path');
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require('mongodb');

async function debug() {
    try {
        const { db, client } = await mongoConnect();
        console.log("Connected to DB via internal service");

        const routines = await db.collection('class_routines').find({}).toArray();
        console.log(`Found ${routines.length} routines`);

        if (routines.length > 0) {
            console.log("\nSample Routine (Full):");
            console.log(JSON.stringify(routines[0], null, 2));
            
            const r = routines[0];
            console.log("\nKey Data Types:");
            console.log(`madrasa_id: ${r.madrasa_id} [${r.madrasa_id?.constructor.name}]`);
            console.log(`class_id: ${r.class_id} [${r.class_id?.constructor.name}]`);
            console.log(`section_id: ${r.section_id} [${r.section_id?.constructor.name}]`);
            
            if (r.periods && r.periods[0]) {
                const p = r.periods[0];
                console.log(`teacher_id: ${p.teacher_id} [${p.teacher_id?.constructor.name}]`);
            }
        } else {
            console.log("Collection 'class_routines' is empty or not found.");
        }

    } catch (err) {
        console.error("DIAGNOSTIC ERROR:", err);
    } finally {
        // process.exit(0);
    }
}

debug();
