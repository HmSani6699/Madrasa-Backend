const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/auth');

const authService = {
  /**
   * Normalize legacy role aliases to canonical role names.
   * @param {string} role
   * @returns {string}
   */
  normalizeRole(role) {
    return role === 'parent' ? 'guardian' : role;
  },

  /**
   * Ensure a login account exists in `users` for a guardian profile.
   * Defaults password to the guardian's contact number.
   */
  async ensureGuardianUser(db, { contact, email = '', madrasaId = null, referenceId = null }) {
    const trimmedContact = (contact || '').trim();
    const trimmedEmail = (email || '').trim();

    if (!trimmedContact) {
      return null;
    }

    const lookupConditions = [{ username: trimmedContact }];
    if (trimmedEmail) {
      lookupConditions.push({ email: trimmedEmail });
    }

    const existingUser = await db.collection('users').findOne({ $or: lookupConditions });
    if (existingUser) {
      const updates = {};
      if (existingUser.role === 'parent') {
        updates.role = 'guardian';
      }
      if (!existingUser.reference_id && referenceId && (existingUser.role === 'parent' || existingUser.role === 'guardian')) {
        updates.reference_id = referenceId;
      }
      if (Object.keys(updates).length > 0) {
        updates.updated_at = Date.now();
        await db.collection('users').updateOne({ _id: existingUser._id }, { $set: updates });
      }
      return existingUser._id;
    }

    const hashedPassword = await this.hashPassword(trimmedContact);
    const now = Date.now();
    const result = await db.collection('users').insertOne({
      username: trimmedContact,
      email: trimmedEmail,
      password: hashedPassword,
      role: 'guardian',
      madrasa_id: madrasaId,
      reference_id: referenceId,
      created_at: now,
      updated_at: now
    });

    return result.insertedId;
  },

  /**
   * Hash a password
   * @param {string} password 
   * @returns {string} hashed password
   */
  async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
  },

  /**
   * Compare a password with a hash
   * @param {string} password 
   * @param {string} hash 
   * @returns {boolean} true if match
   */
  async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  },

  /**
   * Generate Access Token
   * @param {object} user - User object (should contain _id, role, madrasa_id)
   * @returns {string} JWT Token
   */
  generateAccessToken(user) {
    const payload = {
      userId: user._id,
      role: this.normalizeRole(user.role),
      madrasa_id: user.madrasa_id,
      username: user.username
    };
    return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiration });
  },

  /**
   * Generate Refresh Token
   * @param {object} user 
   * @returns {string} JWT Refresh Token
   */
  generateRefreshToken(user) {
    const payload = {
      userId: user._id,
      tokenType: 'refresh'
    };
    return jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: config.jwtRefreshExpiration });
  },

  /**
   * Verify Access Token
   * @param {string} token 
   * @returns {object} Decoded payload
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch (error) {
      return null;
    }
  },

  /**
   * Verify Refresh Token
   * @param {string} token 
   * @returns {object} Decoded payload
   */
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, config.jwtRefreshSecret);
    } catch (error) {
      return null;
    }
  }
};

module.exports = authService;
