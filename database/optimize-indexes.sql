-- Migration to optimize indexes on rbl_cache table
-- Run this to optimize your existing database

-- Drop redundant indexes
-- These are redundant because UNIQUE(ip, rbl_host) creates its own B-tree index
DROP INDEX IF EXISTS idx_rbl_cache_ip_rbl;

-- This GiST index is not needed - we're doing exact IP matches, not CIDR containment
-- The UNIQUE constraint index handles exact lookups more efficiently
DROP INDEX IF EXISTS idx_rbl_cache_ip;

-- Add composite index for fast getCached() queries
-- This index covers the WHERE clause: ip = X AND rbl_host = Y AND expires_at > Z
CREATE INDEX IF NOT EXISTS idx_rbl_cache_lookup ON rbl_cache(ip, rbl_host, expires_at);

-- Verify remaining indexes
-- You should see:
-- 1. rbl_cache_ip_rbl_key (automatic from UNIQUE constraint)
-- 2. idx_rbl_cache_expires (for cleanup queries)
-- 3. rbl_cache_pkey (primary key)

-- To verify indexes on rbl_cache:
-- \di+ rbl_cache*

-- Expected query plans:
-- getCached query: SELECT ... WHERE ip = $1 AND rbl_host = $2 AND expires_at > $3
--   Should use: Index Scan using rbl_cache_ip_rbl_key
--
-- cleanExpired query: DELETE ... WHERE expires_at <= $1
--   Should use: Index Scan using idx_rbl_cache_expires
--
-- clearIp query: DELETE ... WHERE ip = $1
--   Should use: Index Scan using rbl_cache_ip_rbl_key

-- To analyze query plans:
-- EXPLAIN ANALYZE SELECT ... FROM rbl_cache WHERE ip = '127.0.0.2'::inet AND rbl_host = 'zen.spamhaus.org' AND expires_at > 1234567890;
