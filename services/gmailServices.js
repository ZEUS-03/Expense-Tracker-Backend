const { google } = require("googleapis");
const { setCredentials, refreshAccessToken } = require("../config/oAuth");
const parseEmailBody = require("../utils/emailParser");
const logger = require("../utils/logger");

class GmailService {
  constructor() {
    this.gmail = null;
  }

  async authenticate(user) {
    // Check if access token needs refresh
    const oauth2Client = setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
    try {
      // Try to refresh token if needed
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update user's access token if refreshed
        if (credentials.access_token !== user.accessToken) {
          user.accessToken = credentials.access_token;
          await user.save();
        }

        oauth2Client.setCredentials(credentials);
      } catch (refreshError) {
        logger.warn(
          "Token refresh failed, using existing token:",
          refreshError
        );
        oauth2Client.setCredentials({
          access_token: user.accessToken,
          refresh_token: user.refreshToken,
        });
      }

      this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
      return this.gmail;
    } catch (error) {
      logger.error("Gmail authentication failed:", error);
      throw new Error("Failed to authenticate with Gmail API");
    }
  }

  async fetchEmails(user, maxResults = 50, syncAll = false) {
    try {
      await this.authenticate(user);

      const query = {
        userId: "me",
        maxResults: Math.min(maxResults, 500), // Gmail API limit
        q: syncAll ? "" : "newer_than:30d", // Default to last 30 days if not syncing all
      };

      // If not syncing all, add date filter based on last sync
      if (!syncAll && user.lastSyncDate) {
        const lastSyncTimestamp = Math.floor(
          user.lastSyncDate.getTime() / 1000
        );
        query.q = `after:${lastSyncTimestamp}`;
      }

      logger.info(
        `Fetching emails for user ${user.email} with query: ${query.q}`
      );

      // Get list of message IDs
      const response = await this.gmail.users.messages.list(query);
      const messages = response.data.messages || [];
      logger.info("Gmail API Request:", {
        maxResults: query.maxResults,
        syncAll,
        userEmail: user.email,
      });

      if (messages.length === 0) {
        logger.info(`No new emails found for user ${user.email}`);
        return [];
      }

      logger.info(
        `Found ${messages.length} emails to process for user ${user.email}`
      );

      // Fetch email details in batches to avoid rate limits
      const emails = [];
      const batchSize = 10;

      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        const batchPromises = batch.map((message) =>
          this.fetchEmailDetails(message.id)
        );

        try {
          const batchResults = await Promise.allSettled(batchPromises);

          batchResults.forEach((result, index) => {
            if (
              result.status === "fulfilled" &&
              result.value &&
              result.value.isTransactional
            ) {
              emails.push(result.value);
            } else {
              logger.error(
                `Failed to fetch email ${batch[index].id} or not transactional:`,
                result.reason
              );
            }
          });
        } catch (batchError) {
          logger.error("Batch processing error:", batchError);
        }

        // Add delay between batches to respect rate limits
        if (i + batchSize < messages.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      logger.info(
        `Successfully fetched ${emails.length} emails for user ${user.email}`
      );
      return emails;
    } catch (error) {
      logger.error(`Error fetching emails for user ${user.email}:`, error);
      throw error;
    }
  }

  async fetchEmailDetails(messageId) {
    try {
      const response = await this.gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const message = response.data;
      const headers = message.payload.headers;

      // Extract header information
      const getHeader = (name) => {
        const header = headers.find(
          (h) => h.name.toLowerCase() === name.toLowerCase()
        );
        return header ? header.value : "";
      };

      const subject = getHeader("Subject");
      const from = getHeader("From");
      const to = getHeader("To");
      const dateStr = getHeader("Date");

      // Parse email body
      const { body, bodyPlain, isTransactional } = await parseEmailBody(
        message.payload,
        subject,
        from
      );

      // Parse date
      let date = new Date();
      if (dateStr) {
        try {
          date = new Date(dateStr);
        } catch (dateError) {
          logger.warn(
            `Failed to parse date "${dateStr}" for email ${messageId}`
          );
        }
      }

      // Extract labels
      const labels = message.labelIds || [];

      // Get thread ID
      const threadId = message.threadId;

      return {
        id: messageId,
        threadId,
        subject: subject || "No Subject",
        from: from || "Unknown Sender",
        to: to || "",
        date,
        body: body || "",
        bodyPlain: bodyPlain || "",
        labels,
        isTransactional,
      };
    } catch (error) {
      logger.error(`Error fetching email details for ${messageId}:`, error);
      throw error;
    }
  }

  async searchEmails(user, query, maxResults = 50) {
    try {
      await this.authenticate(user);

      const response = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: Math.min(maxResults, 100),
      });

      const messages = response.data.messages || [];

      if (messages.length === 0) {
        return [];
      }

      // Fetch details for found messages
      const emails = [];
      for (const message of messages) {
        try {
          const emailDetails = await this.fetchEmailDetails(message.id);
          emails.push(emailDetails);
        } catch (error) {
          logger.error(`Error fetching searched email ${message.id}:`, error);
        }
      }

      return emails;
    } catch (error) {
      logger.error(`Error searching emails for user ${user.email}:`, error);
      throw error;
    }
  }

  async getProfile(user) {
    try {
      await this.authenticate(user);

      const response = await this.gmail.users.getProfile({
        userId: "me",
      });

      return {
        emailAddress: response.data.emailAddress,
        messagesTotal: response.data.messagesTotal,
        threadsTotal: response.data.threadsTotal,
        historyId: response.data.historyId,
      };
    } catch (error) {
      logger.error(
        `Error getting Gmail profile for user ${user.email}:`,
        error
      );
      throw error;
    }
  }

  async getLabels(user) {
    try {
      await this.authenticate(user);

      const response = await this.gmail.users.labels.list({
        userId: "me",
      });

      return response.data.labels || [];
    } catch (error) {
      logger.error(`Error getting Gmail labels for user ${user.email}:`, error);
      throw error;
    }
  }
}

module.exports = new GmailService();
