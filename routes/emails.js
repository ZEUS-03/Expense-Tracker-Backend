const express = require("express");
const Email = require("../models/Email");
const Transaction = require("../models/Transaction");
const { requireAuth, checkSyncPermission } = require("../middleware/auth");
const { syncLimiter, processLimiter } = require("../middleware/ratelimiter");
const gmailService = require("../services/gmailService");
const classificationService = require("../services/classificationService");
const extractionService = require("../services/extractionService");
const logger = require("../utils/logger");

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Sync emails from Gmail
router.post("/sync", syncLimiter, checkSyncPermission, async (req, res) => {
  try {
    const user = req.user;
    const { maxResults = 50, syncAll = false } = req.body;

    // Mark sync as in progress
    await user.updateSyncStatus(true);

    // Start sync process (don't await - run in background)
    syncEmails(user, maxResults, syncAll).catch((error) => {
      logger.error(`Sync error for user ${user.email}:`, error);
      user.updateSyncStatus(false);
    });

    res.json({
      message: "Email sync started",
      syncInProgress: true,
    });
  } catch (error) {
    logger.error("Sync initiation error:", error);
    await req.user.updateSyncStatus(false);
    res.status(500).json({
      error: "Failed to start sync",
      code: "SYNC_START_ERROR",
    });
  }
});

// Get sync status
router.get("/sync/status", (req, res) => {
  res.json({
    syncInProgress: req.user.syncInProgress,
    lastSyncDate: req.user.lastSyncDate,
    totalEmails: req.user.totalEmails,
    transactionalEmails: req.user.transactionalEmails,
  });
});

// Get emails with pagination and filtering
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      isTransactional,
      startDate,
      endDate,
      search,
    } = req.query;

    const query = { userId: req.user._id };

    // Filter by transaction status
    if (isTransactional !== undefined) {
      query.isTransactional = isTransactional === "true";
    }

    // Date range filter
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // Search in subject and from fields
    if (search) {
      query.$or = [
        { subject: { $regex: search, $options: "i" } },
        { from: { $regex: search, $options: "i" } },
      ];
    }

    const options = {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100), // Max 100 emails per request
      sort: { date: -1 },
      select:
        "gmailId subject from date isTransactional classificationConfidence processed",
    };

    const result = await Email.paginate(query, options);

    res.json({
      emails: result.docs,
      pagination: {
        currentPage: result.page,
        totalPages: result.totalPages,
        totalEmails: result.totalDocs,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
    });
  } catch (error) {
    logger.error("Get emails error:", error);
    res.status(500).json({
      error: "Failed to fetch emails",
      code: "FETCH_EMAILS_ERROR",
    });
  }
});

// Get specific email details
router.get("/:emailId", async (req, res) => {
  try {
    const email = await Email.findOne({
      _id: req.params.emailId,
      userId: req.user._id,
    });

    if (!email) {
      return res.status(404).json({
        error: "Email not found",
        code: "EMAIL_NOT_FOUND",
      });
    }

    // Get associated transaction if exists
    const transaction = await Transaction.findOne({ emailId: email._id });

    res.json({
      email,
      transaction,
    });
  } catch (error) {
    logger.error("Get email details error:", error);
    res.status(500).json({
      error: "Failed to fetch email details",
      code: "FETCH_EMAIL_DETAILS_ERROR",
    });
  }
});

// Process unprocessed emails
router.post("/process", processLimiter, async (req, res) => {
  try {
    const { batchSize = 10 } = req.body;

    // Get unprocessed emails
    const unprocessedEmails = await Email.findUnprocessed(
      req.user._id,
      batchSize
    );

    if (unprocessedEmails.length === 0) {
      return res.json({
        message: "No unprocessed emails found",
        processedCount: 0,
      });
    }

    // Process emails in background
    processEmails(req.user._id, unprocessedEmails).catch((error) => {
      logger.error(`Email processing error for user ${req.user.email}:`, error);
    });

    res.json({
      message: "Email processing started",
      emailCount: unprocessedEmails.length,
    });
  } catch (error) {
    logger.error("Process emails error:", error);
    res.status(500).json({
      error: "Failed to start email processing",
      code: "PROCESS_START_ERROR",
    });
  }
});

