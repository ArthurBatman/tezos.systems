import { createHash } from 'node:crypto';
import { compareCodePoint, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';

export const MAXIS_GOVERNANCE_CAREER_SCHEMA = 1;
export const MAXIS_GOVERNANCE_CAREER_KIND = 'maxis-governance-careers';
export const ACTIONABLE_GOVERNANCE_PERIOD_KINDS = Object.freeze(['proposal', 'exploration', 'promotion']);
export const BALLOT_GOVERNANCE_PERIOD_KINDS = Object.freeze(['exploration', 'promotion']);

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function nullableInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function normalizedAlias(value) {
  const alias = String(value || '').trim();
  return alias || null;
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function governanceCareerContentHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function resultIsComplete(result) {
  return Boolean(
    result
    && Array.isArray(result.rows)
    && result.receipt?.complete === true
    && result.receipt?.truncated === false
    && Number(result.receipt?.rows) === result.rows.length
    && Number(result.receipt?.expectedRows) === result.rows.length
  );
}

function longestConsecutive(values = []) {
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const value of values) {
    if (previous != null && value === previous + 1) current += 1;
    else current = 1;
    if (current > longest) longest = current;
    previous = value;
  }
  return longest;
}

function trailingConsecutive(values = []) {
  if (!values.length) return 0;
  let streak = 1;
  for (let index = values.length - 1; index > 0; index -= 1) {
    if (values[index - 1] !== values[index] - 1) break;
    streak += 1;
  }
  return streak;
}

function periodKind(period) {
  return String(period?.kind || '').trim().toLowerCase();
}

function buildPeriodLedger(rows = []) {
  const errors = [];
  const seenIndexes = new Set();
  const periods = [];
  for (const [rowIndex, row] of rows.entries()) {
    const index = nullableInteger(row?.index);
    const firstLevel = nullableInteger(row?.firstLevel);
    const lastLevel = nullableInteger(row?.lastLevel);
    const kind = periodKind(row);
    if (index == null || firstLevel == null || lastLevel == null || !kind) {
      errors.push(`voting period row ${rowIndex} lacks index, level bounds, or kind`);
      continue;
    }
    if (seenIndexes.has(index)) {
      errors.push(`voting period index ${index} is duplicated`);
      continue;
    }
    seenIndexes.add(index);
    periods.push({
      index,
      epoch: nullableInteger(row?.epoch),
      kind,
      status: String(row?.status || '').trim().toLowerCase() || null,
      firstLevel,
      lastLevel,
      startTime: isoTime(row?.startTime),
      endTime: isoTime(row?.endTime)
    });
  }
  periods.sort((left, right) => left.firstLevel - right.firstLevel || left.index - right.index);
  if (periods.length && periods[0].index !== 0) errors.push(`voting period ledger starts at ${periods[0].index}, not genesis index 0`);
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index].firstLevel <= periods[index - 1].firstLevel) {
      errors.push(`voting period ${periods[index].index} is not strictly ordered by first level`);
    }
    if (periods[index].index !== periods[index - 1].index + 1) {
      errors.push(`voting period indexes ${periods[index - 1].index}/${periods[index].index} are not consecutive`);
    }
  }
  return { periods, errors };
}

function operationIdentity(row) {
  if (row?.id != null && String(row.id)) return `id:${String(row.id)}`;
  if (row?.hash && row?.counter != null) return `op:${row.hash}:${row.counter}`;
  return null;
}

function normalizeOperationRows(rows, operationKind, periodByIndex) {
  const errors = [];
  const seen = new Set();
  const operations = [];
  for (const [rowIndex, row] of rows.entries()) {
    const identity = operationIdentity(row);
    const address = row?.delegate?.address;
    const periodIndex = nullableInteger(row?.period?.index);
    const period = periodByIndex.get(periodIndex);
    if (!identity) errors.push(`${operationKind} row ${rowIndex} lacks a stable operation identity`);
    else if (seen.has(identity)) errors.push(`${operationKind} operation ${identity} is duplicated`);
    else seen.add(identity);
    if (!isImplicitAddress(address)) errors.push(`${operationKind} row ${rowIndex} lacks an implicit delegate address`);
    const allowedPeriodKinds = operationKind === 'ballot'
      ? BALLOT_GOVERNANCE_PERIOD_KINDS
      : ['proposal'];
    if (!period || !allowedPeriodKinds.includes(period.kind)) {
      errors.push(`${operationKind} row ${rowIndex} does not map to a valid ${allowedPeriodKinds.join('/')} voting period`);
    }
    if (row?.status && row.status !== 'applied') errors.push(`${operationKind} row ${rowIndex} is not applied`);
    if (!identity || !isImplicitAddress(address) || !period || !allowedPeriodKinds.includes(period.kind)) continue;
    operations.push({
      identity,
      kind: operationKind,
      address,
      alias: normalizedAlias(row?.delegate?.alias),
      periodIndex,
      timestamp: isoTime(row?.timestamp)
    });
  }
  return { operations, errors };
}

