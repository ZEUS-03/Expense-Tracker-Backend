const classificationService = require("../services/classificationService");
const logger = require("./logger");
const { convert } = require("html-to-text");

/**
 * Decodes base64 encoded string to UTF-8 text
 * @param {string} base64String - The base64 encoded string
 * @returns {string} - Decoded UTF-8 text
 */
function decodeBase64(base64String) {
  try {
    // Replace URL-safe characters back to standard base64
    const normalized = base64String.replace(/-/g, "+").replace(/_/g, "/");

    // Decode base64 to buffer then convert to UTF-8 string
    return Buffer.from(normalized, "base64").toString("utf-8");
  } catch (error) {
    logger.error("Base64 decode error:", error);
    return "";
  }
}

// Utility function to clean text
function cleanText(text) {
  return text
    .replace(/\[\/?[^\]]+\]/g, "") // Remove [...] and [/...] patterns
    .replace(/https?:\/\/[^\s\n]+/g, "") // Remove URLs
    .replace(/[^\S\r\n]+/g, " ") // Replace multiple spaces with single space
    .replace(/\n{3,}/g, "\n\n") // Replace multiple newlines with double newline
    .replace(/[\u0591-\u05C7\u200B-\u200F\u202A-\u202E]/g, "") // Remove invisible chars
    .trim();
}

// Modify the convert options
const htmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: "img", format: "skip" },
    { selector: "a", options: { ignoreHref: true } },
    { selector: "style", format: "skip" },
    { selector: "script", format: "skip" },
  ],
  preserveNewlines: true,
  singleNewLineParagraphs: true,
};

/**
 * Parse Gmail message payload to extract body content
 * @param {Object} payload - Gmail message payload
 * @returns {Object} - Object containing body and bodyPlain
 */
async function parseEmailBody(payload, subject, from) {
  let body = "";
  let bodyPlain = "";
  let classification = null;

  try {
    if (payload.body && payload.body.data) {
      const decodedBody = decodeBase64(payload.body.data);
      if (payload.mimeType === "text/plain") {
        bodyPlain = cleanText(decodedBody);
        body = bodyPlain;
      } else {
        body = decodedBody;
        bodyPlain = cleanText(convert(decodedBody, htmlToTextOptions));
      }
    } else if (payload.parts && payload.parts.length > 0) {
      const { htmlBody, plainBody } = extractFromParts(payload.parts);
      body =
        cleanText(convert(htmlBody, htmlToTextOptions)) ||
        cleanText(convert(plainBody, htmlToTextOptions)) ||
        "";
      bodyPlain =
        cleanText(plainBody) ||
        cleanText(convert(htmlBody, htmlToTextOptions)) ||
        "";
    }
    // Fallback: try to extract from any nested structure
    if (!body && !bodyPlain) {
      const extracted = extractBodyRecursive(payload);
      body =
        cleanText(convert(extracted.html, htmlToTextOptions)) ||
        cleanText(convert(extracted.plain, htmlToTextOptions)) ||
        "";
      bodyPlain =
        cleanText(extracted.plain) ||
        cleanText(convert(extracted.html, htmlToTextOptions)) ||
        "";
    }

    classification = await classificationService.classifyEmail({
      body: bodyPlain || body,
      subject,
      sender: from,
    });
  } catch (error) {
    logger.error("Error parsing email body:", error);
  }

  return {
    body: body.trim(),
    bodyPlain: bodyPlain.trim(),
    isTransactional: classification,
  };
}

/**
 * Recursively extract body content from Gmail payload parts
 * @param {Array} parts - Gmail message parts
 * @returns {Object} - Object containing htmlBody and plainBody
 */
function extractFromParts(parts) {
  let htmlBody = "";
  let plainBody = "";

  for (const part of parts) {
    const mimeType = part.mimeType;

    if (mimeType === "text/plain" && part.body && part.body.data) {
      plainBody += decodeBase64(part.body.data);
    } else if (mimeType === "text/html" && part.body && part.body.data) {
      htmlBody += decodeBase64(part.body.data);
    } else if (part.parts && part.parts.length > 0) {
      // Recursive call for nested parts
      const nested = extractFromParts(part.parts);
      if (nested.plainBody) plainBody += nested.plainBody;
      if (nested.htmlBody) htmlBody += nested.htmlBody;
    }
  }

  return { htmlBody, plainBody };
}

module.exports = parseEmailBody;
