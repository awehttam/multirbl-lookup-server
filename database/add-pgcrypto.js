#!/usr/bin/env node

/**
 * Multi-RBL Lookup Tool
 * Copyright (C) 2025 Matthew Asham & Multi-RBL Lookup Contributors
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
