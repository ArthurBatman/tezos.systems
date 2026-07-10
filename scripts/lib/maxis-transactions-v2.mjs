import { compareCodePoint, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';

export const TRANSACTION_STATE_SCHEMA = 1;
export const TRANSACTION_STATE_VERSION = 'maxis-transactions-v2';
export const TRANSACTION_REPLAY_LEVELS = 128;

function integer(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(normalized)) throw new Error(`${label} must be an unsigned integer`);
  return BigInt(normalized);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value, label) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function rawAddressEntry(source = {}) {
  return {
    transactions: Math.max(0, Math.trunc(number(source.transactions))),
    activeDays: new Set(source.activeDays || []),
    activeWeeks: new Set((source.activeWeeks || []).map(Number).filter(Number.isInteger)),
    lastActivity: source.lastActivity || null,
    alias: String(source.alias || '').trim() || null,
    aliasObservedAt: source.aliasObservedAt || null
  };
}

function weekOf(timestamp, activatedAt) {
  const time = Date.parse(timestamp);
  const start = Date.parse(activatedAt);
  if (!Number.isFinite(time) || !Number.isFinite(start) || time < start) return null;
  return Math.floor((time - start) / (7 * 86400000)) + 1;
}

function later(left, right) {
  return Date.parse(left || '') >= Date.parse(right || '') ? left || right || null : right || left || null;
}

function addEligible(byAddress, address, timestamp, activatedAt, alias = null) {
  const current = byAddress.get(address) || rawAddressEntry();
  current.transactions += 1;
  current.activeDays.add(timestamp.slice(0, 10));
  const week = weekOf(timestamp, activatedAt);
  if (week != null) current.activeWeeks.add(week);
  current.lastActivity = later(current.lastActivity, timestamp);
  const cleanAlias = String(alias || '').trim() || null;
  if (cleanAlias && (!current.aliasObservedAt || Date.parse(timestamp) >= Date.parse(current.aliasObservedAt))) {
    current.alias = cleanAlias;
    current.aliasObservedAt = timestamp;
  }
  byAddress.set(address, current);
}

function sortedAddressObject(byAddress) {
  return Object.fromEntries([...byAddress.entries()]
    .sort(([left], [right]) => compareCodePoint(left, right))
    .map(([address, value]) => [address, {
      transactions: value.transactions,
      activeDays: [...value.activeDays].sort(compareCodePoint),
      activeWeeks: [...value.activeWeeks].sort((left, right) => left - right),
      lastActivity: value.lastActivity,
      alias: value.alias,
      aliasObservedAt: value.aliasObservedAt
    }]));
}

function hydrateAddressMap(value = {}) {
  return new Map(Object.entries(value).map(([address, entry]) => [address, rawAddressEntry(entry)]));
}

function targetIdentity(target) {
  return JSON.stringify({
    levelExclusive: Number(target.levelExclusive),
    throughExclusive: iso(target.throughExclusive, 'transaction target throughExclusive'),
    boundaryLevel: Number(target.boundaryLevel),
    boundaryHash: String(target.boundaryHash || ''),
    boundaryTimestamp: iso(target.boundaryTimestamp, 'transaction target boundaryTimestamp'),
    mode: String(target.mode || '')
  });
}

function normalizedTarget(target) {
  const normalized = {
    levelExclusive: Number(target?.levelExclusive),
    throughExclusive: iso(target?.throughExclusive, 'transaction target throughExclusive'),
    boundaryLevel: Number(target?.boundaryLevel),
    boundaryHash: String(target?.boundaryHash || ''),
    boundaryTimestamp: iso(target?.boundaryTimestamp, 'transaction target boundaryTimestamp'),
    mode: String(target?.mode || '')
  };
  if (!Number.isInteger(normalized.levelExclusive) || normalized.levelExclusive <= 0) throw new Error('transaction target levelExclusive must be positive');
  if (normalized.boundaryLevel !== normalized.levelExclusive - 1) throw new Error('transaction target boundary must be levelExclusive - 1');
  if (!normalized.boundaryHash) throw new Error('transaction target boundary hash is required');
  if (!['confirmed-active', 'exact-close'].includes(normalized.mode)) throw new Error('transaction target mode is invalid');
  if (Date.parse(normalized.throughExclusive) <= Date.parse(normalized.boundaryTimestamp)) throw new Error('transaction target throughExclusive must be later than its boundary block');
  return normalized;
}

