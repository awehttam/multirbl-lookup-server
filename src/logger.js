/**
 * Multi-RBL Lookup Tool
 * Copyright (C) 2025 Matthew Asham
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', 'logs');
const REQUEST_LOG_FILE = path.join(LOG_DIR, 'requests.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format a log entry
 */
function formatLogEntry(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}\n`;
}

/**
 * Rotate log file if it exceeds max size
 */
function rotateLogIfNeeded(logFile) {
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size >= MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = logFile.replace('.log', `-${timestamp}.log`);
        fs.renameSync(logFile, rotatedFile);
        console.log(`Rotated log file to: ${rotatedFile}`);
      }
    }
  } catch (error) {
    console.error('Error rotating log file:', error);
  }
}

/**
 * Write to log file
 */
function writeLog(logFile, entry) {
  try {
    rotateLogIfNeeded(logFile);
    fs.appendFileSync(logFile, entry);
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

/**
 * Log an RBL lookup request
 */
export function logRblRequest(clientIp, targetIp, userAgent = null) {
  const message = `RBL lookup request`;
  const data = {
    clientIp,
    targetIp,
    userAgent
  };

  const entry = formatLogEntry('INFO', message, data);
  writeLog(REQUEST_LOG_FILE, entry);

  // Also log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`RBL Request: ${clientIp} -> ${targetIp}`);
  }
}

/**
 * Log general info message
 */
export function logInfo(message, data = {}) {
  const entry = formatLogEntry('INFO', message, data);
  writeLog(REQUEST_LOG_FILE, entry);
}

/**
 * Log warning message
 */
export function logWarning(message, data = {}) {
  const entry = formatLogEntry('WARN', message, data);
  writeLog(REQUEST_LOG_FILE, entry);
}

/**
 * Log error message
 */
export function logError(message, error = null, data = {}) {
  const errorData = {
    ...data,
    ...(error && {
      error: error.message,
      stack: error.stack
    })
  };

  const entry = formatLogEntry('ERROR', message, errorData);
  writeLog(REQUEST_LOG_FILE, entry);
}

/**
 * Get client IP address from request, handling proxies
 */
export function getClientIp(req) {
  // Check for common proxy headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return realIp;
  }

  // Fallback to direct connection IP
  return req.socket.remoteAddress || req.connection.remoteAddress || 'unknown';
}
