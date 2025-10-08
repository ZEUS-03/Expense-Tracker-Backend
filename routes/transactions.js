const express = require("express");
const Transaction = require("../models/Transaction");
const { requireAuth } = require("../middleware/auth");
const { parseDate } = require("../utils/helper");

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// add transactions
router.post("/", async (req, res) => {
  const { amount, transactionDate, transactionType, merchant } = req.body;
  const newDate = parseDate(transactionDate);
  try {
    const transaction = await Transaction.create({
      amount,
      userId: req.user.id,
      transactionDate: newDate,
      transactionType,
      merchant,
    });
    res.status(201).json(transaction);
  } catch (error) {
    res.status(500).json({
      error: "Failed to add transaction",
      errorDetails: error.message,
    });
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { amount, transactionDate, transactionType, merchant } = req.body;
  const userId = req.user.id;
  const newDate = parseDate(transactionDate);

  try {
    // Step 1: Find the transaction by ID
    const transaction = await Transaction.findById(id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Step 2: Check if the user owns the transaction
    if (transaction.userId.toString() !== userId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to update this transaction" });
    }

    // Step 3: Update the transaction
    if (amount) {
      transaction.amount = amount;
    }
    if (newDate) {
      transaction.transactionDate = newDate;
    }
    if (transactionType) {
      transaction.transactionType = transactionType;
    }
    if (merchant) {
      transaction.merchant = merchant;
    }

    const updatedTransaction = await transaction.save();

    res.status(200).json(updatedTransaction);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const transaction = await Transaction.findById(id);
  if (transaction.userId.toString() !== userId) {
    return res
      .status(403)
      .json({ error: "Unauthorized to delete this transaction" });
  }
  try {
    const transaction = await Transaction.findByIdAndDelete(id);
    res.status(200).json(transaction);
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

module.exports = router;
