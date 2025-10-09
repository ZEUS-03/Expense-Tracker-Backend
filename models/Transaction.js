const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    emailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Email",
      // required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
    },
    transactionDate: {
      type: Date,
      // required: true,
    },
    transactionType: {
      type: String,
      enum: [
        "bill_payment",
        "purchase",
        "subscription",
        "refund",
        "transfer",
        "entertainment",
        "fuel",
        "other",
      ],
      required: true,
    },
    merchant: String,
    category: String,
    description: String,
    extractionConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    tags: [String],
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
transactionSchema.index({ userId: 1, transactionDate: -1 });
transactionSchema.index({ emailId: 1 });
transactionSchema.index({ transactionType: 1 });
transactionSchema.index({ amount: 1 });
transactionSchema.index({ userId: 1, transactionType: 1 });
transactionSchema.index({ userId: 1, merchant: 1 });

// Static methods
transactionSchema.statics.getByDateRange = function (
  userId,
  startDate,
  endDate
) {
  return this.find({
    userId,
    transactionDate: {
      $gte: startDate,
      $lte: endDate,
    },
  }).sort({ transactionDate: -1 });
};

transactionSchema.statics.getByType = function (userId, type) {
  return this.find({
    userId,
    transactionType: type,
  }).sort({ transactionDate: -1 });
};

transactionSchema.statics.getTotalAmount = function (
  userId,
  startDate = null,
  endDate = null
) {
  const match = { userId };

  if (startDate || endDate) {
    match.transactionDate = {};
    if (startDate) match.transactionDate.$gte = startDate;
    if (endDate) match.transactionDate.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$currency",
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);
};

transactionSchema.statics.getThisMonthTransactionsTotal = function (userId) {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return this.aggregate([
    {
      $match: {
        userId: userId,
        transactionDate: { $gte: startDate, $lt: endDate },
      },
    },
    {
      $group: {
        _id: null, // group all matched docs together
        totalAmount: { $sum: "$amount" },
        transactions: { $push: "$$ROOT" }, // if you want the full docs as well
      },
    },
  ]);
};

transactionSchema.statics.getTotalTransactionAmount = function (userId) {
  return this.aggregate([
    { $match: { userId: userId } },
    {
      $group: {
        _id: null, // group all matched docs together
        totalSpent: { $sum: "$amount" },
      },
    },
  ]);
};

transactionSchema.statics.getDailyWeekTotal = function (userId) {
  return this.aggregate([
    {
      $match: {
        userId: userId,
        transactionDate: {
          $gte: new Date(
            new Date().setHours(0, 0, 0, 0) - new Date().getDay() * 86400000
          ), // Start of Sunday
          $lt: new Date(
            new Date().setHours(0, 0, 0, 0) +
              (7 - new Date().getDay()) * 86400000
          ), // End of Saturday
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$transactionDate" },
        },
        totalAmount: { $sum: "$amount" },
      },
    },
    {
      $sort: { _id: 1 }, // Sort by date ascending
    },
  ]);
};
// transactionSchema.statics.getThisMonthTransactions = function (userId) {
//   const now = new Date();
//   const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
//   const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

//   return this.find({
//     userId,
//     transactionDate: {
//       $gte: startDate,
//       $lt: endDate,
//     },
//   }).sort({ transactionDate: -1 });
// };

transactionSchema.statics.getMonthlyStats = function (userId, year) {
  return this.aggregate([
    {
      $match: {
        userId,
        transactionDate: {
          $gte: new Date(year, 0, 1),
          $lt: new Date(year + 1, 0, 1),
        },
      },
    },
    {
      $group: {
        _id: {
          month: { $month: "$transactionDate" },
        },
        totalAmount: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: {
        "_id.month": 1,
        "_id.type": 1,
      },
    },
  ]);
};

// Virtual for formatted amount
transactionSchema.virtual("formattedAmount").get(function () {
  return `${this.currency} ${this.amount.toFixed(2)}`;
});

module.exports = mongoose.model("Transaction", transactionSchema);
