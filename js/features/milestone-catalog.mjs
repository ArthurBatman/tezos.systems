export const MILESTONE_CATALOG_SCHEMA = 1;
export const MILESTONE_REFRESH_DAYS = 14;
export const MILESTONE_REFRESH_COMMITS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function range(start, end, step) {
  const values = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

export const MILESTONE_BASE_THRESHOLDS = Object.freeze({
  blocks: Object.freeze(range(1_000_000, 30_000_000, 1_000_000)),
  'funded-wallets': Object.freeze([1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 10_000_000]),
  transactions: Object.freeze([100_000_000, 250_000_000, 500_000_000, 750_000_000, 1_000_000_000]),
  'smart-contracts': Object.freeze([100_000, 250_000, 500_000, 1_000_000]),
  tokens: Object.freeze([1_000_000, 5_000_000, 10_000_000, 25_000_000]),
  bakers: Object.freeze([200, 250, 300, 400, 500]),
  'tz4-adoption': Object.freeze([10, 25, 50, 75, 90, 100]),
  staking: Object.freeze([30, 35, 40, 45, 50]),
  burned: Object.freeze([1_000_000, 2_000_000, 2_500_000, 3_000_000, 5_000_000, 10_000_000]),
  cycle: Object.freeze([...new Set([...range(1000, 2500, 100), 1250])].sort((a, b) => a - b)),
  'uptime-days': Object.freeze([1000, 1500, 2000, 2500, 3000, 3500]),
  'protocol-upgrades': Object.freeze([10, 20, 21, 25, 30]),
  rollups: Object.freeze([25, 50, 100, 250])
});

const EXTENSION_RULES = Object.freeze({
  blocks: { step: 1_000_000, ahead: 16 },
  'funded-wallets': { step: 5_000_000, ahead: 4 },
  transactions: { step: 250_000_000, ahead: 8 },
  'smart-contracts': { step: 250_000, ahead: 8 },
  tokens: { step: 5_000_000, ahead: 8 },
  bakers: { step: 100, ahead: 5 },
  burned: { step: 1_000_000, ahead: 8 },
  cycle: { step: 100, ahead: 8 },
  'uptime-days': { step: 500, ahead: 5 },
  'protocol-upgrades': { step: 5, ahead: 6 },
  rollups: { step: 50, ahead: 8 }
});

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function milestoneBaseThresholds(trackId) {
  return [...(MILESTONE_BASE_THRESHOLDS[trackId] || [])];
}

export function extendMilestoneThresholds(trackId, currentValue) {
  const thresholds = milestoneBaseThresholds(trackId);
  const rule = EXTENSION_RULES[trackId];
  if (!thresholds.length || !rule) return thresholds;

  const current = positiveNumber(currentValue) || 0;
  const baseMax = thresholds[thresholds.length - 1];
  const anchor = Math.max(baseMax, Math.ceil(current / rule.step) * rule.step);
  const desiredMax = anchor + (rule.step * rule.ahead);
  for (let target = baseMax + rule.step; target <= desiredMax; target += rule.step) {
    thresholds.push(target);
  }
  return thresholds;
}

export function generatedMilestoneThresholds(catalog, trackId) {
  if (!catalog || Number(catalog.schema) !== MILESTONE_CATALOG_SCHEMA) return [];
  const values = catalog.tracks?.[trackId]?.thresholds;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(positiveNumber).filter(value => value != null))].sort((a, b) => a - b);
}

export function mergedMilestoneThresholds(catalog, trackId) {
  return [...new Set([
    ...milestoneBaseThresholds(trackId),
    ...generatedMilestoneThresholds(catalog, trackId)
  ])].sort((a, b) => a - b);
}

export function cycleMilestoneStartLevel({
  currentCycle,
  currentCycleStartLevel,
  targetCycle,
  blocksPerCycle
} = {}) {
  const current = positiveNumber(currentCycle);
  const startLevel = positiveNumber(currentCycleStartLevel);
  const target = positiveNumber(targetCycle);
  const cycleLength = positiveNumber(blocksPerCycle);
  if (current == null || startLevel == null || target == null || cycleLength == null || target > current) return null;
  const level = startLevel - ((current - target) * cycleLength);
  return Number.isInteger(level) && level > 0 ? level : null;
}

export function generatedMilestoneAnchor(catalog, trackId) {
  if (!catalog || Number(catalog.schema) !== MILESTONE_CATALOG_SCHEMA) return null;
  const current = positiveNumber(catalog.tracks?.[trackId]?.current);
  const observedAt = Date.parse(catalog.generatedAt || '');
  if (current == null || !Number.isFinite(observedAt) || observedAt <= 0) return null;
  return { current, observedAt };
}

export function generatedMilestoneMoments(catalog, trackId, now = Date.now()) {
  if (!catalog || Number(catalog.schema) !== MILESTONE_CATALOG_SCHEMA) return [];
  const values = catalog.tracks?.[trackId]?.recentCrossings;
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => ({
      target: positiveNumber(entry?.target),
      createdAt: Number(entry?.createdAt || entry?.crossedAt),
      expiresAt: Number(entry?.expiresAt),
      crossedValue: positiveNumber(entry?.crossedValue) || positiveNumber(entry?.target)
    }))
    .filter(entry => entry.target != null
      && Number.isFinite(entry.createdAt)
      && entry.createdAt > 0
      && entry.createdAt <= now
      && Number.isFinite(entry.expiresAt)
      && entry.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt || b.target - a.target);
}

export function milestoneCatalogCadence({
  generatedAt,
  generatedAtCommitCount,
  now = Date.now(),
  commitCount = 0,
  force = false
} = {}) {
  const previousTime = Date.parse(generatedAt || '');
  const previousCommitCount = Number(generatedAtCommitCount);
  const ageDays = Number.isFinite(previousTime)
    ? Math.max(0, (Number(now) - previousTime) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  const commitGap = Number.isFinite(previousCommitCount)
    ? Math.max(0, Number(commitCount) - previousCommitCount)
    : Number.POSITIVE_INFINITY;
  return {
    due: force || ageDays >= MILESTONE_REFRESH_DAYS || commitGap >= MILESTONE_REFRESH_COMMITS,
    ageDays,
    commitGap
  };
}
