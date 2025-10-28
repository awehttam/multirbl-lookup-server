import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';
import { getRblServers } from './rbl-lookup.js';
import { lookupIpCached } from './rbl-lookup-cached.js';
import { getDatabase } from './cache-db.js';
import { logRblRequest, getClientIp, logInfo, logWarning } from './logger.js';
import { createHtmlInjectorMiddleware } from './html-injector.js';

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
app.get('/api/cache/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear cache endpoint
app.post('/api/cache/clear', (req, res) => {
  try {
    const { ip } = req.body;

    let deleted;
    if (ip) {
      // Clear cache for specific IP
      deleted = db.clearIp(ip);
      res.json({ success: true, message: `Cleared ${deleted} entries for IP ${ip}`, deleted });
    } else {
      // Clear all cache
      deleted = db.clearAll();
      res.json({ success: true, message: `Cleared ${deleted} entries`, deleted });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean expired cache entries endpoint
app.post('/api/cache/clean', (req, res) => {
  try {
    const deleted = db.cleanExpired();
    res.json({ success: true, message: `Cleaned ${deleted} expired entries`, deleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`RBL Lookup Server running on http://localhost:${PORT}`);
  console.log(`Web interface: http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/lookup`);
  console.log(`Cache enabled: SQLite database`);
  console.log(`Request logging enabled: logs/requests.log`);
  console.log(`Rate limiting: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_HOURS} hour(s)`);

  logInfo('RBL Lookup Server started', {
    port: PORT,
    rateLimit: {
      max: RATE_LIMIT_MAX,
      windowHours: RATE_LIMIT_WINDOW_HOURS
    }
  });

  // Clean expired cache entries every 5 minutes
  setInterval(() => {
    const deleted = db.cleanExpired();
    if (deleted > 0) {
      console.log(`Cleaned ${deleted} expired cache entries`);
    }
  }, 5 * 60 * 1000);
});