function emptyBase(season) {
  return {
    throughLevelInclusive: Number(season.activationLevel) - 1,
    lastId: '0',
    scannedRows: 0,
    eligibleRows: 0,
    byAddress: new Map()
  };
}

function baseFromDocument(document) {
  return {
    throughLevelInclusive: Number(document.base.throughLevelInclusive),
    lastId: String(document.base.lastId),
    scannedRows: Number(document.base.scannedRows),
    eligibleRows: Number(document.base.eligibleRows),
    byAddress: hydrateAddressMap(document.base.byAddress)
  };
}

function serializeBase(base) {
  return {
    throughLevelInclusive: base.throughLevelInclusive,
    lastId: base.lastId,
    scannedRows: base.scannedRows,
    eligibleRows: base.eligibleRows,
    byAddress: sortedAddressObject(base.byAddress)
  };
}

function transactionRow(row) {
  const nonce = row?.nonce == null ? null : Number(row.nonce);
  if (nonce != null && (!Number.isInteger(nonce) || nonce < 0)) throw new Error('transaction nonce must be null or a non-negative integer');
  return {
    id: String(integer(row?.id, 'transaction id')),
    level: Number(row?.level),
    timestamp: iso(row?.timestamp, 'transaction timestamp'),
    nonce,
    status: String(row?.status || ''),
    sender: String(row?.sender?.address || row?.sender || ''),
    senderAlias: String(row?.sender?.alias || row?.senderAlias || '').trim() || null
  };
}

function stateCounts(state) {
  const combined = hydrateAddressMap(sortedAddressObject(state.base.byAddress));
  let tailEligible = 0;
  for (const row of state.tailRows) {
    if (row.status !== 'applied' || row.nonce != null || !isImplicitAddress(row.sender)) continue;
    addEligible(combined, row.sender, row.timestamp, state.season.activatedAt, row.senderAlias);
    tailEligible += 1;
  }
  return {
    scannedRows: state.base.scannedRows + state.tailRows.length,
    eligibleRows: state.base.eligibleRows + tailEligible,
    addresses: combined.size,
    byAddress: combined
  };
}

export function createTransactionScanState({ season, rules, document = null }) {
  if (!season?.id || !season?.protocolHash || !Number(season?.activationLevel) || !season?.activatedAt) {
    throw new Error('transaction state requires complete season identity');
  }
  if (!rules?.evaluatorVersion || !rules?.rulesHash) throw new Error('transaction state requires frozen evaluator and rules identity');
  if (!document) return {
    season: {
      id: season.id,
      protocolHash: season.protocolHash,
      activationLevel: Number(season.activationLevel),
      activatedAt: iso(season.activatedAt, 'season activatedAt')
    },
    rules: { evaluatorVersion: rules.evaluatorVersion, rulesHash: rules.rulesHash },
    status: 'idle',
    base: emptyBase(season),
    completedTail: null,
    boundary: null,
    scan: null,
    tailRows: []
  };
  const errors = validateTransactionAccumulator(document, { allowBuilding: true });
  if (errors.length) throw new Error(`Invalid transaction accumulator: ${errors.join('; ')}`);
  if (
    document.season.id !== season.id
    || document.season.protocolHash !== season.protocolHash
    || Number(document.season.activationLevel) !== Number(season.activationLevel)
    || document.rules?.evaluatorVersion !== rules.evaluatorVersion
    || document.rules?.rulesHash !== rules.rulesHash
  ) throw new Error('transaction accumulator belongs to another season');
  return {
    season: { ...document.season },
    rules: { ...document.rules },
    status: document.status,
    base: baseFromDocument(document),
    completedTail: document.status === 'complete' ? { ...document.tail, rows: document.tail.rows.map(transactionRow) } : null,
    boundary: document.status === 'complete' ? { ...document.boundary } : null,
    scan: document.status === 'building' ? { ...document.scan, target: normalizedTarget(document.scan.target) } : null,
    tailRows: document.tail?.rows?.map(transactionRow) || []
  };
}

