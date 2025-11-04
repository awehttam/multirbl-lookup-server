# Multi-RBL Lookup Tool

A comprehensive RBL (Real-time Blackhole List) lookup tool with web interface, DNS server, and command-line capabilities.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
  - [Migrating from SQLite to PostgreSQL](#migrating-from-sqlite-to-postgresql)
  - [Configuration](#configuration)
- [Custom HTML Header and Footer](#custom-html-header-and-footer)
- [Usage](#usage)
  - [DNS Server](#dns-server)
    - [Running DNS Server as a Daemon](#running-dns-server-as-a-daemon)
  - [Web Interface](#web-interface)
  - [Command Line Interface](#command-line-interface)
- [Custom RBL Management](#custom-rbl-management)
  - [Quick Start](#quick-start)
  - [Testing Custom RBL via DNS](#testing-custom-rbl-via-dns)
  - [Custom RBL API Endpoints](#custom-rbl-api-endpoints)
  - [CLI Commands Reference](#cli-commands-reference)
- [API Endpoints](#api-endpoints)
- [Rate Limiting](#rate-limiting)
- [Request Logging](#request-logging)
- [RBL Servers Included](#rbl-servers-included)
- [How the DNS Server Works](#how-the-dns-server-works)
- [Testing Tools](#testing-tools)
- [Development](#development)
- [Running as a Daemon](#running-as-a-daemon)
  - [Using PM2](#using-pm2-recommended-for-all-platforms)
  - [Using systemd](#using-systemd-linux)
  - [Using Windows Service](#using-windows-service-windows)
  - [Using Docker](#using-docker-cross-platform)
  - [Using Cron](#using-cron-with-auto-restart-script)
- [Scripts](#scripts)
- [License](#license)

## Features

- **DNS Server**: RFC-compliant DNS server with intelligent two-tier caching
- **Custom RBL**: Self-managed blocklist with CIDR range support (IPv4/IPv6)
- **Multi-RBL Lookup**: Query all RBLs at once via DNS with 250ms timeout
- **Multi-Zone Support**: Configure multiple DNS zones with different RBL sets for targeted checks
- **Web Interface**: Modern, responsive web UI with real-time updates
- **CLI Tool**: PHP command-line tool with formatted table output and custom RBL management
- **Two-Tier Caching**: Optional memcache (L1 ~0.1ms) + PostgreSQL (L2 ~1-5ms)
- **API Key Authentication**: Secure admin API for custom RBL management
- **Concurrent Queries**: Check 40+ RBL servers simultaneously
- **Fast Performance**: Sub-millisecond cache hits, concurrent DNS lookups, efficient CIDR matching
- **Color-Coded Results**: Easy-to-read status indicators
- **Filterable Results**: View all, listed only, clean only, or errors only

## Project Structure

```
multirbl-lookup/
├── src/
│   ├── rbl-lookup.js              # Core RBL lookup logic
│   ├── rbl-lookup-cached.js       # Cached RBL lookups with TTL
│   ├── cache-db.js                # Two-tier cache manager (memcache + PostgreSQL)
│   ├── memcache.js                # Memcache client wrapper (L1 cache)
│   ├── db-postgres.js             # PostgreSQL connection pool
│   ├── custom-rbl-lookup.js       # Custom RBL CIDR matching
│   ├── auth-middleware.js         # API key authentication
│   ├── dns-server.js              # DNS server implementation
│   ├── start-dns-server.js        # DNS server CLI
│   ├── server.js                  # Express API server
│   └── logger.js                  # Request logging utility
├── database/
│   ├── schema.sql                 # PostgreSQL schema
│   └── migrate.js                 # Database migration script
├── docs/
│   └── CUSTOM-RBL.md              # Custom RBL documentation
├── public_html/
│   ├── index.html                 # Web interface
│   ├── styles.css                 # Styling
│   └── app.js                     # Frontend JavaScript
├── etc/
│   ├── rbl-servers.json           # 40+ RBL server configurations
│   └── multi-rbl-zones.json       # Multi-RBL zone configurations (optional)
├── logs/
│   └── requests.log               # Request logs (auto-created)
├── rbl-cli.php                    # PHP CLI with custom RBL commands
├── .env.example                   # Environment configuration template
└── package.json                   # Node.js dependencies
```

## Installation

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- PHP (v7.4 or higher) with curl extension (for CLI tool)

### Setup

1. **Install PostgreSQL** (if not already installed):

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Windows:**
Download from [postgresql.org](https://www.postgresql.org/download/windows/)

2. **Create PostgreSQL database and user:**

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Run these commands in psql:
CREATE DATABASE multirbl;
CREATE USER multirbl WITH ENCRYPTED PASSWORD 'changeme';
GRANT ALL PRIVILEGES ON DATABASE multirbl TO multirbl;

# Exit psql
\q
```

3. **Install Node.js dependencies:**
```bash
npm install
```

4. **Configure environment variables:**

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your database credentials
nano .env
```

Update the following in `.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=multirbl
DB_USER=multirbl
DB_PASSWORD=changeme
```

5. **Run database migration:**

```bash
node database/migrate.js
```

You should see:
```
✓ Connected successfully
✓ Schema created successfully
✓ Migration completed successfully
```

6. **Start the API server:**
```bash
npm start
```

The server will start on http://localhost:3000

### Migrating from SQLite to PostgreSQL

If you have an existing installation using SQLite (`data/rbl-cache.db`), follow these steps to migrate:

#### Migration Steps

1. **Backup your existing SQLite database** (optional, for reference):
```bash
cp data/rbl-cache.db data/rbl-cache.db.backup
```

2. **Install PostgreSQL** (see Setup section above)

3. **Update dependencies:**
```bash
npm install pg bcrypt dotenv
```

4. **Configure PostgreSQL** (see Setup steps 2-5 above)

5. **Run the migration script:**
```bash
node database/migrate.js
```

6. **Test the server:**
```bash
npm start
```

7. **Verify caching is working:**
```bash
# Make a test request
curl -X POST http://localhost:3000/api/lookup \
  -H "Content-Type: application/json" \
  -d '{"ip": "8.8.8.8"}'

# Check cache stats
curl http://localhost:3000/api/cache/stats
```

#### What Changed

**Database:**
- SQLite → PostgreSQL
- File-based storage → Client-server database
- TEXT columns → Native INET/CIDR types
- Simple indexes → GiST indexes for IP matching

**Performance:**
- Similar or better cache performance
- Better concurrent query handling
- Native IPv6 support
- Efficient CIDR range matching

**New Features:**
- Custom RBL with CIDR support
- API key authentication
- Admin management endpoints
- IPv6 ready

#### Notes

- The old SQLite database file (`data/rbl-cache.db`) is no longer used and can be deleted
- All cache data starts fresh in PostgreSQL (no automatic data migration)
- API endpoints remain compatible (no client changes needed)
- DNS server functionality unchanged

### Optional: Memcache Performance Layer

For high-traffic deployments, you can add memcache as an L1 cache layer for even faster lookups.

#### Why Memcache?

The Multi-RBL Lookup tool implements a two-tier caching architecture:
- **L1 Cache (Memcache)**: Sub-millisecond lookups (~0.1ms) for hot data
- **L2 Cache (PostgreSQL)**: Persistent storage with reasonable performance (~1-5ms)

Without memcache, all cache lookups go directly to PostgreSQL. With memcache enabled, frequently accessed results are served from RAM, significantly reducing database load and improving response times.

#### Installation

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install memcached
sudo systemctl enable memcached
sudo systemctl start memcached
```

**macOS:**
```bash
brew install memcached
brew services start memcached
```

**Windows:**
Download from [memcached.org](https://memcached.org/) or use Docker:
```bash
docker run -d -p 11211:11211 --name memcached memcached
```

#### Configuration

1. **Enable memcache in `.env`:**

```env
MEMCACHE_ENABLED=true
MEMCACHE_SERVERS=localhost:11211
MEMCACHE_DEBUG=false
```

2. **Multiple servers (optional):**

For high availability, you can use multiple memcache servers:

```env
MEMCACHE_SERVERS=cache1.example.com:11211,cache2.example.com:11211,cache3.example.com:11211
```

3. **Restart the services:**

```bash
# If using PM2
pm2 restart multirbl-web
pm2 restart multirbl-dns

# If using systemd
sudo systemctl restart multirbl-web
sudo systemctl restart multirbl-dns

# If running directly
npm start
```

#### How It Works

The two-tier caching system works as follows:

1. **Cache Read** (getCached):
   - Check memcache first (L1) - ~0.1ms
   - If found, return result immediately
   - If not found, check PostgreSQL (L2) - ~1-5ms
   - If found in PostgreSQL, backfill memcache for future requests
   - Return result

2. **Cache Write** (cache):
   - Write to memcache (L1) - fire and forget, non-blocking
   - Write to PostgreSQL (L2) - persistent storage

3. **Cache Invalidation**:
   - Memcache entries expire based on TTL
   - PostgreSQL serves as authoritative source
   - Cache clear operations flush both layers

#### Performance Benefits

With memcache enabled, you can expect:

- **Cached lookups**: ~0.1ms (99.99% faster than DNS)
- **Database load**: Reduced by 80-95% for hot data
- **Throughput**: 10-100x improvement for repeated queries
- **Scalability**: Better handling of traffic spikes

#### Monitoring

Check if memcache is enabled:

```bash
# View startup logs
pm2 logs multirbl-web | grep Memcache

# Expected output when enabled:
# Memcache enabled: localhost:11211

# Expected output when disabled:
# Memcache disabled (set MEMCACHE_ENABLED=true to enable)
```

View cache statistics:

```bash
curl http://localhost:3000/api/cache/stats
```

Response will show cache hits from both layers:
```json
{
  "success": true,
  "stats": {
    "total": 1500,
    "valid": 1450,
    "expired": 50
  }
}
```

#### Troubleshooting

**Memcache not connecting:**
```bash
# Check if memcached is running
sudo systemctl status memcached    # Linux
brew services list                 # macOS
docker ps | grep memcached         # Docker

# Test connection manually
telnet localhost 11211
stats
quit
```

**Verify memcache is being used:**

Set `MEMCACHE_DEBUG=true` in `.env` to see memcache operations in the logs:

```bash
pm2 logs multirbl-web
```

You should see messages like:
```
[Memcache] Connected to localhost:11211
[Memcache] GET rbl:8.8.8.8:zen.spamhaus.org - HIT
[Memcache] SET rbl:1.1.1.1:zen.spamhaus.org - OK
```

**Clearing memcache:**

```bash
# Via API (clears both memcache and PostgreSQL)
curl -X POST http://localhost:3000/api/cache/clear

# Manually flush memcache
echo 'flush_all' | nc localhost 11211
```

#### Notes

- Memcache is **optional** - the system works fine without it
- Memcache does not persist data across restarts (by design)
- PostgreSQL always serves as the persistent L2 cache
- Both DNS server and web interface use the same memcache instance
- All cache operations gracefully degrade if memcache is unavailable

### Configuration

The server is configured using environment variables in `.env` file (copy from `.env.example`):

#### Database Configuration

```env
DB_HOST=localhost              # PostgreSQL host
DB_PORT=5432                   # PostgreSQL port
DB_NAME=multirbl               # Database name
DB_USER=multirbl               # Database user
DB_PASSWORD=changeme           # Database password
DB_POOL_MAX=20                 # Max connections in pool
DB_IDLE_TIMEOUT=30000          # Idle timeout (ms)
DB_CONNECT_TIMEOUT=2000        # Connection timeout (ms)
```

#### Memcache Configuration (Optional)

```env
MEMCACHE_ENABLED=false         # Enable memcache (default: false)
MEMCACHE_SERVERS=localhost:11211  # Memcache server(s)
MEMCACHE_DEBUG=false           # Enable debug logging (default: false)
```

#### Web Server Configuration

```env
PORT=3000                      # Server port (default: 3000)
RATE_LIMIT_MAX=15              # Max requests per window (default: 15)
RATE_LIMIT_WINDOW_HOURS=1      # Rate limit window in hours (default: 1)
HEADER_HTML_FILE=./public_html/header.html  # Custom header HTML
FOOTER_HTML_FILE=./public_html/footer.html  # Custom footer HTML
```

#### DNS Server Configuration

```env
DNS_SERVER_PORT=8053                        # DNS server port
DNS_SERVER_HOST=0.0.0.0                     # DNS bind address
DNS_UPSTREAM=8.8.8.8                        # Upstream DNS server
DNS_MULTI_RBL_DOMAIN=multi-rbl.example.com  # Multi-RBL domain
```

#### Custom RBL Configuration

```env
CUSTOM_RBL_ZONE=myrbl.example.com  # Custom RBL zone name (informational)
```

You can also set environment variables directly:

```bash
PORT=8080 npm start
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

Start the DNS server with caching (supports both UDP and TCP):

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

Using `dig` (UDP):
```bash
dig @localhost -p 8053 2.0.0.127.zen.spamhaus.org
```

Using `dig` (TCP):
```bash
dig @localhost -p 8053 +tcp 2.0.0.127.zen.spamhaus.org
```

Using `nslookup`:
```bash
nslookup 2.0.0.127.zen.spamhaus.org localhost -port=8053
```

**DNS Server Multi-RBL Lookups :**

The DNS server supports querying an IP against all configured RBLs at once. This feature:
- Checks the IP against all 40+ RBL servers concurrently
- Returns results within 250ms (hard timeout)
- Provides aggregate results via DNS A and TXT records
- Uses the same caching system for instant responses

Query an IP across all RBLs:
```bash
# A record - returns 127.0.0.2 if listed on any RBL
dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com

# TXT records - shows detailed results
dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com TXT

# Example TXT output:
# "Listed on 3/45 RBLs (45/50 checked in 180ms)"
# "Spamhaus ZEN: LISTED"
# "Barracuda: LISTED"
# "SpamCop: LISTED"
```

Using `nslookup`:
```bash
nslookup 2.0.0.127.multi-rbl.example.com localhost -port=8053
```

Custom multi-RBL domain:
```bash
node src/start-dns-server.js --multi-rbl-domain=check.example.org
dig @localhost -p 8053 8.8.8.8.check.example.org TXT
```

**Configuring Multiple Multi-RBL Zones:**

The DNS server supports multiple custom multi-RBL zones, each checking different sets of RBLs. This is configured via `etc/multi-rbl-zones.json`:

```json
{
  "zones": [
    {
      "domain": "multi-rbl.example.com",
      "description": "All RBLs (comprehensive check)",
      "rbls": "*"
    },
    {
      "domain": "major-rbls.example.com",
      "description": "Major/most reliable RBLs only",
      "rbls": [
        "zen.spamhaus.org",
        "sbl.spamhaus.org",
        "xbl.spamhaus.org",
        "pbl.spamhaus.org",
        "cbl.abuseat.org",
        "bl.spamcop.net",
        "psbl.surriel.com",
        "dnsbl.sorbs.net",
        "b.barracudacentral.org"
      ]
    },
    {
      "domain": "spamhaus.example.com",
      "description": "Spamhaus lists only",
      "rbls": [
        "zen.spamhaus.org",
        "sbl.spamhaus.org",
        "xbl.spamhaus.org",
        "pbl.spamhaus.org"
      ]
    }
  ]
}
```

Each zone can:
- Use `"rbls": "*"` to check against all RBL servers
- Specify an array of specific RBL hosts to check
- Have its own domain name for querying

Query different zones:
```bash
# Check against all RBLs (slower, comprehensive)
dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com TXT

# Check against major RBLs only (faster)
dig @localhost -p 8053 2.0.0.127.major-rbls.example.com TXT

# Check Spamhaus only (fastest, most authoritative)
dig @localhost -p 8053 2.0.0.127.spamhaus.example.com TXT
```

**Notes:**
- If `etc/multi-rbl-zones.json` doesn't exist, the server falls back to the single domain specified by `DNS_MULTI_RBL_DOMAIN` in `.env`
- Zone configurations are loaded at server startup
- Each zone's queries are cached independently
- Using targeted zones can significantly improve response times for specific use cases

**Cache Management:**

View statistics:
```bash
npm run dns-stats
```

Clear cache:
```bash
npm run dns-clear-cache
```

#### Running DNS Server as a Daemon

For production environments, you'll want to run the DNS server as a background daemon that starts automatically on system boot.

##### Using PM2 (Recommended for all platforms)

PM2 is a production-grade process manager for Node.js applications that works on Linux, macOS, and Windows.

**Install PM2 globally:**
```bash
npm install -g pm2
```

**Start the DNS server:**
```bash
pm2 start src/start-dns-server.js --name multirbl-dns
```

**With custom options:**
```bash
pm2 start src/start-dns-server.js --name multirbl-dns -- --port=53 --host=0.0.0.0
```

**Useful PM2 commands:**
```bash
pm2 list                    # View all running processes
pm2 logs multirbl-dns       # View logs for DNS server
pm2 restart multirbl-dns    # Restart DNS server
pm2 stop multirbl-dns       # Stop DNS server
pm2 delete multirbl-dns     # Remove from PM2
pm2 monit                   # Monitor CPU and memory usage
```

**Auto-start on system boot:**
```bash
pm2 startup                 # Follow the displayed instructions
pm2 save                    # Save current process list
```

##### Using systemd (Linux)

Create a systemd service file for the DNS server:

**1. Create service file:**
```bash
sudo nano /etc/systemd/system/multirbl-dns.service
```

**2. Add the following content:**
```ini
[Unit]
Description=Multi-RBL Lookup DNS Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/multirbl-lookup
ExecStart=/usr/bin/node src/start-dns-server.js --port=8053 --host=0.0.0.0
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Note:** To bind to port 53 (privileged port), either run as root (not recommended) or use `setcap`:
```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

**3. Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable multirbl-dns
sudo systemctl start multirbl-dns
```

**4. Manage the service:**
```bash
sudo systemctl status multirbl-dns      # Check status
sudo systemctl restart multirbl-dns     # Restart
sudo systemctl stop multirbl-dns        # Stop
sudo journalctl -u multirbl-dns -f      # View logs
```

##### Using Windows Service (Windows)

Install `node-windows` to run as a Windows service:

**1. Install node-windows:**
```bash
npm install -g node-windows
```

**2. Create install script (`install-dns-service.js`):**
```javascript
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'Multi-RBL Lookup DNS',
  description: 'Multi-RBL Lookup DNS Server',
  script: require('path').join(__dirname, 'src', 'start-dns-server.js'),
  scriptOptions: '--port=8053 --host=0.0.0.0',
  nodeOptions: ['--max_old_space_size=4096']
});

svc.on('install', function() {
  svc.start();
  console.log('DNS service installed and started');
});

svc.install();
```

**3. Run the install script as Administrator:**
```bash
node install-dns-service.js
```

**4. Manage via Windows Services:**
- Open `services.msc`
- Find "Multi-RBL Lookup DNS"
- Start/Stop/Restart as needed

##### Using Docker (Cross-platform)

Create a `Dockerfile` for the DNS server:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8053/udp

CMD ["node", "src/start-dns-server.js", "--port=8053", "--host=0.0.0.0"]
```

**Build and run:**
```bash
docker build -t multirbl-dns -f Dockerfile.dns .
docker run -d -p 8053:8053/udp --name multirbl-dns multirbl-dns
```

**For port 53 (standard DNS):**
```bash
docker run -d -p 53:53/udp --name multirbl-dns multirbl-dns node src/start-dns-server.js --port=53
```

**Using docker-compose (`docker-compose.yml`):**
```yaml
version: '3.8'
services:
  multirbl-dns:
    build:
      context: .
      dockerfile: Dockerfile.dns
    ports:
      - "8053:8053/udp"
    volumes:
      - ./data:/app/data
      - ./etc:/app/etc
    restart: unless-stopped
    command: ["node", "src/start-dns-server.js", "--port=8053", "--host=0.0.0.0"]
```

Start with:
```bash
docker-compose up -d
```

##### Using Cron with Auto-restart Script

For simple deployments, you can use cron to ensure the DNS server stays running.

**1. Create a startup/monitor script (`scripts/ensure-dns-running.sh`):**
```bash
#!/bin/bash

# Configuration
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/dns-server.pid"
LOG_FILE="$PROJECT_DIR/logs/dns-server.log"
NODE_BIN="/usr/bin/node"
DNS_PORT="8053"
DNS_HOST="0.0.0.0"

cd "$PROJECT_DIR"

# Create logs directory if it doesn't exist
mkdir -p logs

# Function to check if DNS server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to start DNS server
start_server() {
    echo "[$(date)] Starting Multi-RBL DNS server on port $DNS_PORT..." >> "$LOG_FILE"
    nohup "$NODE_BIN" src/start-dns-server.js --port="$DNS_PORT" --host="$DNS_HOST" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[$(date)] DNS server started with PID $(cat $PID_FILE)" >> "$LOG_FILE"
}

# Check if server is running, start if not
if is_running; then
    echo "[$(date)] DNS server is running with PID $(cat $PID_FILE)" >> "$LOG_FILE"
else
    echo "[$(date)] DNS server is not running, starting..." >> "$LOG_FILE"
    start_server
fi
```

**2. Make the script executable:**
```bash
chmod +x scripts/ensure-dns-running.sh
```

**3. Add to crontab:**
```bash
crontab -e
```

**Add one of these lines:**

Check every minute:
```cron
* * * * * /path/to/multirbl-lookup/scripts/ensure-dns-running.sh
```

Check every 5 minutes:
```cron
*/5 * * * * /path/to/multirbl-lookup/scripts/ensure-dns-running.sh
```

Start at system reboot:
```cron
@reboot /path/to/multirbl-lookup/scripts/ensure-dns-running.sh
```

Combined (check every 5 minutes + start at reboot):
```cron
@reboot /path/to/multirbl-lookup/scripts/ensure-dns-running.sh
*/5 * * * * /path/to/multirbl-lookup/scripts/ensure-dns-running.sh
```

**4. Create manual control scripts:**

**Stop script (`scripts/stop-dns-server.sh`):**
```bash
#!/bin/bash
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/dns-server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        echo "DNS server stopped (PID $PID)"
        rm "$PID_FILE"
    else
        echo "PID file exists but process not running"
        rm "$PID_FILE"
    fi
else
    echo "DNS server is not running (no PID file)"
fi
```

**Status script (`scripts/status-dns-server.sh`):**
```bash
#!/bin/bash
PROJECT_DIR="/path/to/multirbl-lookup"
PID_FILE="$PROJECT_DIR/dns-server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "DNS server is running (PID $PID)"
        ps -p "$PID" -o pid,ppid,cmd,%mem,%cpu,etime
    else
        echo "PID file exists but process not running"
    fi
else
    echo "DNS server is not running (no PID file)"
fi
```

**Make them executable:**
```bash
chmod +x scripts/stop-dns-server.sh scripts/status-dns-server.sh
```

**5. View logs:**
```bash
tail -f logs/dns-server.log
```

**Note:** This cron-based approach is simpler but less robust than PM2 or systemd. The server won't restart immediately on crashes (only when cron runs), and there's no built-in log rotation or advanced process management.

### Web Interface

The web interface uses the same caching system as the DNS server for improved performance.

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

## Custom RBL Management

The Multi-RBL Lookup tool includes support for self-managed custom RBL lists with CIDR range support for both IPv4 and IPv6.

### Quick Start

1. **Generate an API key:**

First, you need an API key for authentication. There are three ways to generate one:

**Option A: Bootstrap Script (Recommended for first-time setup):**
```bash
node database/bootstrap-apikey.js "Initial admin key"
```

This will:
- Generate a cryptographically secure random API key
- Store it in the database with bcrypt hashing
- Display the key (save it immediately - you won't see it again!)

Save the key to `~/.rbl-cli.rc`:
```ini
api-key = YOUR_GENERATED_KEY_HERE
```

**Option B: Manual database insert (alternative):**
```bash
psql -U multirbl -d multirbl -c "
INSERT INTO api_keys (key_hash, key_prefix, description)
SELECT crypt('your-secure-key-here', gen_salt('bf')),
       'your-sec',
       'Initial admin key';"
```

**Option C: Generate via CLI (requires existing API key):**
```bash
php rbl-cli.php custom apikey generate --desc="Production key"
```

2. **Add entries to your custom RBL:**

```bash
# Add a single IP (stored as /32)
php rbl-cli.php custom add 192.168.1.100/32 "Known spammer"

# Add an entire subnet
php rbl-cli.php custom add 10.0.0.0/24 "Spam network"

# Add IPv6 range
php rbl-cli.php custom add 2001:db8::/32 "Blocked IPv6 range"
```

3. **List entries:**

```bash
php rbl-cli.php custom list
```

4. **Remove entries:**

```bash
php rbl-cli.php custom remove 192.168.1.100/32
```

5. **View/update configuration:**

```bash
# View current config
php rbl-cli.php custom config

# Update zone name
php rbl-cli.php custom config --zone=blocklist.example.com
```

### Testing Custom RBL via DNS

Once you have entries in your custom RBL, test via DNS server:

```bash
# Start DNS server
node src/start-dns-server.js

# Test query (IP 192.168.1.100 becomes 100.1.168.192 reversed)
dig @localhost -p 8053 100.1.168.192.myrbl.example.com

# Get reason via TXT record
dig @localhost -p 8053 100.1.168.192.myrbl.example.com TXT
```

### Custom RBL API Endpoints

All admin endpoints require `X-API-Key` header:

```bash
# List entries
curl -H "X-API-Key: YOUR_KEY" http://localhost:3000/api/admin/custom-rbl/entries

# Add entry
curl -X POST http://localhost:3000/api/admin/custom-rbl/entries \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"network": "203.0.113.0/24", "reason": "Spam source"}'

# Check IP (public endpoint, no auth required)
curl -X POST http://localhost:3000/api/custom-rbl/check \
  -H "Content-Type: application/json" \
  -d '{"ip": "203.0.113.50"}'
```

### CLI Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `custom add <cidr> [reason]` | Add IP/CIDR to blocklist | `custom add 10.0.0.1/32 "Spammer"` |
| `custom remove <cidr>` | Remove entry | `custom remove 10.0.0.1/32` |
| `custom list [--limit=N]` | List all entries | `custom list --limit=50` |
| `custom config [--zone=name]` | View/update config | `custom config --zone=my.rbl.com` |
| `custom apikey generate` | Generate API key | `custom apikey generate --desc="Key"` |

### Features

- **CIDR Matching**: Efficient subnet matching using PostgreSQL's native INET/CIDR types
- **IPv4 and IPv6**: Full support for both IP versions
- **GiST Indexes**: Fast lookups even with millions of entries
- **API Key Authentication**: Secure access control via X-API-Key header
- **DNS Integration**: Custom RBL queries work seamlessly with DNS server
- **CLI Management**: Full-featured command-line interface
- **Reason Tracking**: Store why an IP/range is blocked

### Documentation

For complete documentation including architecture, API reference, and examples, see:
- **[docs/CUSTOM-RBL.md](docs/CUSTOM-RBL.md)** - Complete Custom RBL guide

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
         ├─────────► Custom RBL Query?
         │           └─ Yes: PostgreSQL CIDR lookup → Response
         │
         ├─────────► Multi-RBL Query?
         │           ├─ Yes: Check cache for ALL RBLs (two-tier)
         │           ├─ Cache hits return instantly
         │           ├─ Cache misses: Query concurrently (250ms timeout)
         │           └─ Cache new results → Aggregate response
         │
         ├─────────► Two-Tier Cache Check
         │           ├─ L1 (Memcache): Hit? Return result (~0.1ms)
         │           ├─ L2 (PostgreSQL): Hit? Return result + backfill L1 (~1-5ms)
         │           └─ Miss: Continue to lookup
         │
         ├─────────► RBL Lookup (DNS query)
         │
         ├─────────► Cache Result (L1 + L2 with TTL)
         │
         └─────────► DNS Response (A + TXT records)
```

### Multi-RBL Lookup Flow

When a query matches any configured multi-RBL zone domain (e.g., `2.0.0.127.multi-rbl.example.com` or `2.0.0.127.major-rbls.example.com`):

1. **Match Zone**: Identify which multi-RBL zone the query is for
2. **Parse IP**: Extract IP address from query (e.g., `127.0.0.2`)
3. **Filter RBLs**: Select RBL servers based on zone configuration:
   - `"rbls": "*"` = all 40+ RBL servers
   - `"rbls": [...]` = specific RBL servers listed in the zone
4. **Concurrent Lookups**: Query selected RBL servers simultaneously using cached lookups
5. **250ms Timeout**: Hard timeout ensures response within 250ms
6. **Collect Results**: Gather all completed responses (cache hits return instantly)
7. **Build Response**:
   - **A Record**: Returns `127.0.0.2` if listed on any RBL, or NXDOMAIN if clean
   - **TXT Records**:
     - Summary: `"Listed on 3/9 RBLs (9/9 checked in 180ms)"` (example for major-rbls zone)
     - Details: `"Spamhaus ZEN: LISTED"`, `"Barracuda: LISTED"`, etc.
8. **Cache Everything**: All individual RBL results are cached for future queries

**Multiple Zone Example:**
- `multi-rbl.example.com` checks all 40+ RBLs (comprehensive but slower)
- `major-rbls.example.com` checks only 9 major RBLs (faster, most important lists)
- `spamhaus.example.com` checks only 4 Spamhaus lists (fastest, single provider)

### Cache Database Schema

```sql
CREATE TABLE rbl_cache (
  ip INET NOT NULL,                  -- Native PostgreSQL INET type
  rbl_host VARCHAR(255) NOT NULL,
  listed BOOLEAN NOT NULL,           -- Native boolean
  response INET,                     -- Native INET type
  error TEXT,
  ttl INTEGER NOT NULL,
  cached_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE(ip, rbl_host)
);

-- GiST index for efficient IP lookups
CREATE INDEX idx_rbl_cache_ip ON rbl_cache USING GIST(ip inet_ops);
```

### TTL Management

- **Listed IPs**: Uses TTL from DNS response (typically 300-3600 seconds)
- **Not Listed**: Cached for 1 hour (3600 seconds)
- **Errors**: Cached for 5 minutes (300 seconds)
- **Auto-cleanup**: Expired entries cleaned every 5 minutes

### Performance

- **L1 Cache Hit (Memcache)**: ~0.1ms response time (99.99% faster than DNS lookup)
- **L2 Cache Hit (PostgreSQL)**: ~1-5ms response time (99.7% faster than DNS lookup)
- **Cache Miss**: 100-5000ms (depends on RBL server)
- **Concurrent Lookups**: All RBL servers queried in parallel
- **Storage**: Two-tier caching with optional memcache + PostgreSQL with connection pooling
- **Custom RBL CIDR Lookup**: < 10ms using GiST indexes

### Shared Cache

Both the DNS server and web interface use the **same two-tier cache system** (optional memcache + PostgreSQL). This means:

- Queries via DNS server are cached for web interface
- Queries via web interface are cached for DNS server
- Custom RBL lookups integrated seamlessly
- Cache is shared across all services (memcache + PostgreSQL with connection pooling)
- Performance benefits apply to all query methods
- Single source of truth for all RBL lookups
- Hot data served from memcache (L1) for sub-millisecond performance

Example workflow:
1. User queries DNS server: `dig @localhost -p 8053 2.0.0.127.zen.spamhaus.org`
2. Result is cached in both layers (memcache L1 + PostgreSQL L2)
3. Web interface query for `127.0.0.2` returns cached result from memcache instantly (~0.1ms)
4. Multi-RBL query uses all cached results: `dig @localhost -p 8053 2.0.0.127.multi-rbl.example.com TXT`
5. All subsequent queries (DNS, HTTP, or multi-RBL) benefit from two-tier cache
6. If memcache restarts, PostgreSQL (L2) serves as backup and backfills memcache

## Testing Tools

### test-dns.php

A PHP-based DNS testing tool that sends raw DNS queries and displays results including TXT records.

```bash
php test-dns.php
```

The script tests multiple query types:
- Single RBL lookups (e.g., `2.0.0.127.zen.spamhaus.org`)
- Multi-RBL lookups (e.g., `2.0.0.127.multi-rbl.example.com`)
- Regular domain lookups (forwarded to upstream DNS)

Output includes:
- DNS response codes (NOERROR, NXDOMAIN, etc.)
- A record IP addresses
- TXT record contents (useful for multi-RBL results)
- Response times and transaction details

Edit the `$test_queries` array in the script to customize test cases.

## Configuration

### RBL Server Configuration

RBL servers are configured in `etc/rbl-servers.json`. Each entry contains:

```json
{
  "name": "Display Name",
  "host": "dnsbl.example.org",
  "description": "Description of this RBL"
}
```

You can add or remove RBL servers by editing this file.

### Multi-RBL Zone Configuration

Multi-RBL zones are optionally configured in `etc/multi-rbl-zones.json`. Each zone defines a domain and the set of RBLs to check:

```json
{
  "zones": [
    {
      "domain": "multi-rbl.example.com",
      "description": "All RBLs (comprehensive check)",
      "rbls": "*"
    },
    {
      "domain": "major-rbls.example.com",
      "description": "Major RBLs only",
      "rbls": ["zen.spamhaus.org", "cbl.abuseat.org", "bl.spamcop.net"]
    }
  ]
}
```

**Zone Configuration Options:**
- `domain`: The DNS domain for this zone (e.g., `major-rbls.example.com`)
- `description`: Human-readable description of the zone's purpose
- `rbls`: Either `"*"` for all RBL servers, or an array of specific RBL hosts

**Notes:**
- If this file doesn't exist, the server uses the single domain from `DNS_MULTI_RBL_DOMAIN` in `.env`
- The RBL hosts in the `rbls` array must match the `host` values in `etc/rbl-servers.json`
- Multiple zones allow you to create fast, targeted checks (e.g., Spamhaus-only) alongside comprehensive checks

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

Affero GPL (see LICENSE)
