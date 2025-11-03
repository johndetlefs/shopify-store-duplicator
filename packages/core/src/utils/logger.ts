/**
 * Structured logger with level-based filtering and environment-aware formatting.
 * - In CI/JSON mode: emits JSON lines for machine parsing
 * - In pretty mode: human-friendly colored output (local dev)
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  format?: "json" | "pretty";
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;
  private format: "json" | "pretty";

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || (process.env.LOG_LEVEL as LogLevel) || "info";
    this.format =
      options.format ||
      (process.env.LOG_FORMAT as "json" | "pretty") ||
      "pretty";
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  /**
   * Update the logger level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    meta?: Record<string, any>
  ): string {
    if (this.format === "json") {
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
      });
    }

    // Pretty format
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[36m", // Cyan
      info: "\x1b[32m", // Green
      warn: "\x1b[33m", // Yellow
      error: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const timestamp = new Date().toISOString();
    const prefix = `${colors[level]}[${level.toUpperCase()}]${reset}`;
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";

    return `${prefix} ${timestamp} ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  info(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  warn(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  error(message: string, meta?: Record<string, any>): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, meta));
    }
  }

  /**
   * Create a child logger with additional default metadata
   */
  child(defaultMeta: Record<string, any>): Logger {
    const childLogger = new Logger({ level: this.level, format: this.format });
    const originalDebug = childLogger.debug.bind(childLogger);
    const originalInfo = childLogger.info.bind(childLogger);
    const originalWarn = childLogger.warn.bind(childLogger);
    const originalError = childLogger.error.bind(childLogger);

    childLogger.debug = (msg, meta?) =>
      originalDebug(msg, { ...defaultMeta, ...meta });
    childLogger.info = (msg, meta?) =>
      originalInfo(msg, { ...defaultMeta, ...meta });
    childLogger.warn = (msg, meta?) =>
      originalWarn(msg, { ...defaultMeta, ...meta });
    childLogger.error = (msg, meta?) =>
      originalError(msg, { ...defaultMeta, ...meta });

    return childLogger;
  }
}

// Singleton instance
export const logger = new Logger();

// Export constructor for custom instances
export { Logger };
