import dns from 'dns/promises';

/**
 * Reverse an IP address for RBL lookup
 */
function reverseIp(ip) {
  return ip.split('.').reverse().join('.');
}

/**
 * Extract TTL from DNS lookup (with fallback)
 */
function extractTtl(addresses, defaultTtl = 3600) {
  // Node's dns.resolve4 doesn't directly return TTL in standard way
  // We'll use a default TTL, but this could be enhanced with dns.resolve4({ ttl: true })
  return defaultTtl;
}

/**
 * Perform a single RBL lookup with TTL extraction
 */
async function lookupSingleRbl(ip, rblServer, timeout = 5000) {
  const reversedIp = reverseIp(ip);
  const query = `${reversedIp}.${rblServer.host}`;

  const startTime = Date.now();

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), timeout);
    });

    // Race between DNS lookup and timeout
    // Use resolve4 with ttl option to get TTL values
    const result = await Promise.race([
      dns.resolve4(query, { ttl: true }),
      timeoutPromise
    ]);

    const responseTime = Date.now() - startTime;

    // Extract TTL from first record
    let ttl = 3600; // default 1 hour
    let address = null;

    if (Array.isArray(result) && result.length > 0) {
      if (typeof result[0] === 'object' && result[0].address) {
        // TTL-enabled response
        address = result[0].address;
        ttl = result[0].ttl || 3600;
      } else {
        // Regular response
        address = result[0];
      }
    }

    return {
      name: rblServer.name,
      host: rblServer.host,
      description: rblServer.description,
      listed: true,
      response: address,
      responseTime,
      error: null,
      ttl
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // NXDOMAIN or NOTFOUND means not listed
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        name: rblServer.name,
        host: rblServer.host,
        description: rblServer.description,
        listed: false,
        response: null,
        responseTime,
        error: null,
        ttl: 3600 // Cache negative responses for 1 hour
      };
    }

    // Actual error (timeout, network issue, etc.)
    return {
      name: rblServer.name,
      host: rblServer.host,
      description: rblServer.description,
      listed: null,
      response: null,
      responseTime,
      error: error.message,
      ttl: 300 // Cache errors for 5 minutes
    };
  }
}

/**
 * Perform RBL lookup with caching
 */
export async function lookupSingleRblWithCache(ip, rblServer, db, timeout = 5000) {
  // Check cache first
  const cached = db.getCached(ip, rblServer.host);

  if (cached) {
    // Return cached result with additional metadata
    return {
      name: rblServer.name,
      host: rblServer.host,
      description: rblServer.description,
      listed: cached.listed,
      response: cached.response,
      responseTime: 0, // Cached, no DNS lookup time
      error: cached.error,
      ttl: cached.ttl,
      fromCache: true,
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt
    };
  }

  // Not in cache or expired - do fresh lookup
  const result = await lookupSingleRbl(ip, rblServer, timeout);

  // Cache the result
  db.cache(
    ip,
    rblServer.host,
    result.listed === true,
    result.response,
    result.error,
    result.ttl
  );

  // Add fromCache flag
  result.fromCache = false;

  return result;
}

/**
 * Load RBL servers from configuration file
 */
export async function loadRblServers() {
  // Import from original module
  const { getRblServers } = await import('./rbl-lookup.js');
  return await getRblServers();
}

/**
 * Lookup IP against multiple RBL servers with caching
 */
export async function lookupIpCached(ip, db, onProgress = null) {
  const rblServers = await loadRblServers();
  const results = [];

  // Create promises for all lookups
  const lookupPromises = rblServers.map(async (server) => {
    const result = await lookupSingleRblWithCache(ip, server, db);
    results.push(result);

    // Call progress callback if provided
    if (onProgress) {
      onProgress(result, results.length, rblServers.length);
    }

    return result;
  });

  // Wait for all lookups to complete
  await Promise.all(lookupPromises);

  // Sort results: listed first, then errors, then not listed
  results.sort((a, b) => {
    if (a.listed === b.listed) {
      return a.responseTime - b.responseTime;
    }
    if (a.listed === true) return -1;
    if (b.listed === true) return 1;
    if (a.error && !b.error) return -1;
    if (!a.error && b.error) return 1;
    return 0;
  });

  // Calculate cache statistics for this lookup
  const cacheHits = results.filter(r => r.fromCache).length;
  const cacheMisses = results.filter(r => !r.fromCache).length;

  return {
    ip,
    timestamp: new Date().toISOString(),
    totalChecked: rblServers.length,
    listedCount: results.filter(r => r.listed === true).length,
    notListedCount: results.filter(r => r.listed === false).length,
    errorCount: results.filter(r => r.error !== null).length,
    cacheHits,
    cacheMisses,
    cacheHitRate: ((cacheHits / rblServers.length) * 100).toFixed(1) + '%',
    results
  };
}