function buildActiveDelegateIndex(rows = []) {
  const errors = [];
  const byAddress = new Map();
  for (const [rowIndex, row] of rows.entries()) {
    const address = row?.address;
    if (!isImplicitAddress(address)) {
      errors.push(`active delegate row ${rowIndex} has an invalid address`);
      continue;
    }
    if (byAddress.has(address)) {
      errors.push(`active delegate ${address} is duplicated`);
      continue;
    }
    byAddress.set(address, {
      address,
      alias: normalizedAlias(row?.alias),
      numBallots: integer(row?.numBallots),
      numProposals: integer(row?.numProposals),
      lastActivityTime: isoTime(row?.lastActivityTime)
    });
  }
  const ranked = [...byAddress.values()].filter((delegate) => delegate.numBallots + delegate.numProposals > 0).sort((left, right) => (
    (right.numBallots + right.numProposals) - (left.numBallots + left.numProposals)
    || right.numBallots - left.numBallots
    || (Date.parse(right.lastActivityTime || '') || 0) - (Date.parse(left.lastActivityTime || '') || 0)
    || compareCodePoint(left.address, right.address)
  ));
  const ranks = new Map(ranked.map((delegate, index) => [delegate.address, index + 1]));
  return { byAddress, ranks, errors };
}

function sourceReceipt(result) {
  return {
    ...result.receipt,
    error: result.receipt?.error || null
  };
}

function contextPeriod(period) {
  return {
    index: integer(period.index),
    epoch: nullableInteger(period.epoch),
    kind: periodKind(period),
    firstLevel: integer(period.firstLevel),
    lastLevel: integer(period.lastLevel)
  };
}

function currentProtocolContext({ season, receipt, periods, operations }) {
  const activationLevel = nullableInteger(season?.activationLevel);
  const base = {
    seasonId: season?.id || null,
    protocolName: season?.protocolName || null,
    activationLevel,
    activatedAt: isoTime(season?.activatedAt)
  };
  if (!base.seasonId || activationLevel == null || receipt?.complete !== true) {
    return {
      ...base,
      state: 'unavailable',
      reason: 'The protocol-season identity or governance receipt is incomplete.',
      ballots: 0,
      proposals: 0,
      actions: 0,
      actionablePeriods: [],
      receipt: {
        complete: receipt?.complete === true,
        ballots: integer(receipt?.ballots),
        proposals: integer(receipt?.proposals),
        actions: integer(receipt?.ballots) + integer(receipt?.proposals),
        actionablePeriodIndexes: []
      },
      derivedFrom: null,
      receiptMatched: false,
      complete: false
    };
  }

  const expectedPeriods = periods
    .filter((period) => ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(period.kind) && period.firstLevel >= activationLevel)
    .map(contextPeriod);
  const receiptPeriods = (receipt.votingPeriods || [])
    .filter((period) => ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period)))
    .map(contextPeriod)
    .sort((left, right) => left.firstLevel - right.firstLevel || left.index - right.index);
  if (JSON.stringify(receiptPeriods) !== JSON.stringify(expectedPeriods)) {
    throw new Error('Protocol-season governance receipt period ledger disagrees with exact career periods after activation');
  }
  const periodIndexes = new Set(expectedPeriods.map((period) => period.index));
  const derivedBallots = operations.filter((operation) => operation.kind === 'ballot' && periodIndexes.has(operation.periodIndex)).length;
  const derivedProposals = operations.filter((operation) => operation.kind === 'proposal' && periodIndexes.has(operation.periodIndex)).length;
  const receiptBallots = integer(receipt.ballots);
  const receiptProposals = integer(receipt.proposals);
  if (receiptBallots !== derivedBallots || receiptProposals !== derivedProposals) {
    throw new Error(`Protocol-season governance receipt counts ${receiptBallots}/${receiptProposals} disagree with exact career rows ${derivedBallots}/${derivedProposals}`);
  }
  const actions = derivedBallots + derivedProposals;
  const state = !expectedPeriods.length
    ? 'no-actionable-period-observed'
    : actions === 0 ? 'no-actionable-governance-occurred' : 'activity-observed';
  return {
    ...base,
    state,
    reason: state === 'no-actionable-period-observed'
      ? 'No actionable proposal, exploration, or promotion period has been observed in this protocol season.'
      : state === 'no-actionable-governance-occurred'
        ? 'No applied ballot or proposal operation has occurred in an actionable period during this protocol season.'
        : null,
    ballots: derivedBallots,
    proposals: derivedProposals,
    actions,
    actionablePeriods: expectedPeriods,
    receipt: {
      complete: true,
      ballots: receiptBallots,
      proposals: receiptProposals,
      actions: receiptBallots + receiptProposals,
      actionablePeriodIndexes: receiptPeriods.map((period) => period.index)
    },
    derivedFrom: 'exact-career-operation-history-after-season-activation',
    receiptMatched: true,
    complete: true
  };
}

