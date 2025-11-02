import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import { getRblServers } from './rbl-lookup.js';
import { lookupIpCached } from './rbl-lookup-cached.js';
import { getDatabase } from './cache-db.js';
import { logRblRequest, getClientIp, logInfo, logWarning } from './logger.js';
import { createHtmlInjectorMiddleware } from './html-injector.js';
import { requireApiKey, generateApiKey, listApiKeys, revokeApiKey, deleteApiKey } from './auth-middleware.js';
import {
  getCustomRblConfig,
  checkCustomRbl,
  addCustomRblEntry,
  removeCustomRblEntry,
  updateCustomRblEntry,
  listCustomRblEntries,
  updateCustomRblConfig
} from './custom-rbl-lookup.js';
import { testConnection } from './db-postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting configuration
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '15', 10);
const RATE_LIMIT_WINDOW_HOURS = parseInt(process.env.RATE_LIMIT_WINDOW_HOURS || '1', 10);
const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;

// HTML injection configuration
const HEADER_HTML_FILE = process.env.HEADER_HTML_FILE || join(__dirname, '..', 'public_html', 'header.html');
const FOOTER_HTML_FILE = process.env.FOOTER_HTML_FILE || join(__dirname, '..', 'public_html', 'footer.html');

// Initialize database
const db = getDatabase();

// Rate limiter for RBL lookup endpoints
const lookupLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: {
    success: false,
    error: `Too many lookup requests. Maximum ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_HOURS} hour(s). Please try again later.`
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use client IP for rate limiting (works with proxies)
  keyGenerator: (req) => getClientIp(req),
  // Log rate limit violations
  handler: (req, res) => {
    const clientIp = getClientIp(req);
    logWarning('Rate limit exceeded', {
      clientIp,
      endpoint: req.path,
      userAgent: req.headers['user-agent']
    });
    res.status(429).json({
      success: false,
      error: `Too many lookup requests. Maximum ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_HOURS} hour(s). Please try again later.`,
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    });
  }
});

// Middleware
app.use(express.json());

// Create HTML injector
const htmlInjector = createHtmlInjectorMiddleware({
  headerFile: HEADER_HTML_FILE,
  footerFile: FOOTER_HTML_FILE,
  publicDir: join(__dirname, '..', 'public_html')
});

// Serve index.html with header/footer injection
app.get('/', htmlInjector, (req, res) => {
  res.sendFile(join(__dirname, '..', 'public_html', 'index.html'));
});

app.get('/index.html', htmlInjector, (req, res) => {
  res.sendFile(join(__dirname, '..', 'public_html', 'index.html'));
});

// Serve other static files normally
app.use(express.static(join(__dirname, '..', 'public_html')));

