# DNS Server Examples

This document provides practical examples for using the RBL DNS server.

## Starting the Server

### Basic Start (Default Port 5353)

```bash
npm run dns-server
```

This starts the server on:
- **Host**: 0.0.0.0 (all interfaces)
- **Port**: 5353
- **Upstream DNS**: 8.8.8.8 (Google DNS)

### Custom Configuration

Start on port 53 (requires admin/root):
```bash
sudo node src/start-dns-server.js --port=53
```

Bind to localhost only:
```bash
node src/start-dns-server.js --host=127.0.0.1
```

Use Cloudflare DNS as upstream:
```bash
node src/start-dns-server.js --upstream=1.1.1.1
```

## Testing RBL Queries

### Using dig

Test a known spam IP (127.0.0.2 is the RBL test address):
```bash
dig @localhost -p 5353 2.0.0.127.zen.spamhaus.org
```

Expected output (listed):
```
;; ANSWER SECTION:
2.0.0.127.zen.spamhaus.org. 3600 IN A 127.0.0.2
```

Test a clean IP (8.8.8.8 reversed is 8.8.8.8):
```bash
dig @localhost -p 5353 8.8.8.8.zen.spamhaus.org
```

Expected output (not listed):
```
;; status: NXDOMAIN
```

### Using nslookup

```bash
nslookup 2.0.0.127.zen.spamhaus.org localhost -port=5353
```

### Testing Multiple RBL Servers

Test against Spamhaus:
```bash
dig @localhost -p 5353 2.0.0.127.zen.spamhaus.org
```

Test against SpamCop:
```bash
dig @localhost -p 5353 2.0.0.127.bl.spamcop.net
```

Test against SORBS:
```bash
dig @localhost -p 5353 2.0.0.127.dnsbl.sorbs.net
```

## Monitoring Cache Performance

### View Cache Statistics

```bash
npm run dns-stats
```

Output:
```
RBL Cache Statistics
===================
Total entries:     150
Valid entries:     145
Expired entries:   5
Listed:            12
Not listed:        130
Errors:            3
List rate:         8.3%
```

### Real-time Monitoring

Start the server and watch for cache hits:

```bash
npm run dns-server
```

Then make queries - you'll see:
```
Query: 2.0.0.127.zen.spamhaus.org (A)
RBL query for 127.0.0.2 against Spamhaus ZEN
  -> LISTED (127.0.0.2) [FRESH]

Query: 2.0.0.127.zen.spamhaus.org (A)
RBL query for 127.0.0.2 against Spamhaus ZEN
  -> LISTED (127.0.0.2) [CACHED]
```

Notice the `[FRESH]` vs `[CACHED]` indicator.

## Cache Management

### Clear All Cache

```bash
npm run dns-clear-cache
```

### Clear Specific IP

```javascript
// Using Node.js script
import { getDatabase } from './src/cache-db.js';
const db = getDatabase();
db.clearIp('127.0.0.2');
db.close();
```

## Integration Examples

### Using as System DNS Resolver

**Warning**: This requires running on port 53 and proper system configuration.

1. Start the server on port 53:
```bash
sudo node src/start-dns-server.js --port=53
```

2. Configure your system to use localhost as DNS server

3. All RBL queries will be automatically cached

### Using with Postfix

Add to `/etc/postfix/main.cf`:

```
smtpd_recipient_restrictions =
    permit_mynetworks,
    reject_rbl_client zen.spamhaus.org,
    reject_rbl_client bl.spamcop.net,
    permit
```

Then configure Postfix to use your DNS server:

```
# Set DNS server in /etc/resolv.conf or use
smtp_host_lookup = dns
```

### Using with Scripting

```bash
# Check if IP is listed
if dig @localhost -p 5353 +short 2.0.0.127.zen.spamhaus.org | grep -q 127.0.0; then
    echo "IP is listed on RBL"
else
    echo "IP is clean"
fi
```

## Performance Testing

### Benchmark Cache Performance

```bash
# First query (cache miss)
time dig @localhost -p 5353 2.0.0.127.zen.spamhaus.org

# Second query (cache hit)
time dig @localhost -p 5353 2.0.0.127.zen.spamhaus.org
```

You should see significantly faster response time on the cached query.

### Batch Testing

Test multiple IPs:
```bash
for ip in 1.2.3.4 5.6.7.8 9.10.11.12; do
    reversed=$(echo $ip | awk -F. '{print $4"."$3"."$2"."$1}')
    dig @localhost -p 5353 +short ${reversed}.zen.spamhaus.org
done
```

## Troubleshooting

### Server Won't Start on Port 53

Error: `EACCES: permission denied`

Solution: Run with sudo/admin privileges:
```bash
sudo node src/start-dns-server.js --port=53
```

### Upstream DNS Not Working

Test upstream DNS resolution:
```bash
dig @localhost -p 5353 google.com
```

If this fails, check your upstream DNS server:
```bash
node src/start-dns-server.js --upstream=1.1.1.1
```

### Cache Not Working

Check database permissions:
```bash
ls -la data/rbl-cache.db
```

View cache stats:
```bash
npm run dns-stats
```

### High Memory Usage

Clear expired cache entries:
```bash
npm run dns-clear-cache
```

Or restart the server (auto-cleanup runs every 5 minutes).

## Advanced Usage

### Running as Service (Linux)

Create `/etc/systemd/system/rbl-dns.service`:

```ini
[Unit]
Description=RBL DNS Server with Caching
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/path/to/multirbl-lookup
ExecStart=/usr/bin/node src/start-dns-server.js --port=5353
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable rbl-dns
sudo systemctl start rbl-dns
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 5353/udp
CMD ["node", "src/start-dns-server.js"]
```

Build and run:
```bash
docker build -t rbl-dns-server .
docker run -p 5353:5353/udp rbl-dns-server
```

## API Usage

While the DNS server responds to DNS queries, you can also use the caching module in your own code:

```javascript
import { lookupIpCached } from './src/rbl-lookup-cached.js';
import { getDatabase } from './src/cache-db.js';

const db = getDatabase();
const result = await lookupIpCached('8.8.8.8', db);

console.log(`Cache hits: ${result.cacheHits}`);
console.log(`Cache misses: ${result.cacheMisses}`);
console.log(`Cache hit rate: ${result.cacheHitRate}`);
console.log(`Listed on ${result.listedCount} RBLs`);
```

## Best Practices

1. **Use appropriate TTL values**: Default values work well for most use cases
2. **Monitor cache size**: Run `npm run dns-stats` periodically
3. **Clear cache after blacklist updates**: Some IPs get delisted
4. **Use upstream DNS**: Configure reliable upstream DNS for non-RBL queries
5. **Log rotation**: Monitor disk space for logs if running as service
6. **Regular restarts**: Schedule weekly restarts to clear memory

## Resources

- RBL Server List: `etc/rbl-servers.json`
- Cache Database: `data/rbl-cache.db`
- Logs: Check console output or redirect to file
