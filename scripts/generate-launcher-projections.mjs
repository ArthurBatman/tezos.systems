#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkArgs = process.argv.includes('--check') ? ['--check'] : [];
const generators = [
  'scripts/generate-maxis-entry-summary.mjs',
  'scripts/generate-capital-entry-summary.mjs'
];

for (const generator of generators) {
  const result = spawnSync(process.execPath, [generator, ...checkArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${generator} failed with exit ${result.status}`);
  }
}

console.log(`Launcher projections ${checkArgs.length ? 'validated' : 'generated'} from reviewed source artifacts`);
