# Multi-RBL Lookup Tool

A comprehensive RBL (Real-time Blackhole List) lookup tool with web interface, DNS server, and command-line capabilities.

## Features

- **DNS Server**: RFC-compliant DNS server with intelligent SQLite caching
- **Multi-RBL Lookup**: Query all RBLs at once via DNS with 250ms timeout
- **Web Interface**: Modern, responsive web UI with real-time updates
- **CLI Tool**: PHP command-line tool with formatted table output
- **Smart Caching**: TTL-based caching in SQLite database
- **Concurrent Queries**: Check 40+ RBL servers simultaneously
- **Fast Performance**: Cache hits ~1ms, concurrent DNS lookups
- **Color-Coded Results**: Easy-to-read status indicators
- **Filterable Results**: View all, listed only, clean only, or errors only

## Project Structure

```
multirbl-lookup/
├── src/
│   ├── rbl-lookup.js          # Core RBL lookup logic
│   ├── rbl-lookup-cached.js   # Cached RBL lookups with TTL
│   ├── cache-db.js            # SQLite cache manager
│   ├── dns-server.js          # DNS server implementation
│   ├── start-dns-server.js    # DNS server CLI
│   ├── server.js              # Express API server
│   └── logger.js              # Request logging utility
├── public_html/
│   ├── index.html             # Web interface
│   ├── styles.css             # Styling
│   └── app.js                 # Frontend JavaScript
├── etc/
│   └── rbl-servers.json       # 40+ RBL server configurations
├── data/
│   └── rbl-cache.db           # SQLite cache (auto-created)
├── logs/
│   └── requests.log           # Request logs (auto-created)
├── rbl-cli.php                # PHP command-line tool
└── package.json               # Node.js dependencies
```

## Installation

### Prerequisites

- Node.js (v14 or higher)
- PHP (v7.4 or higher) with curl extension (for CLI tool)

### Setup

1. Install Node.js dependencies:
```bash
npm install
```

2. Start the API server:
```bash
npm start
```

The server will start on http://localhost:3000

### Configuration

The web server can be configured using environment variables:

**PORT** - Server port (default: 3000)
```bash
PORT=8080 npm start
```

**RATE_LIMIT_MAX** - Maximum number of lookup requests per time window (default: 15)
```bash
RATE_LIMIT_MAX=20 npm start
```

**RATE_LIMIT_WINDOW_HOURS** - Rate limit time window in hours (default: 1)
```bash
RATE_LIMIT_WINDOW_HOURS=2 npm start
```

**HEADER_HTML_FILE** - Path to custom header HTML file (default: public_html/header.html)
```bash
HEADER_HTML_FILE=/path/to/custom/header.html npm start
```

**FOOTER_HTML_FILE** - Path to custom footer HTML file (default: public_html/footer.html)
```bash
FOOTER_HTML_FILE=/path/to/custom/footer.html npm start
```

**Multiple environment variables:**
```bash
# Linux/macOS
PORT=8080 RATE_LIMIT_MAX=20 RATE_LIMIT_WINDOW_HOURS=2 npm start

# Windows (PowerShell)
$env:PORT=8080; $env:RATE_LIMIT_MAX=20; $env:RATE_LIMIT_WINDOW_HOURS=2; npm start
```

Or set them permanently in your environment:
```bash
# Linux/macOS
export PORT=8080
export RATE_LIMIT_MAX=20
export RATE_LIMIT_WINDOW_HOURS=2
npm start

# Windows (Command Prompt)
set PORT=8080
set RATE_LIMIT_MAX=20
set RATE_LIMIT_WINDOW_HOURS=2
npm start

# Windows (PowerShell)
$env:PORT=8080
$env:RATE_LIMIT_MAX=20
$env:RATE_LIMIT_WINDOW_HOURS=2
npm start
```

## Custom HTML Header and Footer

You can inject custom HTML into the web interface to add branding, analytics, banners, or custom styling.

### How It Works

- **Header HTML** is inserted immediately after the `</head>` tag
- **Footer HTML** is inserted immediately before the `</body>` tag
- Changes are cached for 1 minute for performance
- Files are optional - if they don't exist, nothing is injected

### Setup

1. **Copy the example files:**
```bash
cp public_html/header.html.example public_html/header.html
cp public_html/footer.html.example public_html/footer.html
```

2. **Edit the files with your custom HTML:**
```bash
# Edit header.html
nano public_html/header.html

# Edit footer.html
nano public_html/footer.html
```

