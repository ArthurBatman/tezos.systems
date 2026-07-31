#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseRadarSignal,
  normalizeReleaseRadarSnapshot,
  RELEASE_RADAR_TEZOS_X_GATES
} from '../js/core/release-radar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (file) => fs.readFile(path.join(ROOT, file), 'utf8');

const raw = JSON.parse(await readText('data/release-radar.json'));
const reviewedNow = Date.parse(raw.updatedAt) + 60 * 60 * 1000;
const snapshot = normalizeReleaseRadarSnapshot(raw, { now: reviewedNow });
const signal = buildReleaseRadarSignal(snapshot, { now: reviewedNow });

assert.equal(snapshot.candidates.length, 3, 'Release Radar keeps Tezos X, Octez, and EVM node lanes separate');
const tezosX = snapshot.candidates.find((candidate) => candidate.kind === 'tezos_x_launch');
const octez = snapshot.candidates.find((candidate) => candidate.kind === 'octez_release');
const evmNode = snapshot.candidates.find((candidate) => candidate.kind === 'evm_node_release');
assert.deepEqual(tezosX.gates.map((gate) => gate.id), RELEASE_RADAR_TEZOS_X_GATES, 'Tezos X keeps the canonical six-gate dependency order');
assert.equal(tezosX.gates.find((gate) => gate.id === 'proposal')?.status, 'not_started', 'mainnet proposal remains an explicit independent blocker');
assert.equal(octez.confidence, 'low', 'backport activity alone remains low confidence');
assert.equal(evmNode.lifecycle, 'released', 'the direct 0.64 tag is a confirmed release, not a forecast');
assert.equal(evmNode.excitement, 'high', 'the explicit Previewnet dependency is highlighted');
assert.equal(signal.id, 'release-radar');
assert.equal(signal.kind, 'state', 'the aggregate forecast does not decay like a one-off event');
assert(signal.score >= 170 && signal.releaseRadar.excitingCandidateId === evmNode.id, 'the reviewed exciting release leads normal Pulse signals without a fake completion percentage');
assert.equal(signal.releaseRadar.stale, false, 'fresh reviewed data is not mislabeled stale');

const staleSignal = buildReleaseRadarSignal(snapshot, {
  now: snapshot.staleAtMs + 1,
  sourceState: 'fresh'
});
assert.equal(staleSignal.releaseRadar.stale, true, 'old forecast receipts are visibly stale even when the request succeeds');
assert.equal(buildReleaseRadarSignal(snapshot, { now: snapshot.expiresAtMs + 1 }), null, 'expired snapshots leave the ephemeral Pulse card');

const missingGate = structuredClone(raw);
missingGate.candidates[0].gates.pop();
assert.throws(
  () => normalizeReleaseRadarSnapshot(missingGate, { now: reviewedNow }),
  /all six Tezos X gates separate/,
  'Tezos X cannot collapse dependency gates'
);

const fakeHorizon = structuredClone(raw);
fakeHorizon.candidates[1].confidence = 'none';
assert.throws(
  () => normalizeReleaseRadarSnapshot(fakeHorizon, { now: reviewedNow }),
  /cannot publish a horizon without confidence/,
  'no-signal candidates cannot retain an ETA'
);

const reorderedGates = structuredClone(raw);
[reorderedGates.candidates[0].gates[0], reorderedGates.candidates[0].gates[1]] = [
  reorderedGates.candidates[0].gates[1],
  reorderedGates.candidates[0].gates[0]
];
assert.throws(
  () => normalizeReleaseRadarSnapshot(reorderedGates, { now: reviewedNow }),
  /all six Tezos X gates separate/,
  'Tezos X gate receipts cannot reorder the dependency model'
);

const unsafeRoute = structuredClone(raw);
unsafeRoute.candidates[1].route = 'javascript:alert(1)';
assert.throws(
  () => normalizeReleaseRadarSnapshot(unsafeRoute, { now: reviewedNow }),
  /root-relative or use HTTPS/,
  'release evidence cannot introduce an unsafe navigation scheme'
);

const noSignalRaw = structuredClone(raw);
for (const candidate of noSignalRaw.candidates) {
  candidate.lifecycle = 'no_signal';
  candidate.confidence = 'none';
  candidate.horizon = '';
  candidate.releasedAt = '';
}
const noSignal = buildReleaseRadarSignal(
  normalizeReleaseRadarSnapshot(noSignalRaw, { now: reviewedNow }),
  { now: reviewedNow }
);
assert.equal(noSignal.releaseRadar.noCredibleSignal, true, 'an all-none receipt renders the explicit no-credible-signal state');

const [briefing, css, dataAssets] = await Promise.all([
  readText('js/features/daily-briefing.js'),
  readText('css/shell-extras.css'),
  readText('js/core/data-assets.js')
]);
for (const snippet of [
  "loadDataAsset('releaseRadar'",
  "document.visibilityState !== 'visible'",
  'releaseRadarSignals()',
  'detailsWasOpen',
  'quietlySyncHtml(content, islandHtml)',
  'FORECAST STALE',
  'No credible near-term release signal detected',
  'No percentage implied'
]) {
  assert(briefing.includes(snippet), `Release Radar Live Pulse contract is missing ${snippet}`);
}
assert(dataAssets.includes("releaseRadar: '/data/release-radar.json'"), 'Release Radar must load as a same-origin no-store data asset');
for (const snippet of [
  '.hot-today-card.hot-today-card-release',
  '.release-radar-gate-grid',
  '.release-radar-candidate.is-exciting',
  '.release-radar-details',
  '[data-quiet-refresh-settled="true"] .hot-today-card',
  '@media (max-width: 720px)'
]) {
  assert(css.includes(snippet), `Release Radar responsive presentation is missing ${snippet}`);
}

console.log('ok - Release Radar data, dependency, freshness, priority, and rendering contracts');
