#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateGeneratedFreshness, loadGeneratedFreshnessArtifacts } from './lib/generated-freshness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function gitCommitCount() {
  const result = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not determine current commit count for milestone freshness');
  return Number(String(result.stdout || '').trim());
}

async function main() {
  const now = argValue('--now') || new Date().toISOString();
  const commitCountArg = argValue('--commit-count');
  const artifacts = await loadGeneratedFreshnessArtifacts(ROOT);
  const report = evaluateGeneratedFreshness({
    artifacts,
    now,
    commitCount: commitCountArg === null ? gitCommitCount() : Number(commitCountArg)
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    for (const issue of report.issues) console.error(`stale - ${issue.id}: ${issue.message}`);
    throw new Error(`${report.issues.length} generated freshness contract${report.issues.length === 1 ? '' : 's'} failed`);
  }
  console.log(`ok - generated freshness audit passed at ${report.checkedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