// API endpoint to get list of RBL servers
app.get('/api/rbl-servers', async (req, res) => {
  try {
    const servers = await getRblServers();
    res.json({ success: true, servers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint for RBL lookup (with caching)
app.post('/api/lookup', lookupLimiter, async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP address is required' });
  }

  // Log the request
  const clientIp = getClientIp(req);
  const userAgent = req.headers['user-agent'];
  logRblRequest(clientIp, ip, userAgent);

  try {
    const results = await lookupIpCached(ip, db);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Server-Sent Events endpoint for real-time updates (with caching)
app.post('/api/lookup-stream', lookupLimiter, async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP address is required' });
  }

  // Log the request
  const clientIp = getClientIp(req);
  const userAgent = req.headers['user-agent'];
  logRblRequest(clientIp, ip, userAgent);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let resultsSent = 0;

    await lookupIpCached(ip, db, (result, current, total) => {
      // Send each result as it comes in
      res.write(`data: ${JSON.stringify({
        type: 'result',
        result,
        progress: {
          current,
          total,
          percentage: Math.round((current / total) * 100)
        }
      })}\n\n`);
      resultsSent++;
    });

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

// Cache statistics endpoint
app.get('/api/cache/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear cache endpoint
app.post('/api/cache/clear', async (req, res) => {
  try {
    const { ip } = req.body;

    let deleted;
    if (ip) {
      // Clear cache for specific IP
      deleted = await db.clearIp(ip);
      res.json({ success: true, message: `Cleared ${deleted} entries for IP ${ip}`, deleted });
    } else {
      // Clear all cache
      deleted = await db.clearAll();
      res.json({ success: true, message: `Cleared ${deleted} entries`, deleted });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean expired cache entries endpoint
app.post('/api/cache/clean', async (req, res) => {
  try {
    const deleted = await db.cleanExpired();
    res.json({ success: true, message: `Cleaned ${deleted} expired entries`, deleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// ============================================================================
// CUSTOM RBL ADMIN API ENDPOINTS (Require API Key Authentication)
// ============================================================================

// Custom RBL Configuration
app.get('/api/admin/custom-rbl/config', requireApiKey, async (req, res) => {
  try {
    const config = await getCustomRblConfig();
    if (!config) {
      return res.status(404).json({ success: false, error: 'Custom RBL not configured' });
    }
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/custom-rbl/config', requireApiKey, async (req, res) => {
  try {
    const { zoneName, description, enabled } = req.body;
    const result = await updateCustomRblConfig({ zoneName, description, enabled });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Custom RBL Entries Management
app.get('/api/admin/custom-rbl/entries', requireApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const listedOnly = req.query.listedOnly !== 'false';

    const result = await listCustomRblEntries({ limit, offset, listedOnly });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/custom-rbl/entries', requireApiKey, async (req, res) => {
  try {
    const { network, reason } = req.body;

    if (!network) {
      return res.status(400).json({ success: false, error: 'Network (CIDR) is required' });
    }

    const addedBy = req.apiKey.description || req.apiKey.keyPrefix;
    const result = await addCustomRblEntry(network, reason, addedBy);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/custom-rbl/entries/:id', requireApiKey, async (req, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const result = await removeCustomRblEntry(entryId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/admin/custom-rbl/entries/:id', requireApiKey, async (req, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const { reason, listed } = req.body;

    const result = await updateCustomRblEntry(entryId, { reason, listed });

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Custom RBL Lookup (Public API - Test endpoint)
app.post('/api/custom-rbl/check', async (req, res) => {
  try {
    const { ip } = req.body;

    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address is required' });
    }

    const result = await checkCustomRbl(ip);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Key Management
app.post('/api/admin/api-keys', requireApiKey, async (req, res) => {
  try {
    const { description } = req.body;
    const result = await generateApiKey(description);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.status(201).json({
      success: true,
      message: 'API key generated successfully. Save this key - it will not be shown again!',
      apiKey: result.apiKey,
      keyId: result.keyId,
      keyPrefix: result.keyPrefix,
      description: result.description,
      createdAt: result.createdAt
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/api-keys', requireApiKey, async (req, res) => {
  try {
    const result = await listApiKeys();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/api-keys/:id', requireApiKey, async (req, res) => {
  try {
    const keyId = parseInt(req.params.id);
    const result = await revokeApiKey(keyId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({ success: true, message: 'API key revoked successfully', revokedId: result.revokedId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// END CUSTOM RBL ADMIN API ENDPOINTS
// ============================================================================

// Start server
app.listen(PORT, async () => {
  console.log(`RBL Lookup Server running on http://localhost:${PORT}`);
  console.log(`Web interface: http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/lookup`);
  console.log(`Cache enabled: PostgreSQL database`);
  console.log(`Request logging enabled: logs/requests.log`);
  console.log(`Rate limiting: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_HOURS} hour(s)`);

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('WARNING: PostgreSQL connection failed. Server may not function correctly.');
  }

  // Display custom RBL configuration
  const customRblConfig = await getCustomRblConfig();
  if (customRblConfig) {
    console.log(`Custom RBL: ${customRblConfig.zone_name} (${customRblConfig.enabled ? 'enabled' : 'disabled'})`);
  }

  logInfo('RBL Lookup Server started', {
    port: PORT,
    rateLimit: {
      max: RATE_LIMIT_MAX,
      windowHours: RATE_LIMIT_WINDOW_HOURS
    },
    database: dbConnected ? 'connected' : 'disconnected'
  });

  // Clean expired cache entries every 5 minutes
  setInterval(async () => {
    const deleted = await db.cleanExpired();
    if (deleted > 0) {
      console.log(`Cleaned ${deleted} expired cache entries`);
    }
  }, 5 * 60 * 1000);
});
