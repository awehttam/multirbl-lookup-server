#!/usr/bin/env node

/**
 * Test script to verify cache functionality
 */

import { lookupIpCached } from './src/rbl-lookup-cached.js';
import { getDatabase } from './src/cache-db.js';

async function testCache() {
  console.log('Testing RBL Cache Functionality\n');
  console.log('================================\n');

  const db = getDatabase();
  const testIp = '8.8.8.8';

  // Clear cache for test IP
  console.log('1. Clearing cache for test IP...');
  const cleared = db.clearIp(testIp);
  console.log(`   Cleared ${cleared} entries\n`);

  // First lookup (should be cache miss)
  console.log('2. First lookup (cache miss expected)...');
  const startTime1 = Date.now();
  const result1 = await lookupIpCached(testIp, db);
  const duration1 = Date.now() - startTime1;

  console.log(`   IP: ${result1.ip}`);
  console.log(`   Total checked: ${result1.totalChecked}`);
  console.log(`   Cache hits: ${result1.cacheHits}`);
  console.log(`   Cache misses: ${result1.cacheMisses}`);
  console.log(`   Cache hit rate: ${result1.cacheHitRate}`);
  console.log(`   Duration: ${duration1}ms\n`);

  // Second lookup (should be cache hit)
  console.log('3. Second lookup (cache hit expected)...');
  const startTime2 = Date.now();
  const result2 = await lookupIpCached(testIp, db);
  const duration2 = Date.now() - startTime2;

  console.log(`   IP: ${result2.ip}`);
  console.log(`   Total checked: ${result2.totalChecked}`);
  console.log(`   Cache hits: ${result2.cacheHits}`);
  console.log(`   Cache misses: ${result2.cacheMisses}`);
  console.log(`   Cache hit rate: ${result2.cacheHitRate}`);
  console.log(`   Duration: ${duration2}ms\n`);

  // Performance improvement
  const improvement = ((duration1 - duration2) / duration1 * 100).toFixed(1);
  console.log(`   Performance improvement: ${improvement}%\n`);

  // Cache statistics
  console.log('4. Cache statistics...');
  const stats = db.getStats();
  console.log(`   Total entries: ${stats.total}`);
  console.log(`   Valid entries: ${stats.valid}`);
  console.log(`   Expired entries: ${stats.expired}`);
  console.log(`   Listed: ${stats.listed}`);
  console.log(`   Not listed: ${stats.notListed}`);
  console.log(`   Errors: ${stats.errors}\n`);

  // Verify cache entries
  console.log('5. Verifying cache entries...');
  const cachedResults = result2.results.filter(r => r.fromCache);
  console.log(`   Cached results: ${cachedResults.length}/${result2.results.length}`);

  if (cachedResults.length > 0) {
    const sample = cachedResults[0];
    console.log(`   Sample: ${sample.name}`);
    console.log(`     - Listed: ${sample.listed}`);
    console.log(`     - TTL: ${sample.ttl}s`);
    console.log(`     - From cache: ${sample.fromCache}`);
  }

  console.log('\n✓ Cache test completed successfully!');

  db.close();
}

// Run test
testCache().catch(error => {
  console.error('Test failed:', error.message);
  process.exit(1);
});
