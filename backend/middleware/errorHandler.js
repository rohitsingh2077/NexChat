// Centralized error handler: logs the real error server-side, but only ever
// sends the client a fixed, safe shape - never the raw error object/message.
const errorHandler = (err, req, res, next) => {
  console.error(err);

  const statusCode = err.statusCode || 500;
  const message = err.statusCode
    ? err.message
    : "Something went wrong. Please try again.";

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
