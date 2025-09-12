const winston = require("winston");
const path = require("path");

// Create logs directory if it doesn't exist
const fs = require("fs");
const logDir = "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss",
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define console format
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss",
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      msg += "\n" + JSON.stringify(meta, null, 2);
    }

    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: { service: "email-transaction-backend" },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
    }),

    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Write all logs with level 'debug' and below to debug.log (only in development)
    ...(process.env.NODE_ENV !== "production"
      ? [
          new winston.transports.File({
            filename: path.join(logDir, "debug.log"),
            level: "debug",
            maxsize: 5242880, // 5MB
            maxFiles: 3,
          }),
        ]
      : []),
  ],

  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "exceptions.log"),
    }),
  ],

  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "rejections.log"),
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
      handleExceptions: true,
    })
  );
}

// Create a stream object for Morgan HTTP logging middleware
logger.stream = {
  write: function (message) {
    logger.info(message.trim());
  },
};

// Add custom logging methods for specific use cases
logger.logEmailSync = function (userId, emailCount, success = true) {
  const level = success ? "info" : "error";
  logger.log(level, "Email sync completed", {
    userId,
    emailCount,
    success,
    timestamp: new Date().toISOString(),
  });
};

logger.logEmailProcessing = function (
  emailId,
  userId,
  isTransactional,
  confidence,
  error = null
) {
  const level = error ? "error" : "info";
  logger.log(level, "Email processing completed", {
    emailId,
    userId,
    isTransactional,
    confidence,
    error: error?.message,
    timestamp: new Date().toISOString(),
  });
};

logger.logTransactionExtraction = function (
  emailId,
  userId,
  extraction,
  error = null
) {
  const level = error ? "error" : "info";
  logger.log(level, "Transaction extraction completed", {
    emailId,
    userId,
    amount: extraction?.amount,
    currency: extraction?.currency,
    type: extraction?.type,
    merchant: extraction?.merchant,
    confidence: extraction?.confidence,
    error: error?.message,
    timestamp: new Date().toISOString(),
  });
};

logger.logApiCall = function (
  method,
  endpoint,
  userId,
  responseTime,
  statusCode
) {
  logger.info("API call", {
    method,
    endpoint,
    userId,
    responseTime,
    statusCode,
    timestamp: new Date().toISOString(),
  });
};

logger.logUserAction = function (userId, action, details = {}) {
  logger.info("User action", {
    userId,
    action,
    details,
    timestamp: new Date().toISOString(),
  });
};

logger.logServiceHealth = function (serviceName, status, details = {}) {
  const level = status === "healthy" ? "info" : "warn";
  logger.log(level, "Service health check", {
    serviceName,
    status,
    details,
    timestamp: new Date().toISOString(),
  });
};

// Security logging
logger.logSecurityEvent = function (
  event,
  userId = null,
  ipAddress = null,
  details = {}
) {
  logger.warn("Security event", {
    event,
    userId,
    ipAddress,
    details,
    timestamp: new Date().toISOString(),
  });
};

// Performance logging
logger.logPerformance = function (operation, duration, details = {}) {
  const level = duration > 5000 ? "warn" : "info"; // Warn if operation takes more than 5 seconds
  logger.log(level, "Performance metric", {
    operation,
    duration,
    details,
    timestamp: new Date().toISOString(),
  });
};

// Database logging
logger.logDatabaseOperation = function (
  operation,
  collection,
  duration,
  error = null
) {
  const level = error ? "error" : "debug";
  logger.log(level, "Database operation", {
    operation,
    collection,
    duration,
    error: error?.message,
    timestamp: new Date().toISOString(),
  });
};

module.exports = logger;