3. **Restart the server** (or wait up to 1 minute for cache refresh)

### Example Uses

**Custom banner (header.html):**
```html
<div style="background: #f0f0f0; padding: 10px; text-align: center;">
    <strong>Notice:</strong> This is a demonstration server
</div>
```

**Analytics tracking (footer.html):**
```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

**Custom footer (footer.html):**
```html
<div style="text-align: center; padding: 20px; color: #666;">
    <p>&copy; 2025 Your Organization | <a href="/privacy">Privacy Policy</a></p>
</div>
```

**Custom CSS (header.html):**
```html
<style>
  body {
    font-family: 'Your Custom Font', sans-serif;
  }
  .container {
    max-width: 1400px;
  }
</style>
```

### Custom File Locations

You can specify custom file paths using environment variables:

```bash
HEADER_HTML_FILE=/etc/multirbl/custom-header.html npm start
FOOTER_HTML_FILE=/etc/multirbl/custom-footer.html npm start
```

### Notes

- Header and footer files are in `.gitignore` (your customizations won't be committed)
- Example files (`.example` extension) are tracked in git for reference
- HTML is injected server-side on every request
- No restart needed - changes take effect within 1 minute (cache TTL)
- Both files are optional - the server works fine if they don't exist

## Usage

### DNS Server

Start the DNS server with intelligent caching:

```bash
npm run dns-server
```

**Options:**
```bash
node src/start-dns-server.js [options]

Options:
  --port=<port>              DNS server port (default: 8053)
  --host=<host>              Bind address (default: 0.0.0.0)
  --upstream=<dns>           Upstream DNS for non-RBL queries (default: 8.8.8.8)
  --multi-rbl-domain=<dom>   Domain for multi-RBL lookups (default: multi-rbl.example.com)
  --stats                    Show cache statistics
  --clear-cache              Clear all cached entries
```

**Testing Single RBL Lookups:**

Using `dig`:
```bash
dig @localhost -p 8053 2.0.0.127.zen.spamhaus.org
```

Using `nslookup`:
```bash
nslookup 2.0.0.127.zen.spamhaus.org localhost -port=8053
```

**Testing Multi-RBL Lookups (NEW):**

The DNS server supports querying an IP against all configured RBLs at once. This feature:
- Checks the IP against all 40+ RBL servers concurrently
- Returns results within 250ms (hard timeout)
- Provides aggregate results via DNS A and TXT records
- Uses the same caching system for instant responses

Query an IP across all RBLs:
```bash
# A record - returns 127.0.0.2 if listed on any RBL
dig @localhost -p 8053 127.0.0.2.multi-rbl.example.com

# TXT records - shows detailed results
dig @localhost -p 8053 127.0.0.2.multi-rbl.example.com TXT

# Example TXT output:
# "Listed on 3/45 RBLs (45/50 checked in 180ms)"
# "Spamhaus ZEN: LISTED"
# "Barracuda: LISTED"
# "SpamCop: LISTED"
```

Using `nslookup`:
```bash
nslookup 127.0.0.2.multi-rbl.example.com localhost -port=8053
```

Custom multi-RBL domain:
```bash
node src/start-dns-server.js --multi-rbl-domain=check.example.org
dig @localhost -p 8053 8.8.8.8.check.example.org TXT
```

**Cache Management:**

View statistics:
```bash
npm run dns-stats
```

Clear cache:
```bash
npm run dns-clear-cache
```

### Web Interface

The web interface now uses the same caching system as the DNS server for improved performance.

1. Open your browser to http://localhost:3000
2. Enter an IPv4 address (e.g., 8.8.8.8)
3. Click "Lookup" to check the IP against all RBL servers
4. View results in a color-coded table with filtering options
5. Results show cache hit/miss statistics

**New Cache API Endpoints:**
- `GET /api/cache/stats` - View cache statistics
- `POST /api/cache/clear` - Clear all cache or specific IP
- `POST /api/cache/clean` - Clean expired entries

### Command Line Interface

The PHP CLI tool queries the API server and displays results in a formatted text table.

#### Basic Usage

**Linux/macOS/Unix:**
```bash
php rbl-cli.php <ip-address>
```

**Windows:**
```cmd
rbl-cli.cmd <ip-address>
```

Or use PHP directly on any platform:
```bash
php rbl-cli.php <ip-address>
```

Example:
```bash
php rbl-cli.php 8.8.8.8
# Windows: rbl-cli.cmd 8.8.8.8
```

#### Command Line Options

```
--host=<host>       API server host (default: localhost)
--port=<port>       API server port (default: 3000)
--filter=<type>     Filter results: all, listed, clean, error (default: all)
--tls               Use HTTPS instead of HTTP
--no-verify-ssl     Disable SSL certificate verification (for self-signed certs)
--no-color          Disable colored output
--json              Output raw JSON instead of table
--help, -h          Show help message
```

#### Configuration File

Settings can be stored in `~/.rbl-cli.rc` (INI format). Command-line options override config file settings.

**Create config file:**
```bash
cat > ~/.rbl-cli.rc << 'EOF'
; RBL CLI Configuration
host = localhost
port = 3000
filter = all
no-color = false
json = false
EOF
```

**Example config file** (`.rbl-cli.rc.example`):
```ini
; RBL CLI Configuration File
; Command-line options will override these settings