export function beginTransactionScan(state, target, { fullReplay = false } = {}) {
  const normalized = normalizedTarget(target);
  if (state.status === 'building') {
    if (fullReplay) {
      state.status = 'idle';
      state.base = emptyBase(state.season);
      state.completedTail = null;
      state.boundary = null;
      state.scan = null;
      state.tailRows = [];
    } else {
    if (targetIdentity(state.scan.target) !== targetIdentity(normalized)) {
      throw new Error('transaction accumulator must finish its frozen pending target before advancing');
    }
    return state;
    }
  }
  if (state.boundary && normalized.levelExclusive < Number(state.boundary.levelExclusive)) {
    throw new Error('transaction accumulator boundary cannot move backwards');
  }
  const priorBase = fullReplay || !state.completedTail ? emptyBase(state.season) : state.base;
  const scanStartLevel = fullReplay || !state.completedTail
    ? state.season.activationLevel
    : Number(state.completedTail.startLevel);
  const cursorBefore = fullReplay || !state.completedTail
    ? '0'
    : String(state.completedTail.cursorBefore);
  const newTailStart = Math.max(state.season.activationLevel, normalized.levelExclusive - TRANSACTION_REPLAY_LEVELS);
  state.status = 'building';
  state.base = priorBase;
  state.completedTail = null;
  state.boundary = null;
  state.tailRows = [];
  state.scan = {
    target: normalized,
    fullReplay: Boolean(fullReplay),
    startLevel: scanStartLevel,
    tailStartLevel: newTailStart,
    cursorLastId: cursorBefore,
    baseScannedRowsBefore: priorBase.scannedRows,
    baseEligibleRowsBefore: priorBase.eligibleRows,
    baseLastIdBefore: cursorBefore,
    pages: 0,
    fetchedRows: 0,
    terminalPageSize: null,
    requestedPageSize: null,
    exhausted: false
  };
  return state;
}

export function applyTransactionPage(state, rows = [], { pageSize } = {}) {
  if (state.status !== 'building' || !state.scan) throw new Error('transaction scan is not building');
  let previousId = integer(state.scan.cursorLastId, 'transaction cursor');
  const target = state.scan.target;
  for (const input of rows) {
    const row = transactionRow(input);
    const id = integer(row.id, 'transaction id');
    if (id <= previousId) throw new Error(`transaction cursor must increase strictly: ${id} followed ${previousId}`);
    if (!Number.isInteger(row.level) || row.level < state.scan.startLevel || row.level >= target.levelExclusive) {
      throw new Error(`transaction ${row.id} is outside frozen level boundary`);
    }
    if (Date.parse(row.timestamp) >= Date.parse(target.throughExclusive)) {
      throw new Error(`transaction ${row.id} is outside frozen time boundary`);
    }
    if (row.status !== 'applied') throw new Error(`transaction ${row.id} is not client-verified applied`);
    if (row.level < state.scan.tailStartLevel) {
      state.base.scannedRows += 1;
      state.base.lastId = row.id;
      if (row.nonce == null && isImplicitAddress(row.sender)) {
        addEligible(state.base.byAddress, row.sender, row.timestamp, state.season.activatedAt, row.senderAlias);
        state.base.eligibleRows += 1;
      }
    } else {
      state.tailRows.push(row);
    }
    previousId = id;
    state.scan.cursorLastId = row.id;
    state.scan.fetchedRows += 1;
  }
  state.scan.pages += 1;
  state.scan.terminalPageSize = rows.length;
  state.scan.requestedPageSize = Number(pageSize);
  state.scan.exhausted = Number.isInteger(Number(pageSize)) && rows.length < Number(pageSize);
  return state;
}

