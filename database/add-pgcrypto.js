#!/usr/bin/env node

/**
 * Add pgcrypto extension to existing database
 * Run this if you get "function gen_salt(unknown) does not exist" error
 */

import { query } from '../src/db-postgres.js';

async function addPgcrypto() {
  try {
    console.log('Adding pgcrypto extension...');

    await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    console.log('✓ pgcrypto extension enabled successfully');
    console.log('\nYou can now use gen_salt() and crypt() functions.');

    process.exit(0);
  } catch (error) {
    console.error('✗ Failed to add pgcrypto extension:');
    console.error(error.message);
    process.exit(1);
  }
}

addPgcrypto();
