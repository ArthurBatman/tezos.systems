#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MILESTONE_BASE_THRESHOLDS,
  MILESTONE_CATALOG_SCHEMA,
  MILESTONE_REFRESH_COMMITS,
  MILESTONE_REFRESH_DAYS,
  extendMilestoneThresholds,
  milestoneCatalogCadence
} from '../js/features/milestone-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = path.join(ROOT, 'data/milestone-catalog.json');
const TZKT = 'https://api.tzkt.io/v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAINNET_START = Date.parse('2018-09-17T00:00:00Z');

function hasFlag(name) {
  return process.argv.includes(name);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function fetchJson(pathname, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TZKT}${pathname}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function valueFrom(result) {
  return result?.status === 'fulfilled' ? result.value : null;
}

function stakingRatio(stats) {
  const supply = finitePositive(stats?.totalSupply);
  if (!supply) return null;
  const explicit = Number(stats?.totalOwnStaked || 0) + Number(stats?.totalExternalStaked || 0);
  const staked = finitePositive(explicit) || finitePositive(stats?.totalFrozen);
  return staked ? (staked / supply) * 100 : null;
}

function bakerSnapshot(delegates) {
  if (!Array.isArray(delegates)) return { total: null, tz4Percentage: null };
  const funded = delegates.filter(delegate => Number(delegate?.bakingPower || 0) > 0);
  const tz4 = funded.filter((delegate) => String(delegate?.consensusAddress || delegate?.address || '').startsWith('tz4')).length;
  return {
    total: funded.length || null,
    tz4Percentage: funded.length ? (tz4 / funded.length) * 100 : null
  };
}

async function liveMilestoneValues(now) {
  const [headResult, statsResult, txResult, accountsResult, contractsResult, tokensResult, rollupsResult, bakersResult] = await Promise.allSettled([
    fetchJson('/head'),
    fetchJson('/statistics/current'),
    fetchJson('/operations/transactions/count'),
    fetchJson('/accounts/count?balance.gt=0'),
    fetchJson('/contracts/count'),
    fetchJson('/tokens/count'),
    fetchJson('/smart_rollups/count'),
    fetchJson('/delegates?active=true&select=address,consensusAddress,bakingPower&limit=10000')
  ]);

  const head = valueFrom(headResult);
  const stats = valueFrom(statsResult);
  if (!head || !stats) {
    throw new Error('Milestone catalog refresh needs TzKT head and statistics/current');
  }

  const bakers = bakerSnapshot(valueFrom(bakersResult));
  const protocolData = await readJson(path.join(ROOT, 'data/protocol-data.json'), {});
  return {
    blocks: finitePositive(head.level),
    'funded-wallets': finitePositive(valueFrom(accountsResult)),
    transactions: finitePositive(valueFrom(txResult)),
    'smart-contracts': finitePositive(valueFrom(contractsResult)),
    tokens: finitePositive(valueFrom(tokensResult)),
    bakers: bakers.total || finitePositive(stats.totalBakers),
    'tz4-adoption': bakers.tz4Percentage,
    staking: stakingRatio(stats),
    burned: finitePositive(stats.totalBurned) ? Number(stats.totalBurned) / 1e6 : null,
    cycle: finitePositive(head.cycle),
    'uptime-days': Math.floor((now - MAINNET_START) / DAY_MS),
    'protocol-upgrades': finitePositive(protocolData?.meta?.totalUpgrades),
    rollups: finitePositive(valueFrom(rollupsResult))
  };
}

function nextTarget(thresholds, current) {
  const value = finitePositive(current) || 0;
  return thresholds.find(target => target > value) || null;
}

async function main() {
  const now = Date.now();
  const existing = await readJson(OUTPUT_FILE);
  const currentCommitCount = Number(git(['rev-list', '--count', 'HEAD'])) || 0;
  const effectiveCommitCount = currentCommitCount + (hasFlag('--project-next-commit') ? 1 : 0);
  const force = hasFlag('--force');
  const cadence = milestoneCatalogCadence({
    generatedAt: existing?.generatedAt,
    generatedAtCommitCount: existing?.generatedAtCommitCount,
    now,
    commitCount: effectiveCommitCount,
    force
  });

  if (!cadence.due) {
    console.log(`Milestone catalog is fresh (${cadence.ageDays.toFixed(1)} days, ${cadence.commitGap} commits); skipping`);
    return;
  }

  let values;
  try {
    values = await liveMilestoneValues(now);
  } catch (error) {
    if (existing) {
      console.warn(`Milestone catalog refresh deferred: ${error.message}`);
      return;
    }
    throw error;
  }

  const tracks = {};
  for (const trackId of Object.keys(MILESTONE_BASE_THRESHOLDS)) {
    const current = finitePositive(values[trackId]);
    const thresholds = extendMilestoneThresholds(trackId, current);
    tracks[trackId] = {
      current,
      nextTarget: nextTarget(thresholds, current),
      thresholds
    };
  }

  const payload = {
    schema: MILESTONE_CATALOG_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    generatedAtCommit: git(['rev-parse', '--short', 'HEAD']),
    generatedAtCommitCount: effectiveCommitCount,
    cadence: {
      days: MILESTONE_REFRESH_DAYS,
      commits: MILESTONE_REFRESH_COMMITS
    },
    source: 'TzKT mainnet snapshot',
    tracks
  };

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote data/milestone-catalog.json at commit count ${effectiveCommitCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
