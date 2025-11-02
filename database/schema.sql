-- Multi-RBL Lookup PostgreSQL Schema
-- This schema supports IPv4 and IPv6 addresses with CIDR notation

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- RBL Cache Table (migrated from SQLite)
CREATE TABLE IF NOT EXISTS rbl_cache (
  id SERIAL PRIMARY KEY,
  ip INET NOT NULL,
  rbl_host VARCHAR(255) NOT NULL,
  listed BOOLEAN NOT NULL,
  response INET,                        -- DNS response IP (e.g., 127.0.0.2)
  error TEXT,                           -- Error message if lookup failed
  ttl INTEGER NOT NULL,                 -- Time-to-live in seconds
  cached_at BIGINT NOT NULL,            -- Unix timestamp when cached
  expires_at BIGINT NOT NULL,           -- Unix timestamp when expires
  UNIQUE(ip, rbl_host)
);

-- Indexes for RBL cache performance
CREATE INDEX IF NOT EXISTS idx_rbl_cache_ip_rbl ON rbl_cache(ip, rbl_host);
CREATE INDEX IF NOT EXISTS idx_rbl_cache_expires ON rbl_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_rbl_cache_ip ON rbl_cache USING GIST(ip inet_ops);

-- Custom RBL Configuration Table
CREATE TABLE IF NOT EXISTS custom_rbl_config (
  id SERIAL PRIMARY KEY,
  zone_name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Custom RBL Entries Table (CIDR-based blocklist)
CREATE TABLE IF NOT EXISTS custom_rbl_entries (
  id SERIAL PRIMARY KEY,
  network CIDR NOT NULL,
  listed BOOLEAN DEFAULT TRUE,
  reason TEXT,
  added_by VARCHAR(100),               -- API key identifier or username
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast CIDR lookups using GiST (Generalized Search Tree)
CREATE INDEX IF NOT EXISTS idx_custom_rbl_network ON custom_rbl_entries USING GIST(network inet_ops);
CREATE INDEX IF NOT EXISTS idx_custom_rbl_listed ON custom_rbl_entries(listed);

-- API Keys Table for authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(10) NOT NULL,     -- First 8 chars for identification
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_custom_rbl_config_updated_at
  BEFORE UPDATE ON custom_rbl_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_rbl_entries_updated_at
  BEFORE UPDATE ON custom_rbl_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default custom RBL configuration
INSERT INTO custom_rbl_config (zone_name, description, enabled)
VALUES ('myrbl.example.com', 'Custom RBL blocklist', TRUE)
ON CONFLICT (zone_name) DO NOTHING;

-- Sample queries for reference:
-- Check if an IP is in custom RBL:
--   SELECT * FROM custom_rbl_entries WHERE network >>= '192.168.1.100'::inet AND listed = TRUE;
-- Add a CIDR range:
--   INSERT INTO custom_rbl_entries (network, reason) VALUES ('192.168.1.0/24', 'Spam source');
-- Add a single IP (as /32):
--   INSERT INTO custom_rbl_entries (network, reason) VALUES ('10.0.0.1/32', 'Known spammer');
