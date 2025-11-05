#!/usr/bin/env node

/**
 * Initialize Netlify Blob storage with the current app configuration
 * Usage: node init-config.js [config-file-path] [passphrase]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const NETLIFY_URL = 'https://toddler-phone-control.netlify.app';
const DEFAULT_PASSPHRASE = 'blue mountain coffee morning sunshine';

async function uploadConfig(configPath, passphrase) {
  try {
    // Read the config file
    const fullPath = resolve(configPath);
    console.log(`📖 Reading config from: ${fullPath}`);

    const configData = JSON.parse(readFileSync(fullPath, 'utf-8'));
    console.log(`✅ Config loaded successfully`);

    // Upload to Netlify
    console.log(`\n🚀 Uploading to ${NETLIFY_URL}/api/config-import...`);
    console.log(`🔑 Using passphrase: ${passphrase.substring(0, 10)}...`);

    const response = await fetch(`${NETLIFY_URL}/api/config-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${passphrase}`
      },
      body: JSON.stringify({
        key: 'app-config',
        data: configData
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Success! Configuration imported.`);
      console.log(`\n📊 Config details:`);
      console.log(`   - Key: app-config`);
      console.log(`   - Imported at: ${result.config.importedAt}`);
      console.log(`\n🌐 Your app can now fetch config from:`);
      console.log(`   ${NETLIFY_URL}/api/config`);
    } else {
      console.error(`❌ Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Get config path and passphrase from command line or use defaults
const configPath = process.argv[2] || '../public/config/app-config.json';
const passphrase = process.argv[3] || DEFAULT_PASSPHRASE;

if (passphrase === DEFAULT_PASSPHRASE) {
  console.log('\n⚠️  Using default passphrase. Pass your custom passphrase as second argument.');
  console.log('   Example: node init-config.js config.json "my five word passphrase here"\n');
}

uploadConfig(configPath, passphrase);
