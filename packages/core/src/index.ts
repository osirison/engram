/**
 * ENGRAM Core Package
 * Core utilities and types for the ENGRAM memory system
 */

export const VERSION = '0.1.0';

export function getVersion(): string {
  return VERSION;
}

// Logging
export { LoggingModule } from './logging/logging.module';