; API server host (default: localhost)
host = localhost

; API server port (default: 3000)
port = 3000

; Filter results: all, listed, clean, error (default: all)
filter = all

; Use HTTPS instead of HTTP (default: false)
tls = false

; Verify SSL certificates (default: true)
; Set to false for self-signed certificates (INSECURE - testing only!)
verify-ssl = true

; Disable colored output (default: false)
no-color = false

; Output JSON instead of table (default: false)
json = false
```

**SSL Certificate Issues (Windows):**

If you encounter SSL certificate errors on Windows, you have two options:

1. **Recommended:** Disable SSL verification for self-signed certificates:
   ```bash
   php rbl-cli.php 8.8.8.8 --tls --no-verify-ssl
   ```
   Or in config file: `verify-ssl = false`

2. **Production:** Use proper SSL certificates from a trusted CA

**Note:** `--no-verify-ssl` should only be used for testing with self-signed certificates. Never use this in production!

#### Examples

Show only blacklisted results:
```bash
php rbl-cli.php 8.8.8.8 --filter=listed
```

Query a remote API server:
```bash
php rbl-cli.php 192.168.1.1 --host=example.com --port=8080
```

Get raw JSON output:
```bash
php rbl-cli.php 8.8.8.8 --json
```

Disable colors (useful for piping or logging):
```bash
php rbl-cli.php 8.8.8.8 --no-color > results.txt
```

## API Endpoints

### POST /api/lookup

Query an IP address against all RBL servers (with caching).

**Request:**
```json
{
  "ip": "8.8.8.8"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ip": "8.8.8.8",
    "timestamp": "2025-01-01T12:00:00.000Z",
    "totalChecked": 40,
    "listedCount": 0,
    "notListedCount": 38,
    "errorCount": 2,
    "cacheHits": 35,
    "cacheMisses": 5,
    "cacheHitRate": "87.5%",
    "results": [
      {
        "name": "Spamhaus ZEN",
        "host": "zen.spamhaus.org",
        "description": "Combined list including SBL, XBL, and PBL",
        "listed": false,
        "response": null,
        "responseTime": 0,
        "error": null,
        "ttl": 3600,
        "fromCache": true
      }
    ]
  }
}
```

### GET /api/cache/stats

Get cache statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "valid": 145,
    "expired": 5,
    "listed": 12,
    "notListed": 130,
    "errors": 3
  }
}
```

### POST /api/cache/clear

Clear cache entries.

**Request (clear all):**
```json
{}
```

**Request (clear specific IP):**
```json
{
  "ip": "8.8.8.8"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cleared 40 entries",
  "deleted": 40
}
```

### POST /api/cache/clean

Clean expired cache entries.

**Response:**
```json
{
  "success": true,
  "message": "Cleaned 5 expired entries",
  "deleted": 5
}
```

### GET /api/rbl-servers

Get the list of configured RBL servers.

### GET /api/health

Health check endpoint.

## Rate Limiting

To prevent server overload and abuse, the web server implements rate limiting on RBL lookup endpoints (`/api/lookup` and `/api/lookup-stream`).

### Default Limits

- **15 requests per hour** per client IP address
- Configurable via environment variables (see Configuration section)

### How It Works

- Rate limiting is applied **per client IP address**
- Works correctly behind proxies and load balancers (uses `X-Forwarded-For` header)
- When limit is exceeded, HTTP 429 (Too Many Requests) is returned
- Response includes `RateLimit-*` headers showing current usage
- Rate limit violations are logged automatically

### Rate Limit Headers

The server returns these headers with each lookup request:

