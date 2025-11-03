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

/**
 * Middleware to inject custom header and footer HTML into the index.html
 * Header HTML is inserted right after </head>
 * Footer HTML is inserted right before </body>
 */
export function createHtmlInjectorMiddleware(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, '..', 'public_html');
  const headerFile = options.headerFile || path.join(publicDir, 'header.html');
  const footerFile = options.footerFile || path.join(publicDir, 'footer.html');

  // Cache for HTML content
  let headerHtml = '';
  let footerHtml = '';
  let lastHeaderCheck = 0;
  let lastFooterCheck = 0;
  const CACHE_TTL = 60000; // 1 minute cache

  /**
   * Load header HTML if it exists
   */
  function loadHeaderHtml() {
    const now = Date.now();
    if (now - lastHeaderCheck < CACHE_TTL) {
      return headerHtml;
    }

    lastHeaderCheck = now;
    try {
      if (fs.existsSync(headerFile)) {
        headerHtml = fs.readFileSync(headerFile, 'utf8');
      } else {
        headerHtml = '';
      }
    } catch (error) {
      console.error('Error loading header.html:', error.message);
      headerHtml = '';
    }
    return headerHtml;
  }

  /**
   * Load footer HTML if it exists
   */
  function loadFooterHtml() {
    const now = Date.now();
    if (now - lastFooterCheck < CACHE_TTL) {
      return footerHtml;
    }

    lastFooterCheck = now;
    try {
      if (fs.existsSync(footerFile)) {
        footerHtml = fs.readFileSync(footerFile, 'utf8');
      } else {
        footerHtml = '';
      }
    } catch (error) {
      console.error('Error loading footer.html:', error.message);
      footerHtml = '';
    }
    return footerHtml;
  }

  // Return middleware function
  return function(req, res, next) {
    // Only process index.html requests
    if (req.path !== '/' && req.path !== '/index.html') {
      return next();
    }

    // Flag to prevent double injection
    let injectionDone = false;

    // Intercept the sendFile function for static files
    const originalSendFile = res.sendFile;
    res.sendFile = function(path, options, callback) {
      // Read the file
      fs.readFile(path, 'utf8', (err, body) => {
        if (err) {
          return originalSendFile.call(res, path, options, callback);
        }

        // Only process HTML responses
        if (body.includes('</head>') && body.includes('</body>')) {
          const header = loadHeaderHtml();
          const footer = loadFooterHtml();

          // Inject header after </head>
          if (header) {
            body = body.replace('</head>', '</head>\n' + header);
          }

          // Inject footer before </body>
          if (footer) {
            body = body.replace('</body>', footer + '\n</body>');
          }

          injectionDone = true;
        }

        // Send the modified HTML (this will call the overridden send, but injection is flagged as done)
        res.type('html').send(body);
      });
    };

    // Also override send for non-static responses
    const originalSend = res.send;
    res.send = function(body) {
      // Only process HTML responses if injection hasn't been done yet
      if (!injectionDone && typeof body === 'string' && body.includes('</head>') && body.includes('</body>')) {
        const header = loadHeaderHtml();
        const footer = loadFooterHtml();

        // Inject header after </head>
        if (header) {
          body = body.replace('</head>', '</head>\n' + header);
        }

        // Inject footer before </body>
        if (footer) {
          body = body.replace('</body>', footer + '\n</body>');
        }
      }

      // Call the original send with modified body
      originalSend.call(this, body);
    };

    next();
  };
}