export function completeTransactionScan(state, { expectedRawCount } = {}) {
  if (state.status !== 'building' || !state.scan) throw new Error('transaction scan is not building');
  const counts = stateCounts(state);
  if (state.scan.exhausted !== true) throw new Error('transaction scan cannot complete without a terminal short or empty page');
  if (!Number.isInteger(Number(expectedRawCount)) || Number(expectedRawCount) < 0) throw new Error('transaction scan requires a valid full-range raw count');
  if (counts.scannedRows !== Number(expectedRawCount)) throw new Error(`transaction scan count mismatch: ${counts.scannedRows}/${expectedRawCount}`);
  const target = state.scan.target;
  const tail = {
    startLevel: state.scan.tailStartLevel,
    cursorBefore: state.base.lastId,
    lastId: state.scan.cursorLastId,
    rows: state.tailRows
  };
  state.base.throughLevelInclusive = state.scan.tailStartLevel - 1;
  state.status = 'complete';
  state.completedTail = tail;
  state.boundary = {
    ...target,
    cursorLastId: state.scan.cursorLastId,
    expectedRawCount: Number(expectedRawCount),
    exhaustion: {
      terminalPageSize: state.scan.terminalPageSize,
      requestedPageSize: state.scan.requestedPageSize,
      terminalCursor: state.scan.cursorLastId
    },
    clientFilters: {
      status: 'applied',
      nonce: 'null top-level only',
      sender: 'implicit tz1/tz2/tz3/tz4 only'
    }
  };
  state.scan = null;
  return { state, counts };
}

export function serializeTransactionAccumulator(state) {
  const common = {
    schema: TRANSACTION_STATE_SCHEMA,
    version: TRANSACTION_STATE_VERSION,
    season: { ...state.season },
    rules: { ...state.rules },
    status: state.status,
    base: serializeBase(state.base)
  };
  if (state.status === 'building') return {
    ...common,
    scan: { ...state.scan, target: { ...state.scan.target } },
    tail: { rows: state.tailRows }
  };
  if (state.status !== 'complete' || !state.completedTail || !state.boundary) return common;
  const counts = stateCounts(state);
  return {
    ...common,
    boundary: { ...state.boundary },
    tail: { ...state.completedTail, rows: state.completedTail.rows },
    counts: {
      scannedRows: counts.scannedRows,
      eligibleRows: counts.eligibleRows,
      addresses: counts.addresses
    }
  };
}

export function transactionAccumulatorRows(document) {
  const state = createTransactionScanState({ season: document.season, rules: document.rules, document });
  if (state.status !== 'complete') throw new Error('transaction accumulator is not complete');
  const counts = stateCounts(state);
  return [...counts.byAddress.entries()].map(([address, entry]) => ({
    address,
    alias: entry.alias,
    transactions: entry.transactions,
    activeDays: entry.activeDays.size,
    activeWeeks: [...entry.activeWeeks].sort((left, right) => left - right),
    lastActivity: entry.lastActivity
  }));
}

