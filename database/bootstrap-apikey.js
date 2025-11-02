#!/usr/bin/env node

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