// Get transactions
router.get("/transactions", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      type,
      minAmount,
      maxAmount,
    } = req.query;

    const query = { userId: req.user._id };

    // Date range filter
    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    // Transaction type filter
    if (type) {
      query.transactionType = type;
    }

    // Amount range filter
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    const transactions = await Transaction.find(query)
      .populate("emailId", "subject from date")
      .sort({ transactionDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalCount = await Transaction.countDocuments(query);

    res.json({
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalTransactions: totalCount,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    logger.error("Get transactions error:", error);
    res.status(500).json({
      error: "Failed to fetch transactions",
      code: "FETCH_TRANSACTIONS_ERROR",
    });
  }
});

// Get transaction statistics
router.get("/transactions/stats", async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    const [monthlyStats, totalStats, typeStats] = await Promise.all([
      Transaction.getMonthlyStats(req.user._id, parseInt(year)),
      Transaction.getTotalAmount(req.user._id),
      Transaction.aggregate([
        { $match: { userId: req.user._id } },
        {
          $group: {
            _id: "$transactionType",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    res.json({
      monthlyStats,
      totalStats,
      typeStats,
      year: parseInt(year),
    });
  } catch (error) {
    logger.error("Get transaction stats error:", error);
    res.status(500).json({
      error: "Failed to fetch transaction statistics",
      code: "FETCH_STATS_ERROR",
    });
  }
});

// Background function to sync emails
async function syncEmails(user, maxResults, syncAll) {
  try {
    logger.info(`Starting email sync for user: ${user.email}`);

    const emails = await gmailService.fetchEmails(user, maxResults, syncAll);

    let savedCount = 0;
    for (const emailData of emails) {
      try {
        // Check if email already exists
        const existingEmail = await Email.findOne({ gmailId: emailData.id });
        if (!existingEmail) {
          const email = new Email({
            userId: user._id,
            gmailId: emailData.id,
            ...emailData,
          });
          await email.save();
          savedCount++;
        }
      } catch (emailError) {
        logger.error(`Error saving email ${emailData.id}:`, emailError);
      }
    }

    // Update user stats
    user.totalEmails += savedCount;
    await user.updateSyncStatus(false);

    logger.info(
      `Sync completed for ${user.email}. Saved ${savedCount} new emails.`
    );
  } catch (error) {
    logger.error(`Sync failed for user ${user.email}:`, error);
    await user.updateSyncStatus(false);
    throw error;
  }
}

// Background function to process emails
async function processEmails(userId, emails) {
  logger.info(
    `Processing ${emails.length} emails for classification and extraction`
  );

  for (const email of emails) {
    try {
      // Classify email
      const classification = await classificationService.classifyEmail(
        email.bodyPlain || email.body
      );

      await email.markProcessed(
        classification.isTransactional,
        classification.confidence
      );

      // If transactional, extract transaction details
      if (classification.isTransactional) {
        try {
          const extraction = await extractionService.extractTransaction(
            email.bodyPlain || email.body
          );

          if (extraction && extraction.amount) {
            const transaction = new Transaction({
              emailId: email._id,
              userId,
              amount: extraction.amount,
              currency: extraction.currency || "USD",
              transactionDate: extraction.date || email.date,
              transactionType: extraction.type || "other",
              merchant: extraction.merchant,
              extractionConfidence: extraction.confidence,
              rawExtraction: extraction,
            });

            await transaction.save();

            // Update user transaction count
            await User.findByIdAndUpdate(userId, {
              $inc: { transactionalEmails: 1 },
            });
          }
        } catch (extractionError) {
          logger.error(
            `Transaction extraction failed for email ${email._id}:`,
            extractionError
          );
        }
      }
    } catch (error) {
      logger.error(`Processing failed for email ${email._id}:`, error);
      await email.markProcessed(null, null, error.message);
    }
  }

  logger.info(`Completed processing ${emails.length} emails`);
}

module.exports = router;
