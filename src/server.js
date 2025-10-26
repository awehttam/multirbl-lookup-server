import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRblServers } from './rbl-lookup.js';
import { lookupIpCached } from './rbl-lookup-cached.js';
import { getDatabase } from './cache-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = getDatabase();

// Middleware
app.use(express.json());
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
app.post('/api/lookup', async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP address is required' });
  }

  try {
    const results = await lookupIpCached(ip, db);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Server-Sent Events endpoint for real-time updates (with caching)
app.post('/api/lookup-stream', async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP address is required' });
  }

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

  // Clean expired cache entries every 5 minutes
  setInterval(() => {
    const deleted = db.cleanExpired();
    if (deleted > 0) {
      console.log(`Cleaned ${deleted} expired cache entries`);
    }
  }, 5 * 60 * 1000);
});
