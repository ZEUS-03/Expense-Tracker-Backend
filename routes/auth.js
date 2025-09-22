const express = require("express");
const { google } = require("googleapis");
const User = require("../models/User");
const { getAuthUrl, getTokens, setCredentials } = require("../config/oAuth");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { authLimiter } = require("../middleware/ratelimiter");
const logger = require("../utils/logger");

const router = express.Router();

// Apply auth rate limiter to all auth routes
router.use(authLimiter);

// Get Google OAuth URL
router.get("/google/url", (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    logger.error("Error generating auth URL:", error);
    res.status(500).json({
      error: "Failed to generate authentication URL",
      code: "AUTH_URL_ERROR",
    });
  }
});

// Handle OAuth callback
router.get("/google/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    logger.error("OAuth callback error:", error);
    return res.redirect(
      `${process.env.FRONTEND_URL}/auth/error?error=${error}`
    );
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/auth/error?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokens = await getTokens(code);
    const oauth2Client = setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Find or create user
    let user = await User.findOne({ googleId: userInfo.id });
    let routeToRedirect = "";
    if (!user) {
      user = new User({
        googleId: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
      });
      routeToRedirect = "/email-sync";
    } else {
      // Update existing user
      user.name = userInfo.name;
      user.picture = userInfo.picture;
      user.accessToken = tokens.access_token;
      routeToRedirect = "/dashboard";
      // Update refresh token if provided (Google only sends it on first auth)
      if (tokens.refresh_token) {
        user.refreshToken = tokens.refresh_token;
      }
    }

    await user.save();

    // Set session
    req.session.userId = user._id;
    req.session.save((err) => {
      if (err) {
        logger.error("Session save error:", err);
        return res.redirect(
          `${process.env.FRONTEND_URL}/auth/error?error=session_error`
        );
      }

      logger.info(`User authenticated: ${user.email}`);
      res.redirect(`${process.env.FRONTEND_URL}${routeToRedirect}`);
    });
  } catch (error) {
    logger.error("OAuth callback processing error:", error);
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/error?error=processing_error`
    );
  }
});

// Get current user info
router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      totalEmails: req.user.totalEmails,
      transactionalEmails: req.user.transactionalEmails,
      lastSyncDate: req.user.lastSyncDate,
      syncInProgress: req.user.syncInProgress,
      settings: req.user.settings,
    },
  });
});

// Update user settings
router.patch("/settings", requireAuth, async (req, res) => {
  try {
    const { autoSync, syncInterval, emailLimit } = req.body;
    const user = req.user;

    if (typeof autoSync === "boolean") {
      user.settings.autoSync = autoSync;
    }

    if (syncInterval && syncInterval >= 1 && syncInterval <= 168) {
      // 1 hour to 1 week
      user.settings.syncInterval = syncInterval;
    }

    if (emailLimit && emailLimit >= 100 && emailLimit <= 10000) {
      user.settings.emailLimit = emailLimit;
    }

    await user.save();

    res.json({
      message: "Settings updated successfully",
      settings: user.settings,
    });
  } catch (error) {
    logger.error("Settings update error:", error);
    res.status(500).json({
      error: "Failed to update settings",
      code: "SETTINGS_UPDATE_ERROR",
    });
  }
});

// Logout
router.post("/logout", optionalAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error("Logout error:", err);
      return res.status(500).json({
        error: "Failed to logout",
        code: "LOGOUT_ERROR",
      });
    }
    res.json({ message: "Logged out successfully" });
  });
});

// Delete account
router.delete("/account", requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Delete all user data
    await Promise.all([
      User.findByIdAndDelete(userId),
      // Note: Also delete related emails and transactions
      // This will be handled by the Email and Transaction models if needed
    ]);

    req.session.destroy((err) => {
      if (err) logger.error("Session destroy error on account deletion:", err);
    });

    logger.info(`Account deleted: ${req.user.email}`);
    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    logger.error("Account deletion error:", error);
    res.status(500).json({
      error: "Failed to delete account",
      code: "ACCOUNT_DELETE_ERROR",
    });
  }
});

module.exports = router;
