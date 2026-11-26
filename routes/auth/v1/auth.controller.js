const root = process.cwd();
const mongoConnect = require(`${root}/services/mongo-connect`);
const authService = require(`${root}/services/auth.service`);
const { ObjectId } = require("mongodb");

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
};

const buildAuthSessionPayload = async (db, user) => {
  const role = authService.normalizeRole(user.role);
  const madrasaObjectId = toObjectId(user.madrasa_id);

  let madrasa = null;
  if (madrasaObjectId) {
    madrasa = await db.collection("madrasas").findOne({ _id: madrasaObjectId });
  }

  const userPayload = {
    _id: user._id,
    username: user.username,
    email: user.email || "",
    role,
    madrasa_id: user.madrasa_id,
    madrasa_slug: madrasa ? madrasa.slug : ""
  };

  let guardianChildren;

  if (role === "guardian") {
    const refObjectId = toObjectId(user.reference_id);
    let parent = null;

    if (refObjectId) {
      parent = await db.collection("parents").findOne({ _id: refObjectId });
    }
    if (!parent) {
      parent = await db.collection("parents").findOne({ userId: user._id });
    }
    if (!parent && user.username) {
      const contactQuery = { contact: user.username };
      if (madrasaObjectId) contactQuery.madrasa_id = madrasaObjectId;
      parent = await db.collection("parents").findOne(contactQuery);
    }

    if (parent) {
      userPayload.id = parent._id.toString();
      userPayload.guardian_id = parent._id;
      userPayload.name = parent.fatherName || parent.motherName || user.username;
      userPayload.phone = parent.contact || user.username;
      userPayload.email = parent.email || user.email || "";
      userPayload.address = parent.address || "";
      userPayload.occupation = parent.fatherOccupation || parent.motherOccupation || "";
      userPayload.photo = parent.fatherPhoto || parent.motherPhoto || "";

      const students = await db.collection("students").find({
        guardian_id: { $in: [parent._id, parent._id.toString()] }
      }).toArray();

      const classIds = [...new Set(students.map((s) => toObjectId(s.class_id)).filter(Boolean))];
      const sectionIds = [...new Set(students.map((s) => toObjectId(s.section_id)).filter(Boolean))];

      const [classes, sections] = await Promise.all([
        classIds.length ? db.collection("classes").find({ _id: { $in: classIds } }).toArray() : [],
        sectionIds.length ? db.collection("sections").find({ _id: { $in: sectionIds } }).toArray() : []
      ]);

      const classMap = Object.fromEntries(classes.map((c) => [c._id.toString(), c.name]));
      const sectionMap = Object.fromEntries(sections.map((s) => [s._id.toString(), s.name]));

      guardianChildren = students.map((st) => {
        const fullName = [st.firstName, st.lastName].filter(Boolean).join(" ").trim() || st.name || "Student";
        const initials = fullName
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();

        return {
          id: st._id.toString(),
          _id: st._id,
          name: fullName,
          firstName: st.firstName || "",
          lastName: st.lastName || "",
          initials: initials || "ST",
          class: classMap[String(st.class_id)] || "",
          class_id: st.class_id || null,
          section: sectionMap[String(st.section_id)] || "",
          section_id: st.section_id || null,
          roll: st.roll_number || "",
          roll_number: st.roll_number || "",
          student_id: st.student_id || "",
          photo: st.photo || "",
          admissionStatus: st.admissionStatus || "Active"
        };
      });
    } else {
      guardianChildren = [];
    }
  } else if (["teacher", "talimat", "accountant", "staff", "admin", "mohtamim"].includes(role)) {
    const refObjectId = toObjectId(user.reference_id);
    let staffProfile = null;

    if (refObjectId) {
      staffProfile = await db.collection("staff").findOne({ _id: refObjectId });
    }
    if (!staffProfile) {
      staffProfile = await db.collection("staff").findOne({ userId: user._id });
    }

    if (staffProfile) {
      userPayload.staff_id = staffProfile._id;
      userPayload.name = staffProfile.name || user.name || user.username;
      userPayload.phone = staffProfile.phone || user.phone || "";
      userPayload.email = staffProfile.email || user.email || "";
      if (staffProfile.photo) {
        userPayload.avatar = staffProfile.photo;
      }
    } else {
      userPayload.name = user.name || user.username;
    }
  }

  return { userPayload, madrasa, guardianChildren };
};

const authController = {
  login: async (req, res) => {
    const { email, username, password } = req.body;
    const identifier = (email || username || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Email/Username and password are required" });
    }

    const { db } = await mongoConnect();

    try {
      // Find user by email, username, or phone
      const user = await db.collection("users").findOne({
        $or: [{ email: identifier }, { username: identifier }, { phone: identifier }]
      });

      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Check password
      const isMatch = await authService.comparePassword(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Generate Tokens (normalizes legacy 'parent' role to 'guardian')
      const accessToken = authService.generateAccessToken(user);
      const refreshToken = authService.generateRefreshToken(user);

      // Store Refresh Token
      await db.collection("refresh_tokens").insertOne({
        token: refreshToken,
        user_id: user._id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      const { userPayload, guardianChildren } = await buildAuthSessionPayload(db, user);

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          accessToken,
          refreshToken,
          user: userPayload,
          ...(guardianChildren !== undefined ? { guardianChildren } : {})
        }
      });

    } catch (error) {
      console.error("Login Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    } finally {
      // client.close();
    }
  },

  refreshToken: async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh Token is required" });
    }

    const { db, client } = await mongoConnect();

    try {
      // Verify signature
      const decoded = authService.verifyRefreshToken(refreshToken);
      if (!decoded) {
        return res.status(403).json({ success: false, message: "Invalid Refresh Token" });
      }

      // Check existence in DB
      const storedToken = await db.collection("refresh_tokens").findOne({ token: refreshToken });
      if (!storedToken) {
        return res.status(403).json({ success: false, message: "Refresh Token not found or revoked" });
      }

      // Fetch User to get latest role/info
      const user = await db.collection("users").findOne({ _id: new ObjectId(decoded.userId) });
      if (!user) {
        return res.status(403).json({ success: false, message: "User not found" });
      }

      // Generate new Access Token
      const newAccessToken = authService.generateAccessToken(user);

      res.status(200).json({
        success: true,
        accessToken: newAccessToken
      });

    } catch (error) {
      console.error("Refresh Token Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    } finally {
      // client.close();
    }
  },

  logout: async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.sendStatus(204); // No content

    const { db, client } = await mongoConnect();

    try {
      await db.collection("refresh_tokens").deleteOne({ token: refreshToken });
      res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    } finally {
      // client.close();
    }
  },

  me: async (req, res) => {
    const { db } = await mongoConnect();
    try {
      const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const { userPayload, madrasa, guardianChildren } = await buildAuthSessionPayload(db, user);

      res.status(200).json({
        success: true,
        data: {
          user: userPayload,
          madrasa,
          ...(guardianChildren !== undefined ? { guardianChildren } : {})
        }
      });
    } catch (error) {
      console.error("Get Profile Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

module.exports = authController;
