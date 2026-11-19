const router = require("express").Router();
const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);

apiStatus = (req, res, next) => {
  return res.status(200).send("ok");
};

dbStatus = async (req, res, next) => {
  try {
    const { db, client } = await mongoConnect();
    const collections = await db.listCollections().toArray();
    // await // client.close();
    return res.status(200).json({ 
      success: true, 
      message: "Database connection successful", 
      collections: collections.length 
    });
  } catch (error) {
    console.error("DB Status Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Database connection failed", 
      error: error.message 
    });
  }
};

router.get("/status", apiStatus);
router.get("/status-db", dbStatus);

module.exports = router;
