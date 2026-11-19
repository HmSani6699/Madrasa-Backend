const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const authService = require(`${root}/services/auth.service`);
const { ObjectId } = require("mongodb");

const authController = {
  login: async (req, res) => {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: "Email/Username and password are required" });
    }

    const { db, client } = await mongoConnect();
    
    try {
      // Find user by email or username
      const user = await db.collection("users").findOne({
        $or: [{ email: identifier }, { username: identifier }]
      });

      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Check password
      const isMatch = await authService.comparePassword(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Generate Tokens
      const accessToken = authService.generateAccessToken(user);
      const refreshToken = authService.generateRefreshToken(user);

      // Store Refresh Token
      await db.collection("refresh_tokens").insertOne({
        token: refreshToken,
        user_id: user._id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });
      

      // Fetch Madrasa info for slug
      let madrasa_slug = "";
      if (user.madrasa_id) {
        const madrasa = await db.collection("madrasas").findOne({ _id: new ObjectId(user.madrasa_id) });
      
        if (madrasa) madrasa_slug = madrasa.slug;
      }

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          accessToken,
          refreshToken,
          user: {
            _id: user._id,
            username: user.username,
            role: user.role,
            madrasa_id: user.madrasa_id,
            madrasa_slug: madrasa_slug
          }
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

      let madrasa = null;
      if (user.madrasa_id) {
        madrasa = await db.collection("madrasas").findOne({ _id: new ObjectId(user.madrasa_id) });
      }

      res.status(200).json({
        success: true,
        data: {
          user: {
            _id: user._id,
            username: user.username,
            role: user.role,
            madrasa_id: user.madrasa_id,
            madrasa_slug: madrasa ? madrasa.slug : ""
          },
          madrasa
        }
      });
    } catch (error) {
      console.error("Get Profile Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

module.exports = authController;