```
RateLimit-Limit: 15           # Maximum requests allowed
RateLimit-Remaining: 12       # Requests remaining in window
RateLimit-Reset: 1698765432   # Unix timestamp when limit resets
```

### Rate Limit Exceeded Response

When the rate limit is exceeded, the API returns:

```json
{
  "success": false,
  "error": "Too many lookup requests. Maximum 15 requests per 1 hour(s). Please try again later.",
  "retryAfter": 3600
}
```

### Adjusting Rate Limits

See the Configuration section for environment variables to adjust rate limits:
- `RATE_LIMIT_MAX` - Maximum requests (default: 15)
- `RATE_LIMIT_WINDOW_HOURS` - Time window in hours (default: 1)

## Request Logging

All RBL lookup requests made through the web server are automatically logged with the following information:

- **Timestamp**: ISO 8601 format
- **Client IP Address**: Automatically detects the real client IP, even behind proxies
- **Target IP**: The IP address being checked against RBLs
- **User Agent**: Browser or client information

### Log File Location

Logs are stored in: `logs/requests.log`

### Log Format

```
[2025-10-28T02:26:56.814Z] [INFO] RBL lookup request {"clientIp":"203.0.113.45","targetIp":"8.8.8.8","userAgent":"curl/8.14.1"}
```

### Proxy Support

The logging system automatically detects the real client IP address when the server is behind a proxy or load balancer by checking these headers in order:

1. `X-Forwarded-For` (takes the first IP in the chain)
2. `X-Real-IP`
3. Direct connection IP (fallback)

### Log Rotation

- Log files automatically rotate when they reach 10MB
- Rotated files are timestamped: `requests-YYYY-MM-DDTHH-MM-SS.log`
- Old logs are preserved and can be archived or deleted manually

### Viewing Logs

View recent requests:
```bash
tail -f logs/requests.log
```

View last 100 requests:
```bash
tail -n 100 logs/requests.log
```

Search for specific IP:
```bash
grep "203.0.113.45" logs/requests.log
```

## RBL Servers Included

The tool checks against 40+ RBL servers including:

- **Spamhaus**: ZEN, SBL, XBL, PBL, DBL
- **SpamCop**: Blocking List
- **SORBS**: Multiple lists (DNSBL, SPAM, WEB, SMTP, SOCKS, etc.)
- **Barracuda**: Reputation Block List
- **UCEPROTECT**: Levels 1, 2, 3
- **PSBL**: Passive Spam Block List
- **CBL**: Composite Blocking List
- **DroneBL**: IRC spam drones
- **SpamRats**: Dynamic, NoPtr, Spam
- And many more...

## How the DNS Server Works

### Caching Architecture

```
┌─────────────────┐
│   DNS Client    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   DNS Server    │ (Port 8053)
│  (native-dns)   │
└────────┬────────┘
         │
         ├─────────► Multi-RBL Query?
         │           └─ Yes: Query all RBLs concurrently (250ms timeout)
         │
         ├─────────► Cache Check (SQLite)
         │           ├─ Hit: Return cached result (~1ms)
         │           └─ Miss: Continue to lookup
         │
         ├─────────► RBL Lookup (DNS query)
         │
         ├─────────► Cache Result (with TTL)
         │
         └─────────► DNS Response (A + TXT records)
```

### Multi-RBL Lookup Flow

When a query matches the multi-RBL domain (e.g., `127.0.0.2.multi-rbl.example.com`):

1. **Parse IP**: Extract IP address from query (e.g., `127.0.0.2`)
2. **Concurrent Lookups**: Query all 40+ RBL servers simultaneously using cached lookups
3. **250ms Timeout**: Hard timeout ensures response within 250ms
4. **Collect Results**: Gather all completed responses (cache hits return instantly)
5. **Build Response**:
   - **A Record**: Returns `127.0.0.2` if listed on any RBL, or NXDOMAIN if clean
   - **TXT Records**:
     - Summary: `"Listed on 3/45 RBLs (45/50 checked in 180ms)"`
     - Details: `"Spamhaus ZEN: LISTED"`, `"Barracuda: LISTED"`, etc.
6. **Cache Everything**: All individual RBL results are cached for future queries

### Cache Database Schema

```sql
CREATE TABLE rbl_cache (
  ip TEXT NOT NULL,
  rbl_host TEXT NOT NULL,
  listed INTEGER NOT NULL,
  response TEXT,
  error TEXT,
  ttl INTEGER NOT NULL,
  cached_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(ip, rbl_host)
);
```

### TTL Management

