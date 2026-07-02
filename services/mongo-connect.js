const { MongoClient, ServerApiVersion } = require("mongodb");
const axios = require("axios");

const mongoDbUri = process.env.MONGO_DB_URI;
const mongoOptions = {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
};

const getMongoConnection = async () => {
    try {
        const mongoDbUri = process.env.MONGO_DB_URI;
        if (!mongoDbUri) {
            throw new Error("MONGO_DB_URI is not defined in environment variables");
        }
        const dbName = process.env.MONGO_DB ;
        const client = new MongoClient(mongoDbUri, mongoOptions);
        await client.connect();
        const db = client.db(dbName);
        
        // Check if it's a replica set (required for transactions)
        let isReplicaSet = false;
        try {
            const status = await db.admin().serverStatus();
            isReplicaSet = !!status.repl;
        } catch (e) {
            console.log("Could not detect replica set status, assuming standalone.");
        }

        return ({ client, db, isReplicaSet })
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
        throw error;
    }
}
module.exports = getMongoConnection;