export function buildGovernanceCareerArtifact({
  generatedAt,
  ballots,
  proposals,
  votingPeriods,
  activeDelegates,
  head,
  season = null,
  seasonGovernanceReceipt = null
}) {
  if (!Number.isFinite(Date.parse(generatedAt || ''))) throw new Error('Governance career generatedAt must be an ISO timestamp');
  const sourceResults = { ballots, proposals, votingPeriods, activeDelegates };
  const incomplete = Object.entries(sourceResults)
    .filter(([, result]) => !resultIsComplete(result))
    .map(([name]) => name);
  if (incomplete.length) throw new Error(`Governance career sources are incomplete: ${incomplete.join(', ')}`);
  const observedHeadLevel = nullableInteger(head?.row?.level);
  const observedHeadTimestamp = isoTime(head?.row?.timestamp);
  if (head?.receipt?.complete !== true || observedHeadLevel == null || !observedHeadTimestamp) {
    throw new Error('Governance career head receipt is incomplete');
  }

  const periodLedger = buildPeriodLedger(votingPeriods.rows);
  const periodByIndex = new Map(periodLedger.periods.map((period) => [period.index, period]));
  const ballotRows = normalizeOperationRows(ballots.rows, 'ballot', periodByIndex);
  const proposalRows = normalizeOperationRows(proposals.rows, 'proposal', periodByIndex);
  const delegateIndex = buildActiveDelegateIndex(activeDelegates.rows);
  const sourceErrors = [...periodLedger.errors, ...ballotRows.errors, ...proposalRows.errors, ...delegateIndex.errors];
  if (sourceErrors.length) throw new Error(`Governance career source validation failed: ${sourceErrors.join('; ')}`);

  const actionablePeriods = periodLedger.periods.filter((period) => ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(period.kind));
  const ballotPeriods = periodLedger.periods.filter((period) => BALLOT_GOVERNANCE_PERIOD_KINDS.includes(period.kind));
  if (!actionablePeriods.length || !ballotPeriods.length) throw new Error('Governance career period ledger lacks actionable or ballot periods');
  const ballotOrdinal = new Map(ballotPeriods.map((period, index) => [period.index, index + 1]));
  const completedBallotPeriods = ballotPeriods.filter((period) => period.lastLevel < observedHeadLevel && period.status !== 'active');
  if (!completedBallotPeriods.length) throw new Error('Governance career period ledger lacks a completed ballot period');
  const completedBallotOrdinals = new Set(completedBallotPeriods.map((period) => ballotOrdinal.get(period.index)));
  const latestCompletedBallotPeriod = completedBallotPeriods.at(-1);
  const latestCompletedBallotOrdinal = ballotOrdinal.get(latestCompletedBallotPeriod.index);
  const allOperations = [...ballotRows.operations, ...proposalRows.operations];

  const working = new Map();
  const ensure = (address) => {
    const existing = working.get(address);
    if (existing) return existing;
    const created = {
      address,
      alias: delegateIndex.byAddress.get(address)?.alias || null,
      ballots: 0,
      proposals: 0,
      actionablePeriods: new Set(),
      ballotPeriods: new Set(),
      periodActivity: new Map(),
      lastActivityAt: null
    };
    working.set(address, created);
    return created;
  };
  for (const address of delegateIndex.byAddress.keys()) ensure(address);
  for (const operation of allOperations) {
    const record = ensure(operation.address);
    record.alias ||= operation.alias;
    record[operation.kind === 'ballot' ? 'ballots' : 'proposals'] += 1;
    record.actionablePeriods.add(operation.periodIndex);
    if (operation.kind === 'ballot') record.ballotPeriods.add(operation.periodIndex);
    const activity = record.periodActivity.get(operation.periodIndex) || {
      periodIndex: operation.periodIndex,
      ballots: 0,
      proposals: 0,
      lastActivityAt: null
    };
    activity[operation.kind === 'ballot' ? 'ballots' : 'proposals'] += 1;
    activity.lastActivityAt = latestIso(activity.lastActivityAt, operation.timestamp);
    record.periodActivity.set(operation.periodIndex, activity);
    record.lastActivityAt = latestIso(record.lastActivityAt, operation.timestamp);
  }

  const counterMismatches = [];
  for (const [address, counter] of delegateIndex.byAddress) {
    const row = ensure(address);
    if (counter.numBallots !== row.ballots || counter.numProposals !== row.proposals) {
      counterMismatches.push(`${address} counters ${counter.numBallots}/${counter.numProposals} != rows ${row.ballots}/${row.proposals}`);
    }
  }
  if (counterMismatches.length) {
    throw new Error(`Active delegate governance counters disagree with reconstructed rows: ${counterMismatches.slice(0, 10).join('; ')}`);
  }

  const records = {};
  for (const address of [...working.keys()].sort(compareCodePoint)) {
    const row = working.get(address);
    const activeCounter = delegateIndex.byAddress.get(address) || null;
    const periodActivity = [...row.periodActivity.values()].sort((left, right) => (
      periodByIndex.get(left.periodIndex).firstLevel - periodByIndex.get(right.periodIndex).firstLevel
    )).map((activity) => ({
      ...activity,
      actions: activity.ballots + activity.proposals
    }));
    const actionablePeriodIndexes = [...row.actionablePeriods].sort((left, right) => (
      periodByIndex.get(left).firstLevel - periodByIndex.get(right).firstLevel
    ));
    const ballotPeriodIndexes = [...row.ballotPeriods].sort((left, right) => (
      periodByIndex.get(left).firstLevel - periodByIndex.get(right).firstLevel
    ));
    const ballotOrdinals = ballotPeriodIndexes.map((index) => ballotOrdinal.get(index)).filter(Boolean);
    const completedParticipatedOrdinals = ballotOrdinals.filter((ordinal) => completedBallotOrdinals.has(ordinal));
    const longestBallotPeriodStreak = longestConsecutive(completedParticipatedOrdinals);
    const currentBallotPeriodStreak = completedParticipatedOrdinals.at(-1) === latestCompletedBallotOrdinal
      ? trailingConsecutive(completedParticipatedOrdinals)
      : 0;
    const latestPeriodIndex = actionablePeriodIndexes.at(-1) ?? null;
    const latestBallotPeriodIndex = ballotPeriodIndexes.at(-1) ?? null;
    records[address] = {
      schema: MAXIS_GOVERNANCE_CAREER_SCHEMA,
      address,
      alias: row.alias,
      clock: 'career',
      coverageMode: 'exact-applied-operation-history',
      lifetimeBallots: row.ballots,
      lifetimeProposals: row.proposals,
      lifetimeActions: row.ballots + row.proposals,
      periodActivity,
      actionablePeriodsParticipated: actionablePeriodIndexes.length,
      actionablePeriodIndexes,
      ballotPeriodsParticipated: ballotPeriodIndexes.length,
      completedBallotPeriodsParticipated: completedParticipatedOrdinals.length,
      ballotPeriodIndexes,
      longestBallotPeriodStreak,
      currentBallotPeriodStreak,
      latestPeriodIndex,
      latestBallotPeriodIndex,
      lastGovernanceActivityAt: row.lastActivityAt,
      activeDelegate: Boolean(activeCounter),
      activeDelegateGovernanceRank: delegateIndex.ranks.get(address) || null,
      activeDelegateCounters: activeCounter ? {
        numBallots: activeCounter.numBallots,
        numProposals: activeCounter.numProposals,
        governanceActions: activeCounter.numBallots + activeCounter.numProposals,
        lastActivityTime: activeCounter.lastActivityTime,
        operationRowCountsMatch: true
      } : null,
      sourceUrl: `https://tzkt.io/${address}`
    };
  }

  const unsigned = {
    schema: MAXIS_GOVERNANCE_CAREER_SCHEMA,
    kind: MAXIS_GOVERNANCE_CAREER_KIND,
    generatedAt: new Date(generatedAt).toISOString(),
    coverage: {
      status: 'complete',
      mode: 'exact-applied-operation-history',
      subjectScope: 'Implicit delegates in the complete TzKT applied ballot/proposal operation history, plus the complete currently-active delegate set.',
      absenceMeansZero: true,
      lifetimeCountSemantics: 'Counts applied ballot and proposal operation rows, not voting weight or proposal quality.',
      actionablePeriodKinds: ACTIONABLE_GOVERNANCE_PERIOD_KINDS,
      streakPeriodKinds: BALLOT_GOVERNANCE_PERIOD_KINDS,
      streakSemantics: 'Longest and current streaks use completed exploration/promotion periods only.',
      currentStreakSemantics: 'Trailing consecutive participation ending at the latest completed exploration/promotion period; an open ballot period is excluded until its last level passes.',
      activeDelegateSemantics: 'Active status and rank are a current TzKT delegate snapshot; they do not change the career operation counts.',
      activeDelegateRankSemantics: 'Descending TzKT numBallots + numProposals, then numBallots, latest account activity, and raw address.'
    },
    sourceReceipts: {
      ballots: sourceReceipt(ballots),
      proposals: sourceReceipt(proposals),
      votingPeriods: sourceReceipt(votingPeriods),
      activeDelegates: sourceReceipt(activeDelegates),
      head: { ...head.receipt }
    },
    periodLedger: {
      firstIndex: periodLedger.periods[0]?.index ?? null,
      lastIndex: periodLedger.periods.at(-1)?.index ?? null,
      count: periodLedger.periods.length,
      actionableCount: actionablePeriods.length,
      ballotPeriodCount: ballotPeriods.length,
      completedBallotPeriodCount: completedBallotPeriods.length,
      observedHeadLevel,
      observedHeadTimestamp,
      latestCompletedBallotPeriodIndex: latestCompletedBallotPeriod.index,
      periods: periodLedger.periods
    },
    currentProtocolContext: currentProtocolContext({
      season,
      receipt: seasonGovernanceReceipt,
      periods: periodLedger.periods,
      operations: allOperations
    }),
    recordCount: Object.keys(records).length,
    records
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256-stable-json-v1',
      contentHash: governanceCareerContentHash(unsigned)
    }
  };
}

