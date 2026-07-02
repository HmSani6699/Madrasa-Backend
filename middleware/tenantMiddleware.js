/**
 * Tenant Middleware
 * Ensures the user belongs to a valid, active Madrasa (Tenant)
 * Skips check for Super Admin
 */
const root = require("app-root-path");
const { ObjectId } = require("mongodb");
const mongoConnect = require(`${root}/services/mongo-connect`);

const tenantMiddleware = async (req, res, next) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  // Super Admin does not belong to a specific tenant
  if (user.role === 'super_admin') {
    return next();
  }

  if (!user.madrasa_id) {
    return res.status(403).json({ 
      success: false, 
      message: "Access Denied: No valid Madrasa associated with this user." 
    });
  }

  try {
    const { db } = await mongoConnect();
    const madrasa = await db.collection("madrasas").findOne({ _id: new ObjectId(user.madrasa_id) });

    if (!madrasa) {
      return res.status(403).json({ 
        success: false, 
        message: "Access Denied: Madrasa not found." 
      });
    }

    // Convert status to lowercase for robust matching
    const currentStatus = (madrasa.status || "active").toLowerCase();

    if (currentStatus === 'blocked') {
      return res.status(403).json({ 
        success: false, 
        message: "Access Denied: This Madrasa has been blocked by the Super Admin." 
      });
    }

    if (currentStatus === 'suspended') {
      return res.status(403).json({ 
        success: false, 
        message: "Access Denied: This Madrasa's subscription has been suspended. Please contact Super Admin to pay outstanding bills." 
      });
    }

    // Attach Madrasa configuration and subscription details to request object
    req.madrasa = madrasa;

    // Valid and active tenant found
    next();
  } catch (err) {
    console.error("Tenant Middleware Error:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error during tenant subscription verification." 
    });
  }
};

module.exports = tenantMiddleware;
