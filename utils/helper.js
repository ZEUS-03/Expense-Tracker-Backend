const parseDate = (dateStr) => {
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
};

module.exports = { parseDate };
