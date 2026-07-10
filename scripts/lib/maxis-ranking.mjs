import { compareCodePoint, compareRanked, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';

export { compareCodePoint, compareRanked, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';
export { compileContractCoverage, validateMaxisConfig } from './maxis-coverage-v2.mjs';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function latestIso(left, right) {
  const leftTime = Date.parse(left || '') || 0;
  const rightTime = Date.parse(right || '') || 0;
  return leftTime >= rightTime ? left || right || null : right || left || null;
}

function alias(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function rankAccounts(rows = []) {
  return rows
    .filter((row) => isImplicitAddress(row?.address) && number(row?.numTransactions) > 0)
    .map((row) => ({
      address: row.address,
      alias: alias(row.alias),
      score: number(row.numTransactions),
      transactions: number(row.numTransactions),
      lastActivity: isoTime(row.lastActivityTime)
    }))
    .sort((left, right) => compareRanked(left, right, [
      { value: 'transactions' },
      { value: (item) => Date.parse(item.lastActivity || '') || 0 }
    ]));
}

export function rankDelegates(rows = [], mode = 'governance') {
  const ranked = rows
    .filter((row) => isImplicitAddress(row?.address))
    .map((row) => ({
      address: row.address,
      alias: alias(row.alias),
      ballots: number(row.numBallots),
      proposals: number(row.numProposals),
      governanceActions: number(row.numBallots) + number(row.numProposals),
      stakedBalance: number(row.stakedBalance),
      bakingPower: number(row.bakingPower),
      stakers: number(row.stakersCount),
      delegators: number(row.numDelegators),
      lastActivity: isoTime(row.lastActivityTime)
    }));

  if (mode === 'staking') {
    return ranked
      .filter((row) => row.stakedBalance > 0)
      .map((row) => ({ ...row, score: row.stakedBalance }))
      .sort((left, right) => compareRanked(left, right, [
        { value: 'stakedBalance' },
        { value: 'bakingPower' },
        { value: (item) => Date.parse(item.lastActivity || '') || 0 }
      ]));
  }

  return ranked
    .filter((row) => row.governanceActions > 0)
    .map((row) => ({ ...row, score: row.governanceActions }))
    .sort((left, right) => compareRanked(left, right, [
      { value: 'governanceActions' },
      { value: 'ballots' },
      { value: (item) => Date.parse(item.lastActivity || '') || 0 }
    ]));
}

export function rankSalesStats(rows = [], type) {
  const byAddress = new Map();
  for (const row of rows) {
    if (row?.type !== type || !isImplicitAddress(row?.subject_address)) continue;
    if (row?.subject?.flag && row.subject.flag !== 'none') continue;
    const volume = number(row.volume);
    if (volume <= 0) continue;
    const current = byAddress.get(row.subject_address);
    if (current && current.volume >= volume) continue;
    byAddress.set(row.subject_address, {
      address: row.subject_address,
      alias: alias(row.subject?.tzdomain || row.subject?.alias),
      score: volume,
      volume,
      rank: number(row.rank) || null,
      intervalDays: number(row.interval_days) || null
    });
  }
  return [...byAddress.values()].sort((left, right) => compareRanked(left, right, [
    { value: 'volume' },
    { value: (item) => item.rank || Number.MAX_SAFE_INTEGER, direction: 'asc' }
  ]));
}

export function rankMints(rows = []) {
  const byAddress = new Map();
  for (const row of rows) {
    const address = row?.creator_address;
    if (!isImplicitAddress(address) || row?.creator?.flag && row.creator.flag !== 'none') continue;
    const current = byAddress.get(address) || {
      address,
      alias: alias(row?.creator?.tzdomain || row?.creator?.alias),
      tokenKeys: new Set(),
      operations: new Set(),
      editions: 0,
      lastActivity: null
    };
    current.alias ||= alias(row?.creator?.tzdomain || row?.creator?.alias);
    if (row?.token_pk != null) current.tokenKeys.add(String(row.token_pk));
    if (row?.ophash) current.operations.add(row.ophash);
    current.editions += Math.max(0, number(row?.amount));
    current.lastActivity = latestIso(current.lastActivity, isoTime(row?.timestamp));
    byAddress.set(address, current);
  }

  return [...byAddress.values()]
    .map((row) => ({
      address: row.address,
      alias: row.alias,
      score: row.tokenKeys.size,
      tokens: row.tokenKeys.size,
      mintOperations: row.operations.size,
      editions: row.editions,
      lastActivity: row.lastActivity
    }))
    .filter((row) => row.tokens > 0)
    .sort((left, right) => compareRanked(left, right, [
      { value: 'tokens' },
      { value: 'mintOperations' },
      { value: (item) => Date.parse(item.lastActivity || '') || 0 }
    ]));
}

export function rankAppActivity(rows = [], contractLookup = new Map()) {
  const byAddress = new Map();
  for (const row of rows) {
    if (row?.nonce != null) continue;
    const address = row?.sender?.address;
    if (!isImplicitAddress(address)) continue;
    const contract = row?.target?.address;
    const app = contractLookup.get(contract);
    if (!app) continue;
    const current = byAddress.get(address) || {
      address,
      alias: alias(row?.sender?.alias),
      apps: new Set(),
      contracts: new Set(),
      operations: new Set(),
      calls: 0,
      lastActivity: null
    };
    current.alias ||= alias(row?.sender?.alias);
    current.apps.add(app.id);
    current.contracts.add(contract);
    current.operations.add(`${row.hash || row.id || ''}:${row.counter ?? ''}:${contract}`);
    current.calls += 1;
    current.lastActivity = latestIso(current.lastActivity, isoTime(row?.timestamp));
    byAddress.set(address, current);
  }

  return [...byAddress.values()]
    .map((row) => ({
      address: row.address,
      alias: row.alias,
      score: row.apps.size,
      appCount: row.apps.size,
      apps: [...row.apps].sort(),
      contractCount: row.contracts.size,
      calls: row.operations.size || row.calls,
      lastActivity: row.lastActivity
    }))
    .filter((row) => row.appCount > 0)
    .sort((left, right) => compareRanked(left, right, [
      { value: 'appCount' },
      { value: 'calls' },
      { value: (item) => Date.parse(item.lastActivity || '') || 0 }
    ]));
}

export function rankUnicorn(categoryRows = {}, minimumBreadth = 3, scopeLimit = 100) {
  const candidates = new Map();
  for (const [category, rows] of Object.entries(categoryRows)) {
    const scoped = (rows || []).slice(0, Math.max(1, Number(scopeLimit) || 100));
    const denominator = Math.max(1, scoped.length);
    scoped.forEach((row, index) => {
      if (!isImplicitAddress(row?.address)) return;
      const current = candidates.get(row.address) || {
        address: row.address,
        alias: alias(row.alias),
        categories: [],
        points: 0,
        lastActivity: null
      };
      current.alias ||= alias(row.alias);
      current.categories.push({ category, rank: index + 1 });
      current.points += (denominator - index) / denominator;
      current.lastActivity = latestIso(current.lastActivity, row.lastActivity);
      candidates.set(row.address, current);
    });
  }

  return [...candidates.values()]
    .map((row) => ({
      ...row,
      breadth: row.categories.length,
      score: Number(row.points.toFixed(4))
    }))
    .filter((row) => row.breadth >= minimumBreadth)
    .sort((left, right) => compareRanked(left, right, [
      { value: 'breadth' },
      { value: 'points' },
      { value: (item) => Date.parse(item.lastActivity || '') || 0 }
    ]));
}
