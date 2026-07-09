const TEZOS_IMPLICIT_ADDRESS = /^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/;

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

export function isImplicitAddress(value) {
  return TEZOS_IMPLICIT_ADDRESS.test(String(value || ''));
}

export function compareRanked(left, right, fields) {
  for (const field of fields) {
    const direction = field.direction === 'asc' ? 1 : -1;
    const leftValue = typeof field.value === 'function' ? field.value(left) : left[field.value];
    const rightValue = typeof field.value === 'function' ? field.value(right) : right[field.value];
    if (leftValue === rightValue) continue;
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return String(leftValue || '').localeCompare(String(rightValue || '')) * direction;
    }
    return (number(leftValue) - number(rightValue)) * direction;
  }
  return String(left.address || '').localeCompare(String(right.address || ''));
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

export function compileContractCoverage(contracts = [], apps = [], fromIso = null) {
  const from = Date.parse(fromIso || '') || 0;
  const coverage = [];
  const seen = new Set();
  for (const contract of contracts) {
    if (!contract?.address || !contract?.alias) continue;
    if (from && (Date.parse(contract.lastActivityTime || '') || 0) < from) continue;
    const matches = apps.filter((app) => (app.aliasPatterns || []).some((pattern) => new RegExp(pattern, 'i').test(contract.alias)));
    for (const app of matches) {
      const key = `${app.category}:${contract.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({
        address: contract.address,
        alias: contract.alias,
        lastActivityTime: isoTime(contract.lastActivityTime),
        app: { id: app.id, label: app.label, category: app.category }
      });
    }
  }
  return coverage.sort((left, right) => left.address.localeCompare(right.address));
}

export function validateMaxisConfig(config) {
  const errors = [];
  if (number(config?.schema) !== 1) errors.push('schema must be 1');
  if (number(config?.windowDays) < 1) errors.push('windowDays must be positive');
  const ids = new Set();
  for (const app of config?.apps || []) {
    if (!app?.id || !app?.label || !['defi', 'gaming'].includes(app?.category)) {
      errors.push(`invalid app entry ${app?.id || '<missing id>'}`);
      continue;
    }
    if (ids.has(app.id)) errors.push(`duplicate app id ${app.id}`);
    ids.add(app.id);
    if (!Array.isArray(app.aliasPatterns) || !app.aliasPatterns.length) errors.push(`missing alias patterns for ${app.id}`);
    for (const pattern of app.aliasPatterns || []) {
      try {
        new RegExp(pattern, 'i');
      } catch {
        errors.push(`invalid alias pattern for ${app.id}: ${pattern}`);
      }
    }
  }
  return errors;
}