- **Listed IPs**: Uses TTL from DNS response (typically 300-3600 seconds)
- **Not Listed**: Cached for 1 hour (3600 seconds)
- **Errors**: Cached for 5 minutes (300 seconds)
- **Auto-cleanup**: Expired entries cleaned every 5 minutes

### Performance

- **Cache Hit**: ~1ms response time (99.7% faster than DNS lookup)
- **Cache Miss**: 100-5000ms (depends on RBL server)
- **Concurrent Lookups**: All RBL servers queried in parallel
- **Storage**: SQLite database in `data/rbl-cache.db`

### Shared Cache

Both the DNS server and web interface use the **same SQLite cache database**. This means:

- Queries via DNS server are cached for web interface
- Queries via web interface are cached for DNS server
- Cache is shared across all services
- Performance benefits apply to all query methods
- Single source of truth for all RBL lookups

Example workflow:
1. User queries DNS server: `dig @localhost -p 8053 2.0.0.127.zen.spamhaus.org`
2. Result is cached in database
3. Web interface query for `127.0.0.2` returns cached result instantly
4. Multi-RBL query uses all cached results: `dig @localhost -p 8053 127.0.0.2.multi-rbl.example.com TXT`
5. All subsequent queries (DNS, HTTP, or multi-RBL) use the cache

## Testing Tools

### test-dns.php

A PHP-based DNS testing tool that sends raw DNS queries and displays results including TXT records.

```bash
php test-dns.php
```

The script tests multiple query types:
- Single RBL lookups (e.g., `2.0.0.127.zen.spamhaus.org`)
- Multi-RBL lookups (e.g., `127.0.0.2.multi-rbl.example.com`)
- Regular domain lookups (forwarded to upstream DNS)

Output includes:
- DNS response codes (NOERROR, NXDOMAIN, etc.)
- A record IP addresses
- TXT record contents (useful for multi-RBL results)
- Response times and transaction details

Edit the `$test_queries` array in the script to customize test cases.

## Configuration

RBL servers are configured in `etc/rbl-servers.json`. Each entry contains:

```json
{
  "name": "Display Name",
  "host": "dnsbl.example.org",
  "description": "Description of this RBL"
}
```

You can add or remove RBL servers by editing this file.

## Development

### Run in development mode with auto-reload:

Web server:
```bash
npm run dev
```

DNS server:
```bash
npm run dns-server:dev
```

### Modify timeout settings

Edit `src/rbl-lookup.js` and change the timeout parameter in `lookupSingleRbl()` (default: 5000ms).

## Running as a Daemon

For production environments, you'll want to run the web server as a background daemon that starts automatically on system boot.

### Using PM2 (Recommended for all platforms)

PM2 is a production-grade process manager for Node.js applications that works on Linux, macOS, and Windows.

**Install PM2 globally:**
```bash
npm install -g pm2
```

**Start the web server:**
```bash
pm2 start src/server.js --name multirbl-web
```

**Start the DNS server:**
```bash
pm2 start src/start-dns-server.js --name multirbl-dns
```

**Useful PM2 commands:**
```bash
pm2 list                    # View all running processes
pm2 logs multirbl-web       # View logs for web server
pm2 logs multirbl-dns       # View logs for DNS server
pm2 restart multirbl-web    # Restart web server
pm2 stop multirbl-web       # Stop web server
pm2 delete multirbl-web     # Remove from PM2
pm2 monit                   # Monitor CPU and memory usage
```

**Auto-start on system boot:**
```bash
pm2 startup                 # Follow the displayed instructions
pm2 save                    # Save current process list
```

### Using systemd (Linux)

Create a systemd service file for the web server:

**1. Create service file:**
```bash
sudo nano /etc/systemd/system/multirbl-web.service
```

**2. Add the following content:**
```ini
[Unit]
Description=Multi-RBL Lookup Web Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/multirbl-lookup
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**3. Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable multirbl-web
sudo systemctl start multirbl-web
```

**4. Manage the service:**
```bash
sudo systemctl status multirbl-web    # Check status
sudo systemctl restart multirbl-web   # Restart
sudo systemctl stop multirbl-web      # Stop
sudo journalctl -u multirbl-web -f    # View logs
```

