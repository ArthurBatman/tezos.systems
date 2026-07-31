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
  cycleMilestoneStartLevel,
  extendMilestoneThresholds,
  generatedMilestoneMoments,
  milestoneCatalogCadence
} from '../js/features/milestone-catalog.mjs';
import { deriveMilestoneMoments, MILESTONE_MOMENT_TTL_MS } from '../js/features/milestone-lifecycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = path.join(ROOT, 'data/milestone-catalog.json');
const TZKT = 'https://api.tzkt.io/v1';
const OCTEZ = 'https://eu.rpc.tez.capital';
const OCTEZ_ARCHIVE = 'https://tezos-mainnet.octez.io';
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

async function fetchJson(baseUrl, pathname, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
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
  const header = await fetchJson(OCTEZ, '/chains/main/blocks/head/header');
  const headId = encodeURIComponent(header?.hash || 'head');
  const [metadata, constants] = await Promise.all([
    fetchJson(OCTEZ, `/chains/main/blocks/${headId}/metadata`),
    fetchJson(OCTEZ, `/chains/main/blocks/${headId}/context/constants`)
  ]);
  const [statsResult, txResult, accountsResult, contractsResult, tokensResult, rollupsResult, bakersResult] = await Promise.allSettled([
    fetchJson(TZKT, '/statistics/current'),
    fetchJson(TZKT, '/operations/transactions/count'),
    fetchJson(TZKT, '/accounts/count?balance.gt=0'),
    fetchJson(TZKT, '/contracts/count'),
    fetchJson(TZKT, '/tokens/count'),
    fetchJson(TZKT, '/smart_rollups/count'),
    fetchJson(TZKT, '/delegates?active=true&select=address,consensusAddress,bakingPower&limit=10000')
  ]);

  const stats = valueFrom(statsResult);
  const levelInfo = metadata?.level_info || {};
  const currentLevel = finitePositive(header?.level);
  const currentCycle = finitePositive(levelInfo.cycle);
  const cyclePosition = Number(levelInfo.cycle_position);
  const blocksPerCycle = finitePositive(constants?.blocks_per_cycle);
  if (!currentLevel || !currentCycle || !Number.isFinite(cyclePosition) || cyclePosition < 0 || !blocksPerCycle || !stats) {
    throw new Error('Milestone catalog refresh needs an Octez head/cycle and TzKT statistics/current');
  }

  const bakers = bakerSnapshot(valueFrom(bakersResult));
  const protocolData = await readJson(path.join(ROOT, 'data/protocol-data.json'), {});
  return {
    values: {
      blocks: currentLevel,
      'funded-wallets': finitePositive(valueFrom(accountsResult)),
      transactions: finitePositive(valueFrom(txResult)),
      'smart-contracts': finitePositive(valueFrom(contractsResult)),
      tokens: finitePositive(valueFrom(tokensResult)),
      bakers: bakers.total || finitePositive(stats.totalBakers),
      'tz4-adoption': bakers.tz4Percentage,
      staking: stakingRatio(stats),
      burned: finitePositive(stats.totalBurned) ? Number(stats.totalBurned) / 1e6 : null,
      cycle: currentCycle,
      'uptime-days': Math.floor((now - MAINNET_START) / DAY_MS),
      'protocol-upgrades': finitePositive(protocolData?.meta?.totalUpgrades),
      rollups: finitePositive(valueFrom(rollupsResult))
    },
    cycleGeometry: {
      currentCycle,
      currentCycleStartLevel: currentLevel - cyclePosition,
      blocksPerCycle
    }
  };
}

function nextTarget(thresholds, current) {
  const value = finitePositive(current) || 0;
  return thresholds.find(target => target > value) || null;
}

async function exactCycleMilestoneMoment(geometry, thresholds, now) {
  const current = finitePositive(geometry?.currentCycle);
  const target = [...thresholds].reverse().find(value => value <= current);
  if (!current || !target) return null;
  const targetLevel = cycleMilestoneStartLevel({
    currentCycle: current,
    currentCycleStartLevel: geometry?.currentCycleStartLevel,
    targetCycle: target,
    blocksPerCycle: geometry?.blocksPerCycle
  });
  if (!targetLevel) return null;
  const headerPath = `/chains/main/blocks/${targetLevel}/header`;
  let header;
  try {
    header = await fetchJson(OCTEZ, headerPath);
  } catch {
    header = await fetchJson(OCTEZ_ARCHIVE, headerPath);
  }
  const createdAt = Date.parse(header?.timestamp || '');
  if (Number(header?.level) !== Number(targetLevel) || !Number.isFinite(createdAt)) return null;
  const moment = {
    target,
    createdAt,
    expiresAt: createdAt + MILESTONE_MOMENT_TTL_MS,
    crossedValue: current
  };
  return moment.createdAt <= now && moment.expiresAt > now ? moment : null;
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

  let snapshot;
  try {
    snapshot = await liveMilestoneValues(now);
  } catch (error) {
    if (existing) {
      console.warn(`Milestone catalog refresh deferred: ${error.message}`);
      return;
    }
    throw error;
  }

  const { values, cycleGeometry } = snapshot;
  const cycleThresholds = extendMilestoneThresholds('cycle', values.cycle);
  const exactCycleMoment = await exactCycleMilestoneMoment(cycleGeometry, cycleThresholds, now);
  const tracks = {};
  for (const trackId of Object.keys(MILESTONE_BASE_THRESHOLDS)) {
    const current = finitePositive(values[trackId]);
    const thresholds = extendMilestoneThresholds(trackId, current);
    const recentCrossings = deriveMilestoneMoments({
      currentValue: current,
      thresholds,
      now,
      ttlMs: MILESTONE_MOMENT_TTL_MS,
      anchorValue: existing?.tracks?.[trackId]?.current,
      anchorObservedAt: Date.parse(existing?.generatedAt || ''),
      receipts: [
        ...generatedMilestoneMoments(existing, trackId, now),
        ...(trackId === 'cycle' && exactCycleMoment ? [exactCycleMoment] : [])
      ]
    });
    tracks[trackId] = {
      current,
      nextTarget: nextTarget(thresholds, current),
      thresholds,
      recentCrossings
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
    source: 'Octez mainnet head and cycle with TzKT indexed statistics',
    tracks
  };

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote data/milestone-catalog.json at commit count ${effectiveCommitCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