export function validateTransactionAccumulator(document, { allowBuilding = false } = {}) {
  const errors = [];
  if (Number(document?.schema) !== TRANSACTION_STATE_SCHEMA) errors.push(`transaction state schema must be ${TRANSACTION_STATE_SCHEMA}`);
  if (document?.version !== TRANSACTION_STATE_VERSION) errors.push(`transaction state version must be ${TRANSACTION_STATE_VERSION}`);
  if (!document?.season?.id || !document?.season?.protocolHash || !Number(document?.season?.activationLevel)) errors.push('transaction state season identity is incomplete');
  if (!Number.isFinite(Date.parse(document?.season?.activatedAt || ''))) errors.push('transaction state season activatedAt is invalid');
  if (!document?.rules?.evaluatorVersion || !document?.rules?.rulesHash) errors.push('transaction state frozen rules identity is incomplete');
  if (!['building', 'complete'].includes(document?.status)) errors.push('transaction state status is invalid');
  if (document?.status === 'building' && !allowBuilding) errors.push('transaction state is incomplete');
  try { integer(document?.base?.lastId, 'base cursor'); } catch (error) { errors.push(error.message); }
  if (!document?.base?.byAddress || typeof document.base.byAddress !== 'object') errors.push('transaction base address aggregates are missing');
  if (!Number.isInteger(Number(document?.base?.scannedRows)) || Number(document?.base?.scannedRows) < 0) errors.push('transaction base scannedRows is invalid');
  if (!Number.isInteger(Number(document?.base?.eligibleRows)) || Number(document?.base?.eligibleRows) < 0 || Number(document?.base?.eligibleRows) > Number(document?.base?.scannedRows)) errors.push('transaction base eligibleRows is invalid');
  let baseEligible = 0;
  for (const [address, entry] of Object.entries(document?.base?.byAddress || {})) {
    if (!isImplicitAddress(address)) errors.push(`transaction base contains invalid address ${address}`);
    if (!Number.isInteger(entry?.transactions) || entry.transactions <= 0) errors.push(`${address} has invalid transaction total`);
    if (new Set(entry?.activeDays || []).size !== (entry?.activeDays || []).length) errors.push(`${address} repeats an active day`);
    if ((entry?.activeDays || []).some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) errors.push(`${address} has invalid active day`);
    if (new Set(entry?.activeWeeks || []).size !== (entry?.activeWeeks || []).length) errors.push(`${address} repeats an active week`);
    if ((entry?.activeWeeks || []).some((week) => !Number.isInteger(week) || week < 1)) errors.push(`${address} has invalid active week`);
    if (!Number.isFinite(Date.parse(entry?.lastActivity || ''))) errors.push(`${address} has invalid lastActivity`);
    baseEligible += Number(entry?.transactions || 0);
  }
  if (baseEligible !== Number(document?.base?.eligibleRows || 0)) errors.push('transaction base eligible total does not match address aggregates');
  const tailRows = document?.tail?.rows || [];
  const tailStart = Number(document?.status === 'complete' ? document?.tail?.startLevel : document?.scan?.tailStartLevel);
  const levelExclusive = Number(document?.status === 'complete' ? document?.boundary?.levelExclusive : document?.scan?.target?.levelExclusive);
  const throughExclusive = document?.status === 'complete' ? document?.boundary?.throughExclusive : document?.scan?.target?.throughExclusive;
  let priorId = null;
  for (const row of tailRows) {
    try {
      const id = integer(row?.id, 'tail transaction id');
      if (priorId != null && id <= priorId) errors.push('transaction tail cursor is not strictly increasing');
      if (row?.status !== 'applied') errors.push(`transaction tail row ${row?.id} is not applied`);
      if (row?.nonce != null && (!Number.isInteger(Number(row.nonce)) || Number(row.nonce) < 0)) errors.push(`transaction tail row ${row?.id} has invalid nonce`);
      if (!Number.isFinite(Date.parse(row?.timestamp || ''))) errors.push(`transaction tail row ${row?.id} has invalid timestamp`);
      if (!Number.isInteger(Number(row?.level)) || Number(row.level) < tailStart || Number(row.level) >= levelExclusive) errors.push(`transaction tail row ${row?.id} is outside level bounds`);
      if (Date.parse(row?.timestamp || '') >= Date.parse(throughExclusive || '')) errors.push(`transaction tail row ${row?.id} is outside time bounds`);
      priorId = id;
    } catch (error) { errors.push(error.message); }
  }
  if (document?.status === 'building') {
    try { normalizedTarget(document?.scan?.target); } catch (error) { errors.push(error.message); }
    try { integer(document?.scan?.cursorLastId, 'building cursor'); } catch (error) { errors.push(error.message); }
    try { integer(document?.scan?.baseLastIdBefore, 'building base cursor'); } catch (error) { errors.push(error.message); }
    if (!Number.isInteger(Number(document?.scan?.startLevel)) || Number(document.scan.startLevel) < Number(document.season.activationLevel)) errors.push('transaction building startLevel is invalid');
    if (
      !Number.isInteger(Number(document?.scan?.tailStartLevel))
      || Number(document.scan.tailStartLevel) < Number(document.scan.startLevel)
      || Number(document.scan.tailStartLevel) >= Number(document.scan.target?.levelExclusive)
    ) errors.push('transaction building tailStartLevel is invalid');
    if (!Number.isInteger(Number(document?.scan?.pages)) || Number(document.scan.pages) < 0) errors.push('transaction building page count is invalid');
    if (!Number.isInteger(Number(document?.scan?.fetchedRows)) || Number(document.scan.fetchedRows) < 0) errors.push('transaction building fetchedRows is invalid');
    if (!Number.isInteger(Number(document?.scan?.baseScannedRowsBefore)) || Number(document.scan.baseScannedRowsBefore) < 0) errors.push('transaction building baseScannedRowsBefore is invalid');
    if (!Number.isInteger(Number(document?.scan?.baseEligibleRowsBefore)) || Number(document.scan.baseEligibleRowsBefore) < 0) errors.push('transaction building baseEligibleRowsBefore is invalid');
    if (Number(document?.scan?.baseEligibleRowsBefore) > Number(document?.scan?.baseScannedRowsBefore)) errors.push('transaction building initial eligible count is invalid');
    if (Number(document?.base?.scannedRows) < Number(document?.scan?.baseScannedRowsBefore)) errors.push('transaction building base scanned count regressed');
    if (Number(document?.base?.eligibleRows) < Number(document?.scan?.baseEligibleRowsBefore)) errors.push('transaction building base eligible count regressed');
    const integratedRows = Number(document?.base?.scannedRows) - Number(document?.scan?.baseScannedRowsBefore);
    try {
      const initialBaseId = integer(document?.scan?.baseLastIdBefore, 'building base cursor');
      const currentBaseId = integer(document?.base?.lastId, 'base cursor');
      if ((integratedRows === 0 && currentBaseId !== initialBaseId) || (integratedRows > 0 && currentBaseId <= initialBaseId)) {
        errors.push('transaction building base cursor is inconsistent with integrated rows');
      }
    } catch (error) { errors.push(error.message); }
    if (Number(document?.scan?.fetchedRows) !== integratedRows + tailRows.length) errors.push('transaction building fetched total is inconsistent');
    const expectedCursor = tailRows.length ? String(tailRows.at(-1).id) : String(document?.base?.lastId);
    if (String(document?.scan?.cursorLastId) !== expectedCursor) errors.push('transaction building cursor does not match processed rows');
    if (document?.scan?.exhausted === true && !(Number(document?.scan?.terminalPageSize) < Number(document?.scan?.requestedPageSize))) {
      errors.push('transaction building exhaustion proof is invalid');
    }
  }
  if (document?.status === 'complete') {
    try { normalizedTarget(document.boundary); } catch (error) { errors.push(error.message); }
    if (Number(document?.base?.throughLevelInclusive) !== Number(document?.tail?.startLevel) - 1) errors.push('transaction base/tail level boundary is inconsistent');
    if (String(document?.base?.lastId) !== String(document?.tail?.cursorBefore)) errors.push('transaction base cursor does not match tail cursorBefore');
    if (tailRows.length && integer(tailRows[0].id, 'first tail id') <= integer(document?.tail?.cursorBefore, 'tail cursorBefore')) errors.push('transaction tail does not start after base cursor');
    if (String(document?.boundary?.cursorLastId) !== String(document?.tail?.lastId)) errors.push('transaction boundary cursor does not match tail');
    if (tailRows.length && String(tailRows.at(-1).id) !== String(document?.tail?.lastId)) errors.push('transaction tail lastId does not match its final row');
    const tailEligible = tailRows.filter((row) => row?.status === 'applied' && row?.nonce == null && isImplicitAddress(row?.sender)).length;
    if (Number(document?.counts?.scannedRows) !== Number(document?.base?.scannedRows) + tailRows.length) errors.push('transaction scanned total is invalid');
    if (Number(document?.counts?.eligibleRows) !== Number(document?.base?.eligibleRows) + tailEligible) errors.push('transaction eligible total is invalid');
    const addresses = new Set(Object.keys(document?.base?.byAddress || {}));
    tailRows.filter((row) => row?.status === 'applied' && row?.nonce == null && isImplicitAddress(row?.sender)).forEach((row) => addresses.add(row.sender));
    if (Number(document?.counts?.addresses) !== addresses.size) errors.push('transaction address total is invalid');
    if (Number(document?.boundary?.expectedRawCount) !== Number(document?.counts?.scannedRows)) errors.push('transaction expected raw count does not match scanned rows');
    if (!(Number(document?.boundary?.exhaustion?.terminalPageSize) < Number(document?.boundary?.exhaustion?.requestedPageSize))) errors.push('transaction boundary lacks terminal exhaustion proof');
    if (document?.boundary?.clientFilters?.status !== 'applied') errors.push('transaction boundary lacks client-verified applied status policy');
  }
  return errors;
}
