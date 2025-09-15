const mongoose = require("mongoose");
const Email = require("./Email");

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    picture: String,
    refreshToken: {
      type: String,
      required: true,
    },
    accessToken: String,
    lastSyncDate: {
      type: Date,
      default: Date.now,
    },
    syncInProgress: {
      type: Boolean,
      default: false,
    },
    totalEmails: {
      type: Number,
      default: 0,
    },
    transactionalEmails: {
      type: Number,
      default: 0,
    },
    emails: [{ type: mongoose.Schema.Types.ObjectId, ref: "Email" }],
    settings: {
      autoSync: {
        type: Boolean,
        default: true,
      },
      syncInterval: {
        type: Number,
        default: 24, // hours
      },
      emailLimit: {
        type: Number,
        default: 1000,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
userSchema.index({ googleId: 1 });
userSchema.index({ email: 1 });
userSchema.index({ lastSyncDate: 1 });

// Instance methods
userSchema.methods.needsSync = function () {
  if (!this.settings.autoSync) return false;

  const now = new Date();
  const lastSync = this.lastSyncDate;
  const intervalMs = this.settings.syncInterval * 60 * 60 * 1000;

  return now - lastSync > intervalMs;
};

userSchema.methods.updateSyncStatus = function (inProgress = false) {
  this.syncInProgress = inProgress;
  if (!inProgress) {
    this.lastSyncDate = new Date();
  }
  return this.save();
};

module.exports = mongoose.model("User", userSchema);
