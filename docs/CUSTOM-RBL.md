# Custom RBL Implementation Guide

## Overview

The Multi-RBL Lookup tool now supports custom, self-managed RBL lists. This feature allows you to maintain your own blocklist using PostgreSQL's powerful CIDR matching capabilities, supporting both IPv4 and IPv6 addresses and network ranges.

## Table of Contents

- [Architecture](#architecture)
- [PostgreSQL Setup](#postgresql-setup)
- [Database Migration](#database-migration)
- [API Key Generation](#api-key-generation)
- [Managing Entries](#managing-entries)
- [DNS Integration](#dns-integration)
- [API Reference](#api-reference)
- [CLI Reference](#cli-reference)
- [Examples](#examples)

---

## Architecture

### Key Components

1. **PostgreSQL Database**: Replaces SQLite for efficient CIDR matching using native INET/CIDR types
2. **REST API**: Authenticated admin endpoints for managing custom RBL entries
3. **DNS Server Integration**: Custom RBL queries resolved through DNS
4. **PHP CLI Extension**: Command-line tools for blocklist management
5. **API Key Authentication**: Secure access using X-API-Key header

### Database Schema

```sql
-- Custom RBL Configuration
CREATE TABLE custom_rbl_config (
  id SERIAL PRIMARY KEY,
  zone_name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE
);

-- Custom RBL Entries (CIDR-based)
CREATE TABLE custom_rbl_entries (
  id SERIAL PRIMARY KEY,
  network CIDR NOT NULL,           -- IPv4 or IPv6 CIDR
  listed BOOLEAN DEFAULT TRUE,
  reason TEXT,
  added_by VARCHAR(100),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- API Keys for Authentication
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(10),
  description TEXT,
  revoked BOOLEAN DEFAULT FALSE
);
```

---

## PostgreSQL Setup

### 1. Install PostgreSQL

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
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Create Database and User

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE multirbl;
CREATE USER multirbl WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE multirbl TO multirbl;

# Exit psql
\q
```

### 3. Configure Environment

Copy `.env.example` to `.env` and update:

```bash
cp .env.example .env
```

Edit `.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=multirbl
DB_USER=multirbl
DB_PASSWORD=your_secure_password
```

---

## Database Migration

### Run Migration Script

```bash
node database/migrate.js
```

Expected output:
```
Connecting to PostgreSQL...
Host: localhost:5432
Database: multirbl
User: multirbl
✓ Connected successfully

Running schema migration...
✓ Schema created successfully

Created tables:
  - api_keys
  - custom_rbl_config
  - custom_rbl_entries
  - rbl_cache

✓ Migration completed successfully
```

### Verify Tables

```bash
psql -U multirbl -d multirbl -c "\dt"
```

---

## API Key Generation

### Using CLI (Recommended)

**First-time setup requires existing API key:**

1. Generate initial key directly in database:

```bash
psql -U multirbl -d multirbl
```

```sql
-- Generate a random key and hash it (example key: replace with secure random string)
INSERT INTO api_keys (key_hash, key_prefix, description)
VALUES (
  crypt('your_temporary_key_here', gen_salt('bf', 10)),
  substr('your_temporary_key_here', 1, 8),
  'Initial admin key'
);
```

2. Add to `~/.rbl-cli.rc`:

```ini
host = localhost
port = 3000
api-key = your_temporary_key_here
```

3. Generate proper key via CLI:

```bash
php rbl-cli.php custom apikey generate --desc="Production API Key"
```

Output:
```
Generating new API key...

✓ API Key Generated Successfully

IMPORTANT: Save this key now - it will not be shown again!

a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2

Key Prefix: a1b2c3d4
Description: Production API Key
Created: 2025-01-15T10:30:45.123Z

Add to ~/.rbl-cli.rc:
  api-key = a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

### Using API

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_existing_key" \
  -d '{"description": "New API key"}'
```

---

## Managing Entries

### Add Entry (Single IP)

```bash
# Single IPv4 address (stored as /32)
php rbl-cli.php custom add 192.168.1.100/32 "Known spammer"

# Single IPv6 address (stored as /128)
php rbl-cli.php custom add 2001:db8::1/128 "Malicious host"
```

### Add Entry (CIDR Range)

```bash
# IPv4 subnet
php rbl-cli.php custom add 10.0.0.0/24 "Spam network"

# IPv6 subnet
php rbl-cli.php custom add 2001:db8::/32 "Blocked range"
```

### List Entries

```bash
# List all entries
php rbl-cli.php custom list

# Limit results
php rbl-cli.php custom list --limit=50
```

Output:
```
Custom RBL Entries (3 total)

+--------+----------------------+------------------------------------------+----------+
| ID     | Network (CIDR)       | Reason                                   | Status   |
+--------+----------------------+------------------------------------------+----------+
| 1      | 192.168.1.100/32     | Known spammer                            | LISTED   |
| 2      | 10.0.0.0/24          | Spam network                             | LISTED   |
| 3      | 2001:db8::/32        | Blocked range                            | LISTED   |
+--------+----------------------+------------------------------------------+----------+

Showing 3 of 3 entries
```

### Remove Entry

```bash
php rbl-cli.php custom remove 192.168.1.100/32
```

### View/Update Configuration

```bash
# View current config
php rbl-cli.php custom config

# Update zone name
php rbl-cli.php custom config --zone=blocklist.example.com
```

---

## DNS Integration

### How It Works

The custom RBL integrates seamlessly with the DNS server. Queries to your custom zone are automatically checked against the PostgreSQL database using CIDR matching.

### Query Format

```bash
# Query format: <reversed-ip>.<your-zone>
dig @localhost -p 8053 100.1.168.192.myrbl.example.com

# For IP 192.168.1.100, reverse the octets: 100.1.168.192
```

### Response Types

**IP is Listed:**
```
;; ANSWER SECTION:
100.1.168.192.myrbl.example.com. 3600 IN A 127.0.0.2
100.1.168.192.myrbl.example.com. 3600 IN TXT "Known spammer"
```

**IP is Not Listed:**
```
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN
```

### Start DNS Server

```bash
node src/start-dns-server.js
```

Output:
```
RBL DNS Server started
  Listen: 0.0.0.0:8053
  Upstream DNS: 8.8.8.8
  Multi-RBL Domain: multi-rbl.example.com
  Cache: PostgreSQL database
  Custom RBL: myrbl.example.com
```

---

## API Reference

### Authentication

All admin endpoints require the `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/admin/...
```

### Endpoints

#### Get Custom RBL Configuration

```http
GET /api/admin/custom-rbl/config
```

Response:
```json
{
  "success": true,
  "config": {
    "zone_name": "myrbl.example.com",
    "description": "Custom RBL blocklist",
    "enabled": true
  }
}
```

#### Update Configuration

```http
PUT /api/admin/custom-rbl/config
Content-Type: application/json

{
  "zoneName": "blocklist.example.com",
  "description": "Updated description",
  "enabled": true
}
```

#### List Entries

```http
GET /api/admin/custom-rbl/entries?limit=100&offset=0&listedOnly=true
```

Response:
```json
{
  "success": true,
  "entries": [
    {
      "id": 1,
      "network": "192.168.1.100/32",
      "reason": "Known spammer",
      "listed": true,
      "added_by": "admin",
      "created_at": "2025-01-15T10:00:00.000Z",
      "updated_at": "2025-01-15T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

#### Add Entry

```http
POST /api/admin/custom-rbl/entries
Content-Type: application/json

{
  "network": "192.168.1.0/24",
  "reason": "Spam network"
}
```

Response:
```json
{
  "success": true,
  "entry": {
    "id": 2,
    "network": "192.168.1.0/24",
    "reason": "Spam network",
    "createdAt": "2025-01-15T11:00:00.000Z"
  }
}
```

#### Update Entry

```http
PATCH /api/admin/custom-rbl/entries/:id
Content-Type: application/json

{
  "reason": "Updated reason",
  "listed": false
}
```

#### Delete Entry

```http
DELETE /api/admin/custom-rbl/entries/:id
```

#### Check IP (Public Endpoint)

```http
POST /api/custom-rbl/check
Content-Type: application/json

{
  "ip": "192.168.1.100"
}
```

Response:
```json
{
  "success": true,
  "result": {
    "listed": true,
    "response": "127.0.0.2",
    "reason": "Known spammer",
    "network": "192.168.1.0/24",
    "entryId": 2
  }
}
```

---

## CLI Reference

### Command Structure

```bash
php rbl-cli.php custom <command> [args] [options]
```

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `add` | Add IP/CIDR to blocklist | `custom add 10.0.0.1/32 "Spammer"` |
| `remove` | Remove entry by CIDR | `custom remove 10.0.0.1/32` |
| `list` | List all entries | `custom list --limit=50` |
| `config` | View/update configuration | `custom config --zone=new.zone` |
| `apikey generate` | Generate new API key | `custom apikey generate --desc="Key"` |

### Global Options

| Option | Description |
|--------|-------------|
| `--host=<host>` | API server host (default: localhost) |
| `--port=<port>` | API server port (default: 3000) |
| `--tls` | Use HTTPS |
| `--no-verify-ssl` | Disable SSL verification |

---

## Examples

### Example 1: Block Entire Subnet

```bash
# Add /24 subnet to blocklist
php rbl-cli.php custom add 203.0.113.0/24 "Known spam source"

# Verify entry
php rbl-cli.php custom list

# Test via DNS
dig @localhost -p 8053 50.113.0.203.myrbl.example.com

# Test via API
curl -X POST http://localhost:3000/api/custom-rbl/check \
  -H "Content-Type: application/json" \
  -d '{"ip": "203.0.113.50"}'
```

### Example 2: IPv6 Support

```bash
# Add IPv6 range
php rbl-cli.php custom add 2001:db8:abcd::/48 "Malicious IPv6 network"

# Test
curl -X POST http://localhost:3000/api/custom-rbl/check \
  -H "Content-Type: application/json" \
  -d '{"ip": "2001:db8:abcd::1"}'
```

### Example 3: Temporary Block

```bash
# Add entry
php rbl-cli.php custom add 198.51.100.42/32 "Temporary block"

# Later, remove it
php rbl-cli.php custom remove 198.51.100.42/32
```

### Example 4: Automation Script

```bash
#!/bin/bash
# auto-block-spammer.sh

IP=$1
REASON=${2:-"Automated block"}

# Add to custom RBL
php rbl-cli.php custom add "$IP/32" "$REASON"

# Log the action
echo "$(date): Blocked $IP - $REASON" >> /var/log/custom-rbl-blocks.log
```

---

## Performance Considerations

### CIDR Matching Performance

PostgreSQL uses GiST (Generalized Search Tree) indexes for fast CIDR lookups:

```sql
CREATE INDEX idx_custom_rbl_network ON custom_rbl_entries USING GIST(network inet_ops);
```

**Performance:**
- Single IP lookup: < 5ms
- CIDR range matching: < 10ms
- Supports millions of entries efficiently

### Caching

Standard RBL cache still applies:
- Cache hits: ~1ms
- Custom RBL queries are NOT cached (always fresh)
- Regular RBL queries continue to use cache

### Scaling Tips

1. **Index Optimization**: GiST index is automatically created
2. **Connection Pooling**: Configured in `DB_POOL_MAX` (default: 20)
3. **Query Optimization**: Most specific match returned first using `ORDER BY masklen(network) DESC`

---

## Security Best Practices

1. **API Keys**
   - Generate strong, random API keys
   - Use different keys for different applications
   - Rotate keys periodically
   - Revoke compromised keys immediately

2. **Database**
   - Use strong PostgreSQL password
   - Restrict PostgreSQL network access
   - Enable SSL/TLS for database connections in production

3. **Network**
   - Use firewall to restrict API access
   - Consider VPN for admin endpoints
   - Use HTTPS (TLS) in production

4. **Monitoring**
   - Log all API key usage
   - Monitor failed authentication attempts
   - Set up alerts for unusual activity

---

## Troubleshooting

### Database Connection Failed

```
✗ PostgreSQL connection failed: ECONNREFUSED
```

**Solution:**
- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Check connection details in `.env`
- Verify user has database access

### API Key Invalid

```
Error: API key required. Add 'api-key = YOUR_KEY' to ~/.rbl-cli.rc
```

**Solution:**
- Ensure `~/.rbl-cli.rc` contains valid `api-key` entry
- Verify key hasn't been revoked
- Check key is correct (64 hex characters)

### CIDR Validation Error

```
✗ Failed: Invalid CIDR notation
```

**Solution:**
- Use proper CIDR format: `192.168.1.0/24` or `10.0.0.1/32`
- IPv6 requires proper format: `2001:db8::/32`
- Single IPs need /32 (IPv4) or /128 (IPv6) suffix

---

## Migration from SQLite

The standard RBL cache has been migrated to PostgreSQL. No action required for existing deployments - the migration script handles everything.

**What Changed:**
- SQLite `rbl-cache.db` → PostgreSQL `rbl_cache` table
- Async/await for all database operations
- Connection pooling for better performance
- Native INET types for IP addresses

**Backwards Compatibility:**
- API remains unchanged
- Cache behavior identical
- Performance improved

---

## Future Enhancements

Planned features:
- [ ] Web UI for custom RBL management
- [ ] Import/export functionality (CSV, JSON)
- [ ] Automatic expiration for temporary blocks
- [ ] Integration with threat intelligence feeds
- [ ] Whitelist functionality
- [ ] Bulk operations API
- [ ] Audit log for all changes

---

## Support

For issues, questions, or contributions:
- GitHub Issues: [multirbl-lookup/issues](https://github.com/yourusername/multirbl-lookup/issues)
- Documentation: [docs/](../docs/)

---

## License

Same license as the main Multi-RBL Lookup Tool project.
