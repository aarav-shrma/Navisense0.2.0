const { createLogger, format, transports } = require("winston");

exports.logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) =>
      `[${timestamp}] ${level.toUpperCase()} ${message}${stack ? "\n" + stack : ""}`
    )
  ),
  transports: [new transports.Console()],
});
