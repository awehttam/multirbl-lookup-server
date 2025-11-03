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
 * Bootstrap Script - Generate Initial API Key
 * Run this once to create your first API key for custom RBL management
 *
 * Usage: node database/bootstrap-apikey.js [description]
 */

import { generateApiKey } from '../src/auth-middleware.js';

async function bootstrap() {
  const description = process.argv[2] || 'Initial admin key';

  try {
    console.log('Generating initial API key...\n');

    const result = await generateApiKey(description);

    if (!result.success) {
      console.error('✗ Failed to generate API key:', result.error);
      process.exit(1);
    }

    console.log('✓ API Key Generated Successfully\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('IMPORTANT: Save this key now - it will not be shown again!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('API Key:');
    console.log(result.apiKey);
    console.log('');
    console.log('Key Prefix:', result.keyPrefix);
    console.log('Description:', result.description || 'None');
    console.log('Created:', result.createdAt);
    console.log('');
    console.log('Add to ~/.rbl-cli.rc:');
    console.log(`  api-key = ${result.apiKey}`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

bootstrap();
