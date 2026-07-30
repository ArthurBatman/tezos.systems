#!/usr/bin/env node

import fs from 'node:fs/promises';

const changelogUrl = new URL('../js/features/changelog.js', import.meta.url);
const changelogSource = await fs.readFile(changelogUrl, 'utf8');
const changelogModuleUrl = `data:text/javascript;base64,${Buffer.from(changelogSource).toString('base64')}`;
const { CHANGELOG } = await import(changelogModuleUrl);

const latestSection = CHANGELOG[0];
const latestEntry = latestSection?.entries?.at(-1);

if (!latestSection?.date || !latestEntry?.text) {
  throw new Error('The changelog must expose a dated latest entry');
}

process.stdout.write(JSON.stringify(latestEntry.text));
