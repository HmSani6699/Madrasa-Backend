const router = require("express").Router();
const root = require("app-root-path");

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const authRoute = require(`${root}/middleware/authenticate`);
const authorize = require(`${root}/middleware/authorize`);

getPersonData = async (req, res, next) => {
  const { db, client } = await mongoConnect();
  try {
    const query = { ...req.query, madrasa_id: req.user.madrasa_id };
    const person = await mongo.fetchOne(db, "person", query);
    res.status(200).json({ success: true, person });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

setPersonData = async (req, res, next) => {
  const { db, client } = await mongoConnect();
  try {
    const personData = { ...req.body, madrasa_id: req.user.madrasa_id };
    const person = await mongo.insertOne(db, "person", personData);
    res.status(200).json({ success: true, person });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};
updatePersonData = async (req, res, next) => {
  const { db, client } = await mongoConnect();
  try {
    const person = await mongo.updateData(
      db,
      "person",
      {
        username: req.params.username,
        madrasa_id: req.user.madrasa_id
      },
      {
        $set: {
          ...req.body,
          ...{ updated_at: Date.now() },
        },
      }
    );
    res.status(200).json({ success: true, person });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};
router.get("/person", getPersonData);
router.put("/person/:username", updatePersonData);

router.post("/person", setPersonData);

module.exports = router;
