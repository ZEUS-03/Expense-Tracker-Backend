const axios = require("axios");
const logger = require("../utils/logger");

class ExtractionService {
  constructor() {
    this.serviceUrl = process.env.EXTRACTION_SERVICE_URL;
    this.timeout = 45000; // 45 seconds timeout for extraction (more complex than classification)
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
  }

  async extractTransaction(emailContent) {
    if (!this.serviceUrl) {
      throw new Error("Extraction service URL not configured");
    }

    if (!emailContent) {
      logger.warn("Empty email content provided for extraction");
      return {
        amount: null,
        currency: null,
        date: null,
        type: null,
        merchant: null,
        confidence: 0,
        error: "Empty content",
      };
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        logger.info(
          `Extracting transaction details (attempt ${attempt}/${this.retryAttempts})`
        );

        // Prepare the request payload
        // const payload = {
        //   text: emailContent.substring(0, 15000), // Limit to first 15k characters for extraction
        // };
        const response = await axios.post(this.serviceUrl, emailContent, {
          timeout: this.timeout,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "EmailTransactionBackend/1.0",
          },
        });

        // Parse and validate the extraction result
        const result = this.parseExtractionResponse(response.data);

        return result;
      } catch (error) {
        logger.error(`Extraction attempt ${attempt} failed:`, {
          error: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
        });

        // If this is the last attempt, return error result
        if (attempt === this.retryAttempts) {
          return {
            amount: null,
            currency: null,
            date: null,
            type: null,
            merchant: null,
            confidence: 0,
            error: error.message,
          };
        }

        // Wait before retrying
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * attempt)
        );
      }
    }
  }

  parseExtractionResponse(responseData) {
    try {
      let extractedData = responseData;
      const results = [];
      if (!extractedData.success) {
        return null;
      }
      for (let item of extractedData.results) {
        // Handle different response formats
        if (!item.success) {
          continue;
        }

        // Parse amount
        const amount = this.parseAmount(item.final_amount);

        // Validate required fields
        if (!amount || amount <= 0) {
          logger.warn("Invalid or missing amount in extraction result");
          // result.error = "Invalid amount extracted";
          continue;
        }

        // Parse currency
        // const currency = this.parseCurrency(
        //   extractedData.currency || extractedData.curr || "USD"
        // );

        // Parse date
        const date = this.parseDate(item.transaction_date);

        // Parse transaction type
        const type = item.transaction_type;

        // Parse merchant
        const merchant = this.parseMerchant(item.merchant);

        // Parse confidence
        // const confidence = this.parseConfidence(item.confidence || item.score);

        const result = {
          amount,
          // currency,
          date,
          type,
          merchant,
          rawResponse: responseData,
        };

        results.push(result);
      }
      return results;
    } catch (error) {
      logger.error("Error parsing extraction response:", error);
      return {
        amount: null,
        // currency: null,
        date: null,
        type: null,
        merchant: null,
        // confidence: 0,
        error: "Response parsing failed",
        rawResponse: responseData,
      };
    }
  }

  parseAmount(amountStr) {
    if (!amountStr) return null;

    try {
      // Convert to string if it's a number
      const str = String(amountStr);

      // Remove common currency symbols and formatting
      const cleaned = str.replace(/[$€£¥₹,\s]/g, "");

      // Extract number (including decimals)
      const match = cleaned.match(/\d+\.?\d*/);
      if (match) {
        const amount = parseFloat(match[0]);
        return amount > 0 ? amount : null;
      }

      return null;
    } catch (error) {
      logger.warn("Error parsing amount:", amountStr, error);
      return null;
    }
  }

  parseCurrency(currencyStr) {
    if (!currencyStr) return "USD";

    try {
      const str = String(currencyStr).toUpperCase();

      // Common currency mappings
      const currencyMappings = {
        $: "USD",
        "€": "EUR",
        "£": "GBP",
        "¥": "JPY",
        "₹": "INR",
        DOLLAR: "USD",
        DOLLARS: "USD",
        EURO: "EUR",
        EUROS: "EUR",
        POUND: "GBP",
        POUNDS: "GBP",
        YEN: "JPY",
        RUPEE: "INR",
        RUPEES: "INR",
      };

      // Check direct mapping
      if (currencyMappings[str]) {
        return currencyMappings[str];
      }

      // Check if it's already a valid currency code (3 letters)
      if (/^[A-Z]{3}$/.test(str)) {
        return str;
      }

      return "USD"; // Default fallback
    } catch (error) {
      logger.warn("Error parsing currency:", currencyStr, error);
      return "USD";
    }
  }

  parseDate(dateStr) {
    if (!dateStr) return null;

    try {
      // Try parsing the date
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }

      // Try parsing common date formats
      const formats = [
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY or DD/MM/YYYY
        /(\d{4})-(\d{1,2})-(\d{1,2})/, // YYYY-MM-DD
        /(\d{1,2})-(\d{1,2})-(\d{4})/, // MM-DD-YYYY or DD-MM-YYYY
      ];

      for (const format of formats) {
        const match = String(dateStr).match(format);
        if (match) {
          const parsedDate = new Date(match[0]);
          if (!isNaN(parsedDate.getTime())) {
            return parsedDate;
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn("Error parsing date:", dateStr, error);
      return null;
    }
  }

  parseMerchant(merchantStr) {
    if (!merchantStr) return null;

    try {
      const str = String(merchantStr).trim();

      // Clean up common prefixes/suffixes
      const cleaned = str
        .replace(/^(from|to|at|@)\s+/i, "")
        .replace(/\s+(inc|llc|ltd|corp|co)\.?$/i, "")
        .trim();

      return cleaned.length > 0 ? cleaned : null;
    } catch (error) {
      logger.warn("Error parsing merchant:", merchantStr, error);
      return null;
    }
  }

  parseConfidence(confidenceStr) {
    if (!confidenceStr) return 0.5; // Default confidence

    try {
      const num = parseFloat(confidenceStr);
      if (isNaN(num)) return 0.5;

      // Ensure confidence is between 0 and 1
      return Math.max(0, Math.min(1, num));
    } catch (error) {
      logger.warn("Error parsing confidence:", confidenceStr, error);
      return 0.5;
    }
  }

  async batchExtract(emailContents) {
    const results = [];

    // Process emails in smaller batches for extraction (more resource intensive)
    const batchSize = 3;

    for (let i = 0; i < emailContents.length; i += batchSize) {
      const batch = emailContents.slice(i, i + batchSize);
      const batchPromises = batch.map((content) =>
        this.extractTransaction(content)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            results.push(result.value);
          } else {
            logger.error(
              `Batch extraction failed for email ${i + index}:`,
              result.reason
            );
            results.push({
              amount: null,
              currency: null,
              date: null,
              type: null,
              merchant: null,
              confidence: 0,
              error: result.reason?.message || "Batch processing failed",
            });
          }
        });
      } catch (batchError) {
        logger.error("Batch extraction error:", batchError);
        // Add error results for the entire batch
        batch.forEach(() => {
          results.push({
            amount: null,
            currency: null,
            date: null,
            type: null,
            merchant: null,
            confidence: 0,
            error: "Batch processing failed",
          });
        });
      }

      // Add longer delay between batches for extraction
      if (i + batchSize < emailContents.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  async healthCheck() {
    try {
      if (!this.serviceUrl) {
        return { status: "error", message: "Service URL not configured" };
      }

      const response = await axios.get(`${this.serviceUrl}/health`, {
        timeout: 5000,
      });

      return {
        status: "healthy",
        responseTime: response.headers["response-time"],
        serviceUrl: this.serviceUrl,
      };
    } catch (error) {
      logger.error("Extraction service health check failed:", error);
      return {
        status: "error",
        message: error.message,
        serviceUrl: this.serviceUrl,
      };
    }
  }
}

module.exports = new ExtractionService();
