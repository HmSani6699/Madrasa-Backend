const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const authService = require(`${root}/services/auth.service`);
const router = require("express").Router();

router.post("/create-super-admin", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password required" });

  const { db, client } = await mongoConnect();
  
  try {
    const existingSuperAdmin = await db.collection("users").findOne({ role: "super_admin" });
    if (existingSuperAdmin) {
        return res.status(403).json({ message: "Super Admin already exists. Cannot create another via this setup route." });
    }

    const hashedPassword = await authService.hashPassword(password);
    await db.collection("users").insertOne({
        username: email,
        email,
        password: hashedPassword,
        role: "super_admin",
        madrasa_id: null,
        created_at: new Date()
    });

    res.json({ success: true, message: "Super Admin created successfully" });
  } catch(e) {
      console.error(e);
      res.status(500).json({ error: e.message });
  } finally {
      // client.close();
  }
});

module.exports = router;
