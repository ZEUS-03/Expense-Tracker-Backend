const User = require("../models/User");
const logger = require("../utils/logger");

const requireAuth = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy((err) => {
        if (err) logger.error("Session destroy error:", err);
      });
      return res.status(401).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error("Auth middleware error:", error);
    res.status(500).json({
      error: "Authentication error",
      code: "AUTH_ERROR",
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    logger.error("Optional auth middleware error:", error);
    next(); // Continue without auth
  }
};

const checkSyncPermission = (req, res, next) => {
  if (req.user.syncInProgress) {
    return res.status(423).json({
      error: "Sync already in progress",
      code: "SYNC_IN_PROGRESS",
    });
  }
  next();
};

module.exports = {
  requireAuth,
  optionalAuth,
  checkSyncPermission,
};