export function validateGovernanceCareerArtifact(artifact) {
  const errors = [];
  if (Number(artifact?.schema) !== MAXIS_GOVERNANCE_CAREER_SCHEMA) errors.push(`schema must be ${MAXIS_GOVERNANCE_CAREER_SCHEMA}`);
  if (artifact?.kind !== MAXIS_GOVERNANCE_CAREER_KIND) errors.push(`kind must be ${MAXIS_GOVERNANCE_CAREER_KIND}`);
  if (!Number.isFinite(Date.parse(artifact?.generatedAt || ''))) errors.push('generatedAt must be an ISO timestamp');
  if (artifact?.coverage?.status !== 'complete' || artifact?.coverage?.mode !== 'exact-applied-operation-history') errors.push('coverage must be exact and complete');
  if (artifact?.coverage?.absenceMeansZero !== true) errors.push('complete career coverage must declare absenceMeansZero');

  const periods = artifact?.periodLedger?.periods;
  const periodByIndex = new Map();
  const ballotOrdinal = new Map();
  const observedHeadLevel = nullableInteger(artifact?.periodLedger?.observedHeadLevel);
  const observedHeadTimestamp = isoTime(artifact?.periodLedger?.observedHeadTimestamp);
  let completedBallotOrdinals = new Set();
  let latestCompletedBallotOrdinal = 0;
  if (!Array.isArray(periods)) errors.push('period ledger periods must be an array');
  else {
    if (periods.length && Number(periods[0]?.index) !== 0) errors.push('period ledger must begin at genesis voting-period index 0');
    periods.forEach((period, index) => {
      const periodIndex = nullableInteger(period?.index);
      if (periodIndex == null || periodByIndex.has(periodIndex)) errors.push(`period ledger row ${index} has an invalid or duplicate index`);
      else periodByIndex.set(periodIndex, period);
      if (!periodKind(period) || nullableInteger(period?.firstLevel) == null || nullableInteger(period?.lastLevel) == null || Number(period.lastLevel) < Number(period.firstLevel)) {
        errors.push(`period ledger row ${index} has invalid kind or level bounds`);
      }
      if (index && integer(period?.firstLevel) <= integer(periods[index - 1]?.firstLevel)) errors.push(`period ledger row ${index} is not strictly ordered`);
      if (index && Number(period?.index) !== Number(periods[index - 1]?.index) + 1) errors.push(`period ledger row ${index} does not continue the voting-period index sequence`);
    });
    const ballotPeriods = periods.filter((period) => BALLOT_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period)));
    ballotPeriods.forEach((period, index) => ballotOrdinal.set(Number(period.index), index + 1));
    const completedBallotPeriods = observedHeadLevel == null ? [] : ballotPeriods.filter((period) => (
      Number(period.lastLevel) < observedHeadLevel && String(period.status || '').toLowerCase() !== 'active'
    ));
    completedBallotOrdinals = new Set(completedBallotPeriods.map((period) => ballotOrdinal.get(Number(period.index))));
    latestCompletedBallotOrdinal = completedBallotPeriods.length
      ? ballotOrdinal.get(Number(completedBallotPeriods.at(-1).index))
      : 0;
    const actionableCount = periods.filter((period) => ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period))).length;
    if (Number(artifact?.periodLedger?.count) !== periods.length) errors.push('period ledger count is inconsistent');
    if (Number(artifact?.periodLedger?.actionableCount) !== actionableCount) errors.push('period ledger actionable count is inconsistent');
    if (Number(artifact?.periodLedger?.ballotPeriodCount) !== ballotOrdinal.size) errors.push('period ledger ballot-period count is inconsistent');
    if (Number(artifact?.periodLedger?.completedBallotPeriodCount) !== completedBallotPeriods.length) errors.push('period ledger completed ballot-period count is inconsistent');
    if ((completedBallotPeriods.at(-1)?.index ?? null) !== artifact?.periodLedger?.latestCompletedBallotPeriodIndex) {
      errors.push('period ledger latest completed ballot period is inconsistent');
    }
    if ((periods[0]?.index ?? null) !== artifact?.periodLedger?.firstIndex || (periods.at(-1)?.index ?? null) !== artifact?.periodLedger?.lastIndex) {
      errors.push('period ledger first/last indexes are inconsistent');
    }
  }
  if (observedHeadLevel == null || !observedHeadTimestamp) errors.push('period ledger observed head is invalid');

  const records = artifact?.records;
  if (!records || typeof records !== 'object' || Array.isArray(records)) errors.push('records must be an address map');
  else {
    const addresses = Object.keys(records);
    if (Number(artifact?.recordCount) !== addresses.length) errors.push('recordCount does not match records');
    if (JSON.stringify(addresses) !== JSON.stringify([...addresses].sort(compareCodePoint))) errors.push('record addresses are not deterministically sorted');
    let ballotTotal = 0;
    let proposalTotal = 0;
    const activeRecords = [];
    const activityTotalsByPeriod = new Map();
    for (const [address, record] of Object.entries(records)) {
      if (!isImplicitAddress(address) || record?.address !== address) errors.push(`${address} has an invalid record identity`);
      if (Number(record?.schema) !== MAXIS_GOVERNANCE_CAREER_SCHEMA || record?.clock !== 'career' || record?.coverageMode !== 'exact-applied-operation-history') {
        errors.push(`${address} has invalid career metadata`);
      }
      const activity = Array.isArray(record?.periodActivity) ? record.periodActivity : [];
      if (!Array.isArray(record?.periodActivity)) errors.push(`${address} periodActivity must be an array`);
      const seenActivityPeriods = new Set();
      let derivedBallots = 0;
      let derivedProposals = 0;
      let derivedLastActivity = null;
      const derivedActionableIndexes = [];
      const derivedBallotIndexes = [];
      for (const [activityIndex, item] of activity.entries()) {
        const periodIndex = nullableInteger(item?.periodIndex);
        const period = periodByIndex.get(periodIndex);
        const ballots = nullableInteger(item?.ballots);
        const proposals = nullableInteger(item?.proposals);
        const actions = nullableInteger(item?.actions);
        if (periodIndex == null || seenActivityPeriods.has(periodIndex)) errors.push(`${address} periodActivity row ${activityIndex} has an invalid or duplicate period`);
        else seenActivityPeriods.add(periodIndex);
        if (!period || !ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period))) errors.push(`${address} periodActivity row ${activityIndex} references a non-actionable period`);
        if (ballots == null || proposals == null || actions !== ballots + proposals || actions <= 0) errors.push(`${address} periodActivity row ${activityIndex} has invalid counts`);
        if ((ballots || 0) > 0 && !BALLOT_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period))) errors.push(`${address} ballots appear outside exploration/promotion period ${periodIndex}`);
        if ((proposals || 0) > 0 && periodKind(period) !== 'proposal') errors.push(`${address} proposals appear outside proposal period ${periodIndex}`);
        if (activityIndex && integer(period?.firstLevel) <= integer(periodByIndex.get(activity[activityIndex - 1]?.periodIndex)?.firstLevel)) {
          errors.push(`${address} periodActivity is not strictly ordered`);
        }
        if (item?.lastActivityAt != null && !Number.isFinite(Date.parse(item.lastActivityAt))) errors.push(`${address} periodActivity row ${activityIndex} has invalid activity time`);
        derivedBallots += ballots || 0;
        derivedProposals += proposals || 0;
        if (periodIndex != null) {
          const periodTotal = activityTotalsByPeriod.get(periodIndex) || { ballots: 0, proposals: 0 };
          periodTotal.ballots += ballots || 0;
          periodTotal.proposals += proposals || 0;
          activityTotalsByPeriod.set(periodIndex, periodTotal);
        }
        derivedLastActivity = latestIso(derivedLastActivity, isoTime(item?.lastActivityAt));
        if ((actions || 0) > 0 && periodIndex != null) derivedActionableIndexes.push(periodIndex);
        if ((ballots || 0) > 0 && periodIndex != null) derivedBallotIndexes.push(periodIndex);
      }
      if (Number(record?.lifetimeBallots) !== derivedBallots || Number(record?.lifetimeProposals) !== derivedProposals || Number(record?.lifetimeActions) !== derivedBallots + derivedProposals) {
        errors.push(`${address} lifetime action counts do not reconstruct from periodActivity`);
      }
      ballotTotal += derivedBallots;
      proposalTotal += derivedProposals;
      if (JSON.stringify(record?.actionablePeriodIndexes) !== JSON.stringify(derivedActionableIndexes)) errors.push(`${address} actionable period indexes do not reconstruct`);
      if (JSON.stringify(record?.ballotPeriodIndexes) !== JSON.stringify(derivedBallotIndexes)) errors.push(`${address} ballot period indexes do not reconstruct`);
      if (Number(record?.actionablePeriodsParticipated) !== derivedActionableIndexes.length) errors.push(`${address} actionable period count is inconsistent`);
      if (Number(record?.ballotPeriodsParticipated) !== derivedBallotIndexes.length) errors.push(`${address} ballot period count is inconsistent`);
      const completedParticipatedOrdinals = derivedBallotIndexes
        .map((index) => ballotOrdinal.get(index))
        .filter((ordinal) => completedBallotOrdinals.has(ordinal));
      if (Number(record?.completedBallotPeriodsParticipated) !== completedParticipatedOrdinals.length) errors.push(`${address} completed ballot period count is inconsistent`);
      const expectedLongest = longestConsecutive(completedParticipatedOrdinals);
      const expectedCurrent = completedParticipatedOrdinals.at(-1) === latestCompletedBallotOrdinal ? trailingConsecutive(completedParticipatedOrdinals) : 0;
      if (Number(record?.longestBallotPeriodStreak) !== expectedLongest) errors.push(`${address} longest ballot-period streak is inconsistent`);
      if (Number(record?.currentBallotPeriodStreak) !== expectedCurrent) errors.push(`${address} current ballot-period streak is inconsistent`);
      if ((derivedActionableIndexes.at(-1) ?? null) !== record?.latestPeriodIndex) errors.push(`${address} latest actionable period is inconsistent`);
      if ((derivedBallotIndexes.at(-1) ?? null) !== record?.latestBallotPeriodIndex) errors.push(`${address} latest ballot period is inconsistent`);
      if ((derivedLastActivity || null) !== (isoTime(record?.lastGovernanceActivityAt) || null)) errors.push(`${address} last governance activity does not reconstruct`);
      if (record?.activeDelegate) {
        const counters = record?.activeDelegateCounters;
        const counterBallots = nullableInteger(counters?.numBallots);
        const counterProposals = nullableInteger(counters?.numProposals);
        if (counterBallots == null || counterProposals == null || Number(counters?.governanceActions) !== counterBallots + counterProposals) errors.push(`${address} has invalid active-delegate counters`);
        if (counterBallots !== derivedBallots || counterProposals !== derivedProposals || counters?.operationRowCountsMatch !== true) errors.push(`${address} active-delegate counters disagree with reconstructed rows`);
        if (counters?.lastActivityTime != null && !Number.isFinite(Date.parse(counters.lastActivityTime))) errors.push(`${address} active-delegate last activity is invalid`);
        activeRecords.push(record);
      } else if (record?.activeDelegateGovernanceRank != null || record?.activeDelegateCounters != null) {
        errors.push(`${address} has active-delegate data while inactive`);
      }
    }
    if (ballotTotal !== Number(artifact?.sourceReceipts?.ballots?.rows)) errors.push('record ballot total does not match source receipt');
    if (proposalTotal !== Number(artifact?.sourceReceipts?.proposals?.rows)) errors.push('record proposal total does not match source receipt');
    if (activeRecords.length !== Number(artifact?.sourceReceipts?.activeDelegates?.rows)) errors.push('active delegate record count does not match source receipt');
    const rankedActive = activeRecords.filter((record) => Number(record.activeDelegateCounters?.governanceActions) > 0).sort((left, right) => (
      Number(right.activeDelegateCounters.governanceActions) - Number(left.activeDelegateCounters.governanceActions)
      || Number(right.activeDelegateCounters.numBallots) - Number(left.activeDelegateCounters.numBallots)
      || (Date.parse(right.activeDelegateCounters.lastActivityTime || '') || 0) - (Date.parse(left.activeDelegateCounters.lastActivityTime || '') || 0)
      || compareCodePoint(left.address, right.address)
    ));
    rankedActive.forEach((record, index) => {
      if (Number(record.activeDelegateGovernanceRank) !== index + 1) errors.push(`${record.address} active delegate rank does not reconstruct`);
    });
    activeRecords.filter((record) => Number(record.activeDelegateCounters?.governanceActions) === 0).forEach((record) => {
      if (record.activeDelegateGovernanceRank != null) errors.push(`${record.address} zero-action active delegate must not have a governance rank`);
    });

    const context = artifact?.currentProtocolContext;
    if (context?.complete === true) {
      const activationLevel = nullableInteger(context.activationLevel);
      const expectedPeriods = activationLevel == null ? [] : (periods || [])
        .filter((period) => ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period)) && Number(period.firstLevel) >= activationLevel)
        .map(contextPeriod);
      const expectedIndexes = expectedPeriods.map((period) => period.index);
      const expectedBallots = expectedIndexes.reduce((total, index) => total + integer(activityTotalsByPeriod.get(index)?.ballots), 0);
      const expectedProposals = expectedIndexes.reduce((total, index) => total + integer(activityTotalsByPeriod.get(index)?.proposals), 0);
      if (JSON.stringify(context.actionablePeriods) !== JSON.stringify(expectedPeriods)) errors.push('current protocol periods do not reconstruct from activation boundary');
      if (Number(context.ballots) !== expectedBallots || Number(context.proposals) !== expectedProposals || Number(context.actions) !== expectedBallots + expectedProposals) {
        errors.push('current protocol governance counts do not reconstruct from periodActivity');
      }
      if (
        context.receipt?.complete !== true
        || Number(context.receipt?.ballots) !== expectedBallots
        || Number(context.receipt?.proposals) !== expectedProposals
        || Number(context.receipt?.actions) !== expectedBallots + expectedProposals
        || JSON.stringify(context.receipt?.actionablePeriodIndexes) !== JSON.stringify(expectedIndexes)
        || context.receiptMatched !== true
      ) errors.push('current protocol governance receipt does not match exact reconstructed context');
      if (context.derivedFrom !== 'exact-career-operation-history-after-season-activation') errors.push('current protocol governance derivation provenance is invalid');
    }
  }

  for (const source of ['ballots', 'proposals', 'votingPeriods', 'activeDelegates']) {
    const receipt = artifact?.sourceReceipts?.[source];
    if (receipt?.complete !== true || receipt?.truncated !== false || Number(receipt?.rows) !== Number(receipt?.expectedRows)) {
      errors.push(`${source} source receipt is incomplete`);
    }
  }
  if (Number(artifact?.sourceReceipts?.votingPeriods?.rows) !== (Array.isArray(periods) ? periods.length : -1)) {
    errors.push('voting-period source receipt does not match the period ledger length');
  }
  const headReceipt = artifact?.sourceReceipts?.head;
  if (headReceipt?.complete !== true || Number(headReceipt?.level) !== observedHeadLevel || isoTime(headReceipt?.timestamp) !== observedHeadTimestamp) {
    errors.push('head source receipt is incomplete or inconsistent');
  }

  const context = artifact?.currentProtocolContext;
  if (context?.complete === true) {
    if (Number(context.actions) !== Number(context.ballots) + Number(context.proposals)) errors.push('current protocol governance action count is inconsistent');
    if (!Array.isArray(context.actionablePeriods)) errors.push('current protocol actionable periods must be an array');
    const seenContextPeriods = new Set();
    for (const [index, period] of (context.actionablePeriods || []).entries()) {
      if (!ACTIONABLE_GOVERNANCE_PERIOD_KINDS.includes(periodKind(period))) errors.push(`current protocol context period ${index} is not actionable`);
      if (seenContextPeriods.has(Number(period.index))) errors.push(`current protocol context repeats period ${period.index}`);
      seenContextPeriods.add(Number(period.index));
      if (context.activationLevel != null && Number(period.firstLevel) < Number(context.activationLevel)) errors.push(`current protocol context period ${period.index} predates activation`);
      if (index && Number(period.firstLevel) <= Number(context.actionablePeriods[index - 1].firstLevel)) errors.push('current protocol context periods are not ordered');
    }
    const expectedState = !context.actionablePeriods?.length
      ? 'no-actionable-period-observed'
      : Number(context.actions) === 0 ? 'no-actionable-governance-occurred' : 'activity-observed';
    if (context.state !== expectedState) errors.push('current protocol governance state is inconsistent');
  } else if (context?.state !== 'unavailable') errors.push('incomplete current protocol context must be unavailable');

  const { integrity, ...unsigned } = artifact || {};
  if (integrity?.algorithm !== 'sha256-stable-json-v1' || governanceCareerContentHash(unsigned) !== integrity?.contentHash) {
    errors.push('integrity content hash is invalid');
  }
  return errors;
}
