#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  addWeeks,
  contractUniverseHash,
  emptyMetric,
  mergeMetric,
  mergeResolvedContracts,
  pctChange,
  publicMetric,
  rankApps,
  retentionRate,
  stableHash,
  utcWeekStart,
  validateManifest
} from '../scripts/lib/ecosystem-stats.mjs';

const manifest = JSON.parse(await fs.readFile(new URL('../data/ecosystem-apps.json', import.meta.url), 'utf8'));
assert.deepEqual(validateManifest(manifest), [], 'reviewed app manifest should validate');
assert.equal(manifest.apps.length, 23, 'the launch universe should retain 23 disclosed apps');
assert(['objkt', 'fxhash', 'teia', 'tezos-domains', 'morpho-blue', 'oku-uniswap-v3', 'curve', 'hanji', 'iguanadex', 'etherlink-bridge']
  .every((id) => manifest.apps.some((app) => app.id === id)),
'the reviewed universe should retain representative L1, L2, NFT, identity, DeFi, and bridge apps');

assert.equal(utcWeekStart('2026-07-26T23:59:59Z').toISOString(), '2026-07-20T00:00:00.000Z');
assert.equal(utcWeekStart('2026-07-27T00:00:00Z').toISOString(), '2026-07-27T00:00:00.000Z');
assert.equal(addWeeks('2026-07-20T00:00:00Z', -52).toISOString(), '2025-07-21T00:00:00.000Z');
assert.equal(pctChange(150, 100), 50);
assert.equal(pctChange(0, 0), null);

const previous = new Set(['a', 'b', 'c', 'd']);
const current = new Set(['b', 'd', 'e']);
assert.equal(retentionRate(current, previous), 50);

const tezos = emptyMetric();
tezos.wallets.add('tz1-a');
tezos.operations.add('tezos:1');
tezos.operations.add('tezos:2');
const etherlink = emptyMetric();
etherlink.wallets.add('tz1-a');
etherlink.wallets.add('0x-b');
etherlink.operations.add('etherlink:0x1');
const combined = emptyMetric();
mergeMetric(combined, tezos, 'tezos:');
mergeMetric(combined, etherlink, 'etherlink:');
assert.deepEqual(publicMetric(combined), {
  activeWallets: 3,
  interactions: 3,
  callsPerWallet: 1,
  returningWalletRate: null
}, 'cross-layer totals should preserve source-native wallet identities');

const apps = Array.from({ length: 10 }, (_, index) => ({
  id: `app-${index}`,
  name: `App ${index}`,
  category: 'fixture',
  layers: [{ id: index === 9 ? 'etherlink' : 'tezos' }],
  weekly: [{
    weekStart: '2026-07-13T00:00:00.000Z',
    status: 'complete',
    all: { activeWallets: index + 1, interactions: index + 2 },
    layers: {
      tezos: index === 9 ? { status: 'not-tracked' } : { status: 'complete', activeWallets: index + 1, interactions: index + 2 },
      etherlink: index === 9 ? { status: 'complete', activeWallets: index + 1, interactions: index + 2 } : { status: 'not-tracked' }
    }
  }],
  summary: {
    weekStart: '2026-07-13T00:00:00.000Z',
    activeWallets: index + 1,
    interactions: index + 2
  }
}));
const ranking = rankApps(apps);
assert.equal(ranking[0].id, 'app-9');
assert.equal(ranking[0].rank, 1);
assert.equal(rankApps(apps, 'etherlink').length, 1);
assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
assert.equal(
  contractUniverseHash([{ id: 'app', layers: [{ id: 'tezos', contracts: [{ address: 'KT1B' }, { address: 'KT1A' }] }] }]),
  contractUniverseHash([{ id: 'app', layers: [{ id: 'tezos', contracts: [{ address: 'kt1a' }, { address: 'kt1b' }] }] }]),
  'contract-universe receipts should be address-order and case independent'
);

const mergedContracts = mergeResolvedContracts([
  { address: 'KT1Current', alias: 'Current alias', lastActivityTime: '2026-08-07T12:00:00Z' },
  { address: 'KT1New', alias: 'New alias', lastActivityTime: '2026-08-07T11:00:00Z' }
], [
  { address: 'kt1current', alias: 'Stale alias', lastActivityTime: '2026-07-25T12:00:00Z' },
  { address: 'KT1Retained', alias: 'Historical alias', lastActivityTime: '2025-01-01T00:00:00Z' }
]);
assert.equal(mergedContracts.length, 3, 'previously resolved addresses should remain append-only');
assert.equal(
  mergedContracts.find((contract) => contract.address.toLowerCase() === 'kt1current')?.lastActivityTime,
  '2026-08-07T12:00:00Z',
  'fresh TzKT contract metadata should replace the previous snapshot receipt'
);
assert(mergedContracts.some((contract) => contract.address === 'KT1Retained'), 'historical aliases should remain retained');

console.log('ok - ecosystem stats boundaries, identity model, retention, ranking, contract receipts, and manifest');
