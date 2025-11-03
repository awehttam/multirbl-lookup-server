#!/usr/bin/env node

/**
 * Multi-RBL Lookup Tool
 * Copyright (C) 2025 Matthew Asham
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Database Migration Script
 * Initializes PostgreSQL database with schema
 *
 * Usage:
 *   node database/migrate.js
 *
 * Environment variables required:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Database configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'multirbl',
  user: process.env.DB_USER || 'multirbl',
  password: process.env.DB_PASSWORD || '',
};

async function migrate() {
  const pool = new Pool(config);

  try {
    console.log('Connecting to PostgreSQL...');
    console.log(`Host: ${config.host}:${config.port}`);
    console.log(`Database: ${config.database}`);
    console.log(`User: ${config.user}`);

    // Test connection
    const client = await pool.connect();
    console.log('✓ Connected successfully');

    // Read schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('\nRunning schema migration...');
    await client.query(schema);
    console.log('✓ Schema created successfully');

    // Verify tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('\nCreated tables:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    client.release();
    console.log('\n✓ Migration completed successfully');

  } catch (error) {
    console.error('\n✗ Migration failed:');
    console.error(error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\nTip: Make sure PostgreSQL is running and accessible');
    } else if (error.code === '3D000') {
      console.error('\nTip: Database does not exist. Create it first:');
      console.error(`  createdb -U ${config.user} ${config.database}`);
    } else if (error.code === '28P01') {
      console.error('\nTip: Authentication failed. Check DB_USER and DB_PASSWORD');
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
migrate();