**For the DNS server, create a similar file at `/etc/systemd/system/multirbl-dns.service`:**
```ini
[Unit]
Description=Multi-RBL Lookup DNS Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/multirbl-lookup
ExecStart=/usr/bin/node src/start-dns-server.js --port=8053
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Using Windows Service (Windows)

Install `node-windows` to run as a Windows service:

**1. Install node-windows:**
```bash
npm install -g node-windows
```

**2. Create install script (`install-service.js`):**
```javascript
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'Multi-RBL Lookup Web',
  description: 'Multi-RBL Lookup Web Server',
  script: require('path').join(__dirname, 'src', 'server.js'),
  nodeOptions: ['--max_old_space_size=4096']
});

svc.on('install', function() {
  svc.start();
  console.log('Service installed and started');
});

svc.install();
```

**3. Run the install script as Administrator:**
```bash
node install-service.js
```

**4. Manage via Windows Services:**
- Open `services.msc`
- Find "Multi-RBL Lookup Web"
- Start/Stop/Restart as needed

### Using Docker (Cross-platform)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000 8053/udp

CMD ["node", "src/server.js"]
```

**Build and run:**
```bash
docker build -t multirbl-lookup .
docker run -d -p 3000:3000 -p 8053:8053/udp --name multirbl multirbl-lookup
```

**Using docker-compose (`docker-compose.yml`):**
```yaml
version: '3.8'
services:
  multirbl:
    build: .
    ports:
      - "3000:3000"
      - "8053:8053/udp"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Start with:
```bash
docker-compose up -d
```

### Using Cron with Auto-restart Script

For simple deployments, you can use cron to ensure the server stays running by checking and restarting it periodically.

**1. Create a startup/monitor script (`scripts/ensure-running.sh`):**
```bash
#!/bin/bash

# Configuration
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/server.pid"
LOG_FILE="$PROJECT_DIR/logs/server.log"
NODE_BIN="/usr/bin/node"

cd "$PROJECT_DIR"

# Create logs directory if it doesn't exist
mkdir -p logs

# Function to check if server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to start server
start_server() {
    echo "[$(date)] Starting Multi-RBL Lookup server..." >> "$LOG_FILE"
    nohup "$NODE_BIN" src/server.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[$(date)] Server started with PID $(cat $PID_FILE)" >> "$LOG_FILE"
}

# Check if server is running, start if not
if is_running; then
    echo "[$(date)] Server is running with PID $(cat $PID_FILE)" >> "$LOG_FILE"
else
    echo "[$(date)] Server is not running, starting..." >> "$LOG_FILE"
    start_server
fi
```

**2. Make the script executable:**
```bash
chmod +x scripts/ensure-running.sh
```

**3. Add to crontab:**
```bash
crontab -e
```

**Add one of these lines:**

Check every minute:
```cron
* * * * * /path/to/multirbl-lookup/scripts/ensure-running.sh
```

Check every 5 minutes:
```cron
*/5 * * * * /path/to/multirbl-lookup/scripts/ensure-running.sh
```

Start at system reboot:
```cron
@reboot /path/to/multirbl-lookup/scripts/ensure-running.sh
```

Combined (check every 5 minutes + start at reboot):
```cron
@reboot /path/to/multirbl-lookup/scripts/ensure-running.sh
*/5 * * * * /path/to/multirbl-lookup/scripts/ensure-running.sh
```

**4. Create manual control scripts:**

**Stop script (`scripts/stop-server.sh`):**
```bash
#!/bin/bash
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        echo "Server stopped (PID $PID)"
        rm "$PID_FILE"
    else
        echo "PID file exists but process not running"
        rm "$PID_FILE"
    fi
else
    echo "Server is not running (no PID file)"
fi
```

**Status script (`scripts/status-server.sh`):**
```bash
#!/bin/bash
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Server is running (PID $PID)"
        ps -p "$PID" -o pid,ppid,cmd,%mem,%cpu,etime
    else
        echo "PID file exists but process not running"
    fi
else
    echo "Server is not running (no PID file)"
fi
```

**Make them executable:**
```bash
chmod +x scripts/stop-server.sh scripts/status-server.sh
```

**5. View logs:**
```bash
tail -f logs/server.log
```

**Note:** This cron-based approach is simpler but less robust than PM2 or systemd. The server won't restart immediately on crashes (only when cron runs), and there's no built-in log rotation or advanced process management.

## Scripts

- `npm start` - Start web server (with caching)
- `npm run dev` - Start web server with auto-reload
- `npm run dns-server` - Start DNS server
- `npm run dns-server:dev` - Start DNS server with auto-reload
- `npm run dns-stats` - Show cache statistics
- `npm run dns-clear-cache` - Clear all cached entries
- `npm run test-cache` - Test cache functionality and performance

## License

MIT
