const mongoose = require("mongoose");

const emailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gmailId: {
      type: String,
      required: true,
      unique: true,
    },
    threadId: String,
    subject: {
      type: String,
      required: true,
    },
    from: {
      type: String,
      required: true,
    },
    to: String,
    date: {
      type: Date,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    bodyPlain: String, // Plain text version for ML processing
    isTransactional: {
      type: Boolean,
      default: null, // null = not processed yet
    },
    classificationConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    processed: {
      type: Boolean,
      default: false,
    },
    processingError: String,
    labels: [String], // Gmail labels
    attachments: [
      {
        filename: String,
        mimeType: String,
        size: Number,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
emailSchema.index({ userId: 1, date: -1 });
emailSchema.index({ gmailId: 1 }, { unique: true, sparse: true });
emailSchema.index({ isTransactional: 1 });
emailSchema.index({ processed: 1 });
emailSchema.index({ userId: 1, isTransactional: 1 });
emailSchema.index({ userId: 1, processed: 1 });

// Static methods
emailSchema.statics.findUnprocessed = function (userId, limit = 50) {
  return this.find({
    userId,
    processed: false,
  })
    .sort({ date: -1 })
    .limit(limit);
};

emailSchema.statics.getTransactionalEmails = function (
  userId,
  startDate,
  endDate
) {
  const query = {
    userId,
    isTransactional: true,
  };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startDate;
    if (endDate) query.date.$lte = endDate;
  }

  return this.find(query).sort({ date: -1 });
};

// Instance methods
emailSchema.methods.markProcessed = function (
  isTransactional,
  confidence = null,
  error = null
) {
  this.processed = true;
  this.isTransactional = isTransactional;
  this.classificationConfidence = confidence;
  this.processingError = error;
  return this.save();
};

module.exports = mongoose.model("Email", emailSchema);
