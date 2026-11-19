// const { MongoClient, ServerApiVersion } = require("mongodb");
// const axios = require("axios");

// const mongoDbUri = process.env.MONGO_DB_URI;
// const mongoOptions = {
//     serverApi: {
//         version: ServerApiVersion.v1,
//         strict: true,
//         deprecationErrors: true,
//     }
// };

// const getMongoConnection = async () => {
//     try {
//         const mongoDbUri = process.env.MONGO_DB_URI;
//         if (!mongoDbUri) {
//             throw new Error("MONGO_DB_URI is not defined in environment variables");
//         }
//         const dbName = process.env.MONGO_DB ;
//         const client = new MongoClient(mongoDbUri, mongoOptions);
//         await client.connect();
//         const db = client.db(dbName);

//         // Check if it's a replica set (required for transactions)
//         let isReplicaSet = false;
//         try {
//             const status = await db.admin().serverStatus();
//             isReplicaSet = !!status.repl;
//         } catch (e) {
//             console.log("Could not detect replica set status, assuming standalone.");
//         }

//         return ({ client, db, isReplicaSet })
//     } catch (error) {
//         console.error("MongoDB Connection Error:", error);
//         throw error;
//     }
// }
// module.exports = getMongoConnection;




const { MongoClient, ServerApiVersion } = require("mongodb");

/* =========================
   MONGODB CONFIGURATION
========================= */

const mongoOptions = {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
};

/* =========================
   CONNECTION CACHE
========================= */

const cached =
    global.__mongoConnectionCache ||
    (global.__mongoConnectionCache = {
        client: null,
        promise: null
    });

/* =========================
   MONGODB CONNECTION
========================= */

const getMongoConnection = async () => {

    const mongoDbUri = process.env.MONGO_DB_URI;

    if (!mongoDbUri) {
        throw new Error(
            "MONGO_DB_URI is not defined in environment variables"
        );
    }

    if (!cached.promise) {

        const client = new MongoClient(
            mongoDbUri,
            mongoOptions
        );

        cached.client = client;

        cached.promise = client.connect()
            .then(async () => {

                const dbName = process.env.MONGO_DB;
                const db = client.db(dbName);

                let isReplicaSet = false;

                // Detect replica set
                try {
                    const status = await db.admin().serverStatus();

                    isReplicaSet = !!status.repl;

                } catch (error) {
                    console.log(
                        "Could not detect replica set status."
                    );
                }

                console.log("MongoDB connected successfully");

                return {
                    client,
                    db,
                    isReplicaSet
                };

            })
            .catch(async (error) => {

                cached.promise = null;
                cached.client = null;

                try {
                    await client.close();
                } catch (closeError) {
                    console.error(
                        "MongoDB close error:",
                        closeError.message
                    );
                }

                console.error(
                    "MongoDB Connection Error:",
                    error
                );

                throw error;
            });
    }

    return cached.promise;
};

module.exports = getMongoConnection;
