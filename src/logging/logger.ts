// ---------------------------------------------------------------------------
// Pino structured JSON logger factory.
// ---------------------------------------------------------------------------

import pino from "pino";
import type { LoggingConfig } from "../core/types.js";

/** Re-export pino's Logger type for convenience. */
export type Logger = pino.Logger;

/** Paths that should be redacted from log output to avoid leaking secrets. */
const SECRET_PATHS: string[] = [
  "*.clientSecret",
  "*.accessKey",
  "*.password",
  "*.apiKey",
  "req.headers.authorization",
];

/**
 * Create a configured pino logger instance.
 *
 * - JSON output (pino default)
 * - Secret redaction on sensitive key paths
 * - Base fields: `service` and `version`
 * - Optional pretty-print via `pino-pretty` transport for development
 */
export function createLogger(config: LoggingConfig): pino.Logger {
  const baseOptions: pino.LoggerOptions = {
    level: config.level,
    base: {
      service: "book-finder",
      version: process.env["APP_VERSION"] ?? "dev",
    },
    ...(config.redactSecrets
      ? {
          redact: {
            paths: SECRET_PATHS,
            censor: "[REDACTED]",
          },
        }
      : {}),
  };

  if (config.prettyPrint) {
    return pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino(baseOptions);
}
