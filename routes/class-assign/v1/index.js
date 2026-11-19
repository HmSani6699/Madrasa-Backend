const router = require("express").Router();
const root = require("app-root-path");
const Joi = require("joi");
const validate = require(`${root}/middleware/validate`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const assignmentSchema = Joi.object({
  classId: Joi.string().allow(null, ""),
  sectionIds: Joi.array().items(Joi.string()).allow(null),
  subjectIds: Joi.array().items(Joi.string()).required(),
});

const assignSubjects = async (req, res) => {
  const { db, client } = await mongoConnect();
  try {
    const { classId, sectionIds, subjectIds } = req.body;
    const subObjectIds = subjectIds.map(id => new ObjectId(id));

    if (sectionIds && sectionIds.length > 0) {
      // Update multiple sections
      const sectionObjectIds = sectionIds.map(id => new ObjectId(id));
      await db.collection("sections").updateMany(
        { _id: { $in: sectionObjectIds }, madrasa_id: req.user.madrasa_id },
        { $set: { subjects: subObjectIds, updated_at: Date.now() } }
      );
      return res.status(200).json({ success: true, message: "Subjects assigned to sections successfully" });
    } else if (classId) {
      // Update class itself (for when no sections exist)
      await db.collection("classes").updateOne(
        { _id: new ObjectId(classId), madrasa_id: req.user.madrasa_id },
        { $set: { subjects: subObjectIds, updated_at: Date.now() } }
      );
      return res.status(200).json({ success: true, message: "Subjects assigned to class successfully" });
    }

    res.status(400).json({ success: false, message: "Invalid assignment parameters" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    // await // client.close();
  }
};

router.post("/class-assign", validate(assignmentSchema), assignSubjects);

module.exports = router;
