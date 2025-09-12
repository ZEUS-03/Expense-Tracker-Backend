const axios = require("axios");
const logger = require("../utils/logger");

class ClassificationService {
  constructor() {
    this.serviceUrl = process.env.CLASSIFICATION_SERVICE_URL;
    this.timeout = 30000; // 30 seconds timeout
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
  }

  async classifyEmail(emailContent) {
    if (!this.serviceUrl) {
      throw new Error("Classification service URL not configured");
    }

    if (!emailContent || emailContent.trim().length === 0) {
      logger.warn("Empty email content provided for classification");
      return {
        isTransactional: false,
        confidence: 0,
        error: "Empty content",
      };
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        logger.info(
          `Classifying email (attempt ${attempt}/${this.retryAttempts})`
        );

        // Prepare the request payload
        const payload = {
          text: emailContent.substring(0, 10000), // Limit to first 10k characters
        };

        const response = await axios.post(this.serviceUrl, payload, {
          timeout: this.timeout,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "EmailTransactionBackend/1.0",
          },
        });

        // Handle different response formats from Hugging Face
        const result = this.parseClassificationResponse(response.data);

        logger.info(
          `Classification completed: ${
            result.isTransactional ? "Transactional" : "Non-transactional"
          } (confidence: ${result.confidence})`
        );

        return result;
      } catch (error) {
        logger.error(`Classification attempt ${attempt} failed:`, {
          error: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
        });

        // If this is the last attempt, throw the error
        if (attempt === this.retryAttempts) {
          return {
            isTransactional: false,
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

  parseClassificationResponse(responseData) {
    try {
      // Handle different Hugging Face response formats

      // Format 1: Direct prediction with label and score
      if (Array.isArray(responseData) && responseData.length > 0) {
        const prediction = responseData[0];

        if (prediction.label && typeof prediction.score === "number") {
          const isTransactional = this.isTransactionalLabel(prediction.label);
          return {
            isTransactional,
            confidence: prediction.score,
            rawResponse: responseData,
          };
        }
      }

      // Format 2: Object with prediction field
      if (responseData.prediction) {
        const isTransactional = this.isTransactionalLabel(
          responseData.prediction
        );
        return {
          isTransactional,
          confidence: responseData.confidence || responseData.score || 0.5,
          rawResponse: responseData,
        };
      }

      // Format 3: Object with label field
      if (responseData.label) {
        const isTransactional = this.isTransactionalLabel(responseData.label);
        return {
          isTransactional,
          confidence: responseData.confidence || responseData.score || 0.5,
          rawResponse: responseData,
        };
      }

      // Format 4: Binary classification result
      if (typeof responseData === "boolean") {
        return {
          isTransactional: responseData,
          confidence: 0.5, // Default confidence for boolean response
          rawResponse: responseData,
        };
      }

      // Format 5: Numeric score (assuming > 0.5 means transactional)
      if (typeof responseData === "number") {
        return {
          isTransactional: responseData > 0.5,
          confidence: Math.abs(responseData),
          rawResponse: responseData,
        };
      }

      logger.warn("Unknown classification response format:", responseData);
      return {
        isTransactional: false,
        confidence: 0,
        error: "Unknown response format",
        rawResponse: responseData,
      };
    } catch (error) {
      logger.error("Error parsing classification response:", error);
      return {
        isTransactional: false,
        confidence: 0,
        error: "Response parsing failed",
        rawResponse: responseData,
      };
    }
  }

  isTransactionalLabel(label) {
    if (!label || typeof label !== "string") {
      return false;
    }

    const transactionalKeywords = [
      "transactional",
      "transaction",
      "payment",
      "receipt",
      "invoice",
      "bill",
      "purchase",
      "order",
      "financial",
      "money",
      "charge",
      "paid",
      "refund",
      "1", // Sometimes models return '1' for transactional
      "true",
    ];

    const labelLower = label.toLowerCase();
    return transactionalKeywords.some((keyword) =>
      labelLower.includes(keyword)
    );
  }

  async batchClassify(emailContents) {
    const results = [];

    // Process emails in batches to avoid overwhelming the service
    const batchSize = 5;

    for (let i = 0; i < emailContents.length; i += batchSize) {
      const batch = emailContents.slice(i, i + batchSize);
      const batchPromises = batch.map((content) => this.classifyEmail(content));

      try {
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            results.push(result.value);
          } else {
            logger.error(
              `Batch classification failed for email ${i + index}:`,
              result.reason
            );
            results.push({
              isTransactional: false,
              confidence: 0,
              error: result.reason?.message || "Batch processing failed",
            });
          }
        });
      } catch (batchError) {
        logger.error("Batch classification error:", batchError);
        // Add error results for the entire batch
        batch.forEach(() => {
          results.push({
            isTransactional: false,
            confidence: 0,
            error: "Batch processing failed",
          });
        });
      }

      // Add delay between batches to respect rate limits
      if (i + batchSize < emailContents.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
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
      logger.error("Classification service health check failed:", error);
      return {
        status: "error",
        message: error.message,
        serviceUrl: this.serviceUrl,
      };
    }
  }
}

module.exports = new ClassificationService();
