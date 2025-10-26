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
│   └── server.js              # Express API server
├── public_html/
│   ├── index.html             # Web interface
│   ├── styles.css             # Styling
│   └── app.js                 # Frontend JavaScript
├── etc/
│   └── rbl-servers.json       # 40+ RBL server configurations
├── data/
│   └── rbl-cache.db           # SQLite cache (auto-created)
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

```bash
php rbl-cli.php <ip-address>
```

Example:
```bash
php rbl-cli.php 8.8.8.8
```

#### Command Line Options

```
--host=<host>     API server host (default: localhost)
--port=<port>     API server port (default: 3000)
--filter=<type>   Filter results: all, listed, clean, error (default: all)
--no-color        Disable colored output
--json            Output raw JSON instead of table
--help, -h        Show help message
```

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
