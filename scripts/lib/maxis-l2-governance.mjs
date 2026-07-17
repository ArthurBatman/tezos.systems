import { createHash } from 'node:crypto';
import { compareCodePoint, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';
import {
  ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS,
  ETHERLINK_GOVERNANCE_PRODUCTION_CONTRACTS,
  classifyEtherlinkGovernanceTrack
} from '../../js/core/etherlink-governance-contracts.mjs';

export const MAXIS_L2_GOVERNANCE_SCHEMA = 1;
export const MAXIS_L2_GOVERNANCE_KIND = 'maxis-l2-governance-careers';
export const MAXIS_L2_GOVERNANCE_CATEGORY = 'l2_governance';
export const MAXIS_L2_GOVERNANCE_RANKING_LIMIT = 10;
export const L2_GOVERNANCE_TRACKS = Object.freeze(['fast', 'slow', 'sequencer']);

const PARTICIPANT_PATHS = Object.freeze({
  proposal: 'voting_context.period.proposal.upvoters_proposals',
  promotion: 'voting_context.period.promotion.voters'
});
const PROPOSALS_PATH = 'voting_context.period.proposal.proposals';

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function isoTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function alias(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function l2GovernanceContentHash(value) {
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

function sourceReceipt(result) {
  return { ...result.receipt, error: result.receipt?.error || null };
}

function periodPhase(row) {
  if (Array.isArray(row?.proposals)) return 'proposal';
  if (row?.promotion && typeof row.promotion === 'object') return 'promotion';
  return String(row?.phase || '').trim().toLowerCase();
}

function periodTrack(row) {
  return String(row?.governance || row?.track || '').trim().toLowerCase();
}

function periodIndex(row) {
  return integer(row?.contract_voting_index ?? row?.contractVotingIndex);
}

function isOfficialZeroParticipation(row, phase) {
  if (phase !== 'promotion' || !row?.promotion) return false;
  return ['yea_voting_power', 'nay_voting_power', 'pass_voting_power']
    .every((key) => Number(row.promotion[key] || 0) === 0);
}

function productionContractMap() {
  return new Map(ETHERLINK_GOVERNANCE_PRODUCTION_CONTRACTS.map((entry) => [entry.address, entry]));
}

function normalizedPeriods(rows = []) {
  const errors = [];
  const seen = new Set();
  const production = productionContractMap();
  const periods = [];
  for (const [rowIndex, row] of rows.entries()) {
    const track = periodTrack(row);
    const phase = periodPhase(row);
    const contract = String(row?.contract || '').trim();
    const contractVotingIndex = periodIndex(row);
    const startLevel = integer(row?.startLevel);
    const endLevel = integer(row?.endLevel);
    const startDateTime = isoTime(row?.startDateTime);
    const endDateTime = isoTime(row?.endDateTime);
    const known = production.get(contract);
    if (!L2_GOVERNANCE_TRACKS.includes(track)) errors.push(`period row ${rowIndex} has an invalid track`);
    if (!['proposal', 'promotion'].includes(phase)) errors.push(`period row ${rowIndex} has an invalid actionable phase`);
    if (!known || known.track !== track) errors.push(`period row ${rowIndex} uses an unreviewed ${track || 'unknown'} contract ${contract || '(missing)'}`);
    if (contractVotingIndex == null || startLevel == null || endLevel == null || startLevel > endLevel) {
      errors.push(`period row ${rowIndex} has invalid index or level bounds`);
    }
    if (!startDateTime || !endDateTime || Date.parse(startDateTime) > Date.parse(endDateTime)) {
      errors.push(`period row ${rowIndex} has invalid timestamps`);
    }
    const id = `${track}:${contract}:${contractVotingIndex}:${phase}`;
    if (seen.has(id)) errors.push(`period ${id} is duplicated`);
    seen.add(id);
    if (!known || known.track !== track || !['proposal', 'promotion'].includes(phase)
      || contractVotingIndex == null || startLevel == null || endLevel == null || !startDateTime || !endDateTime) continue;
    periods.push({
      id,
      track,
      contract,
      contractVotingIndex,
      phase,
      startLevel,
      endLevel,
      startDateTime,
      endDateTime,
      officialZeroParticipation: isOfficialZeroParticipation(row, phase)
    });
  }
  periods.sort((left, right) => (
    left.startLevel - right.startLevel
    || left.endLevel - right.endLevel
    || compareCodePoint(left.id, right.id)
  ));
  for (const track of L2_GOVERNANCE_TRACKS) {
    const trackPeriods = periods.filter((period) => period.track === track);
    for (let index = 1; index < trackPeriods.length; index += 1) {
      const current = trackPeriods[index];
      const previous = trackPeriods[index - 1];
      if (current.startLevel <= previous.endLevel) errors.push(`${track} periods ${previous.id} and ${current.id} overlap`);
    }
  }
  return { periods, errors };
}

function bigmapIdentity(row) {
  const ptr = integer(row?.ptr);
  return ptr == null ? null : ptr;
}

export function matchL2GovernancePeriodMaps(periodRows = [], bigmapRows = []) {
  const { periods, errors } = normalizedPeriods(periodRows);
  const seenPtrs = new Set();
  const normalizedMaps = [];
  for (const [rowIndex, row] of bigmapRows.entries()) {
    const ptr = bigmapIdentity(row);
    const contract = String(row?.contract?.address || row?.contract || '').trim();
    const path = String(row?.path || '').trim();
    const firstLevel = integer(row?.firstLevel);
    const lastLevel = integer(row?.lastLevel);
    const totalKeys = integer(row?.totalKeys);
    if (ptr == null || seenPtrs.has(ptr)) errors.push(`big-map row ${rowIndex} has an invalid or duplicate pointer`);
    else seenPtrs.add(ptr);
    if (!contract || !path || firstLevel == null || lastLevel == null || totalKeys == null) {
      errors.push(`big-map row ${rowIndex} lacks contract, path, levels, or key count`);
      continue;
    }
    normalizedMaps.push({ ptr, contract, path, firstLevel, lastLevel, totalKeys, active: Boolean(row?.active) });
  }

  const matches = [];
  for (const period of periods) {
    const required = [{ role: 'participants', path: PARTICIPANT_PATHS[period.phase] }];
    if (period.phase === 'proposal') required.push({ role: 'proposals', path: PROPOSALS_PATH });
    const bigmapPtrs = {};
    for (const requirement of required) {
      const candidates = normalizedMaps.filter((row) => (
        row.contract === period.contract
        && row.path === requirement.path
        && row.firstLevel >= period.startLevel
        && row.firstLevel <= period.endLevel
      ));
      if (candidates.length === 0 && requirement.role === 'participants' && period.officialZeroParticipation) {
        bigmapPtrs.participants = null;
        continue;
      }
      if (candidates.length !== 1) {
        errors.push(`${period.id} has ${candidates.length} matching ${requirement.role} big maps`);
        continue;
      }
      bigmapPtrs[requirement.role] = candidates[0].ptr;
    }
    if ((bigmapPtrs.participants != null || period.officialZeroParticipation) && (period.phase !== 'proposal' || bigmapPtrs.proposals != null)) {
      matches.push({ ...period, bigmapPtrs });
    }
  }
  return { periods: matches, errors, maps: normalizedMaps };
}

function participantAddress(row, phase) {
  return phase === 'proposal'
    ? row?.key?.key_hash || row?.key?.keyHash || (typeof row?.key === 'string' ? row.key : '')
    : typeof row?.key === 'string' ? row.key : row?.key?.key_hash || '';
}

function proposalAuthors(row) {
  const values = Array.isArray(row?.value?.proposers)
    ? row.value.proposers
    : row?.value?.proposer ? [row.value.proposer] : [];
  return [...new Set(values.filter(isImplicitAddress))].sort(compareCodePoint);
}

function keyRowsByPtr(rows = []) {
  const byPtr = new Map();
  const errors = [];
  const seen = new Set();
  for (const [rowIndex, row] of rows.entries()) {
    const ptr = integer(row?.ptr);
    const id = integer(row?.id);
    const firstLevel = integer(row?.firstLevel);
    const timestamp = isoTime(row?.timestamp);
    if (ptr == null || id == null || firstLevel == null || !timestamp) {
      errors.push(`big-map key row ${rowIndex} lacks pointer, id, level, or timestamp`);
      continue;
    }
    const identity = `${ptr}:${id}`;
    if (seen.has(identity)) {
      errors.push(`big-map key ${identity} is duplicated`);
      continue;
    }
    seen.add(identity);
    const normalized = { ...row, ptr, id, firstLevel, timestamp };
    const entries = byPtr.get(ptr) || [];
    entries.push(normalized);
    byPtr.set(ptr, entries);
  }
  for (const entries of byPtr.values()) entries.sort((left, right) => left.id - right.id);
  return { byPtr, errors };
}

function activeDelegateIndex(rows = []) {
  const byAddress = new Map();
  const errors = [];
  for (const [rowIndex, row] of rows.entries()) {
    const address = String(row?.address || '').trim();
    if (!isImplicitAddress(address)) {
      errors.push(`active delegate row ${rowIndex} has an invalid address`);
      continue;
    }
    if (byAddress.has(address)) {
      errors.push(`active delegate ${address} is duplicated`);
      continue;
    }
    byAddress.set(address, { address, alias: alias(row?.alias) });
  }
  return { byAddress, errors };
}

function accountAliasIndex(rows = []) {
  const aliases = new Map();
  const errors = [];
  for (const [rowIndex, row] of rows.entries()) {
    const address = String(row?.address || '').trim();
    if (!isImplicitAddress(address)) {
      errors.push(`account row ${rowIndex} has an invalid address`);
      continue;
    }
    if (aliases.has(address)) errors.push(`account ${address} is duplicated`);
    aliases.set(address, alias(row?.alias));
  }
  return { aliases, errors };
}

function currentContractValidation(rows = []) {
  const errors = [];
  const byAddress = new Map(rows.map((row) => [String(row?.address || ''), row]));
  for (const track of L2_GOVERNANCE_TRACKS) {
    const address = ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS[track];
    const row = byAddress.get(address);
    if (!row) {
      errors.push(`current ${track} contract ${address} is missing`);
      continue;
    }
    if (classifyEtherlinkGovernanceTrack(row?.storage?.config || {}) !== track) {
      errors.push(`current ${track} contract ${address} no longer matches the reviewed track configuration`);
    }
    const config = row?.storage?.config || {};
    const expected = track === 'fast'
      ? { proposal: 5, promotion: 15, supermajority: 80 }
      : track === 'slow'
        ? { proposal: 1, promotion: 5, supermajority: 75 }
        : { proposal: 1, promotion: 8, supermajority: 75 };
    if (Number(config.proposal_quorum) !== expected.proposal
      || Number(config.promotion_quorum) !== expected.promotion
      || Number(config.promotion_supermajority) !== expected.supermajority) {
      errors.push(`current ${track} contract ${address} configuration drifted from ${expected.proposal}/${expected.promotion}/${expected.supermajority}`);
    }
  }
  if (byAddress.size !== L2_GOVERNANCE_TRACKS.length) errors.push('current contract receipt contains an unexpected address set');
  return errors;
}

function rankingComparator(left, right) {
  return (
    right.lifetimeWindows - left.lifetimeWindows
    || right.tracksParticipated - left.tracksParticipated
    || right.lifetimePromotionWindows - left.lifetimePromotionWindows
    || right.lifetimeReceiptCount - left.lifetimeReceiptCount
    || right.lastL2GovernanceActivityLevel - left.lastL2GovernanceActivityLevel
    || compareCodePoint(left.address, right.address)
  );
}

function rankingEntry(record, rank) {
  const trackLabels = L2_GOVERNANCE_TRACKS.filter((track) => record.trackActivity[track]?.windows > 0).map((track) => track.toUpperCase());
  return {
    category: MAXIS_L2_GOVERNANCE_CATEGORY,
    title: 'L2 Governance Maxi',
    rank,
    status: 'ready',
    address: record.address,
    alias: record.alias,
    score: record.lifetimeWindows,
    scoreLabel: `${record.lifetimeWindows} L2 governance window${record.lifetimeWindows === 1 ? '' : 's'}`,
    context: `${record.lifetimeProposalWindows} proposal · ${record.lifetimePromotionWindows} promotion · ${trackLabels.join(' / ') || 'no track'}`,
    method: 'Most distinct completed Etherlink governance windows participated in among currently active Tezos delegates. A baker counts once per FAST, SLOW, or Sequencer window, regardless of proposal count, ballot choice, voting key, or voting power.',
    clock: 'all-time-active',
    windowKind: 'all-time-active',
    source: 'Official Etherlink canonical period ledger reconciled with complete TzKT big-map receipts',
    sourceUrl: `https://tzkt.io/${record.address}`,
    lastActivity: record.lastL2GovernanceActivityAt,
    scoreVector: {
      windows: record.lifetimeWindows,
      tracks: record.tracksParticipated,
      promotionWindows: record.lifetimePromotionWindows,
      receipts: record.lifetimeReceiptCount,
      lastActivityLevel: record.lastL2GovernanceActivityLevel
    }
  };
}

export function extractL2GovernanceReceiptAddresses(periodRows = [], bigmapRows = [], keyRows = []) {
  const matched = matchL2GovernancePeriodMaps(periodRows, bigmapRows);
  if (matched.errors.length) throw new Error(`L2 governance map matching failed: ${matched.errors.join('; ')}`);
  const keyed = keyRowsByPtr(keyRows);
  if (keyed.errors.length) throw new Error(`L2 governance key validation failed: ${keyed.errors.join('; ')}`);
  const addresses = new Set();
  for (const period of matched.periods) {
    for (const row of keyed.byPtr.get(period.bigmapPtrs.participants) || []) {
      const address = participantAddress(row, period.phase);
      if (isImplicitAddress(address)) addresses.add(address);
    }
    if (period.phase === 'proposal') {
      for (const row of keyed.byPtr.get(period.bigmapPtrs.proposals) || []) {
        proposalAuthors(row).forEach((address) => addresses.add(address));
      }
    }
  }
  return [...addresses].sort(compareCodePoint);
}

export function buildL2GovernanceCareerArtifact({
  generatedAt,
  periods,
  bigmaps,
  keys,
  activeDelegates,
  accounts,
  currentContracts,
  head
}) {
  if (!isoTime(generatedAt)) throw new Error('L2 governance generatedAt must be an ISO timestamp');
  const sources = { periods, bigmaps, keys, activeDelegates, accounts, currentContracts };
  const incomplete = Object.entries(sources).filter(([, result]) => !resultIsComplete(result)).map(([name]) => name);
  if (incomplete.length) throw new Error(`L2 governance sources are incomplete: ${incomplete.join(', ')}`);
  const headLevel = integer(head?.row?.level);
  const headTimestamp = isoTime(head?.row?.timestamp);
  if (head?.receipt?.complete !== true || headLevel == null || !headTimestamp) throw new Error('L2 governance head receipt is incomplete');

  const matched = matchL2GovernancePeriodMaps(periods.rows, bigmaps.rows);
  const keyed = keyRowsByPtr(keys.rows);
  const delegates = activeDelegateIndex(activeDelegates.rows);
  const aliases = accountAliasIndex(accounts.rows);
  const sourceErrors = [
    ...matched.errors,
    ...keyed.errors,
    ...delegates.errors,
    ...aliases.errors,
    ...currentContractValidation(currentContracts.rows)
  ];
  if (!matched.periods.length) sourceErrors.push('canonical period ledger has no actionable periods');
  if (matched.periods.some((period) => period.endLevel > headLevel)) sourceErrors.push('canonical period ledger extends beyond the observed TzKT head');

  const expectedPtrs = new Map();
  for (const period of matched.periods) {
    if (period.bigmapPtrs.participants != null) expectedPtrs.set(period.bigmapPtrs.participants, { period, role: 'participants' });
    if (period.bigmapPtrs.proposals != null) expectedPtrs.set(period.bigmapPtrs.proposals, { period, role: 'proposals' });
  }
  const relevantMaps = matched.maps.filter((row) => expectedPtrs.has(row.ptr));
  for (const map of relevantMaps) {
    const rowCount = (keyed.byPtr.get(map.ptr) || []).length;
    if (rowCount !== map.totalKeys) sourceErrors.push(`big map ${map.ptr} returned ${rowCount}/${map.totalKeys} keys`);
  }
  for (const ptr of keyed.byPtr.keys()) {
    if (!expectedPtrs.has(ptr)) sourceErrors.push(`key receipt includes unexpected big map ${ptr}`);
  }
  const perMap = Array.isArray(keys.receipt?.perMap) ? keys.receipt.perMap : [];
  const perMapIndex = new Map(perMap.map((row) => [Number(row.ptr), row]));
  for (const map of relevantMaps) {
    const receipt = perMapIndex.get(map.ptr);
    if (!receipt || receipt.complete !== true || receipt.truncated !== false
      || Number(receipt.rows) !== map.totalKeys || Number(receipt.expectedRows) !== map.totalKeys) {
      sourceErrors.push(`big map ${map.ptr} lacks a complete key receipt`);
    }
  }
  if (perMapIndex.size !== relevantMaps.length) sourceErrors.push('key receipts contain an unexpected big-map set');
  if (sourceErrors.length) throw new Error(`L2 governance source validation failed: ${sourceErrors.join('; ')}`);

  const working = new Map();
  const ensure = (address) => {
    let record = working.get(address);
    if (record) return record;
    record = {
      address,
      alias: aliases.aliases.get(address) || delegates.byAddress.get(address)?.alias || null,
      periods: new Map(),
      trackActivity: Object.fromEntries(L2_GOVERNANCE_TRACKS.map((track) => [track, { windows: 0, proposalWindows: 0, promotionWindows: 0, receiptCount: 0, authoredProposals: 0 }])),
      lastLevel: 0,
      lastAt: null
    };
    working.set(address, record);
    return record;
  };
  for (const address of delegates.byAddress.keys()) ensure(address);

  const ledgerPeriods = [];
  let participantReceiptTotal = 0;
  let authoredProposalTotal = 0;
  for (const period of matched.periods) {
    const participantRows = keyed.byPtr.get(period.bigmapPtrs.participants) || [];
    const proposalRows = period.phase === 'proposal' ? keyed.byPtr.get(period.bigmapPtrs.proposals) || [] : [];
    const participants = new Map();
    const authorCounts = new Map();
    for (const row of participantRows) {
      if (row.firstLevel < period.startLevel || row.firstLevel > period.endLevel) {
        sourceErrors.push(`${period.id} participant receipt ${row.ptr}:${row.id} falls outside canonical period bounds`);
        continue;
      }
      const address = participantAddress(row, period.phase);
      if (!isImplicitAddress(address)) {
        sourceErrors.push(`${period.id} big-map key ${row.id} lacks an implicit represented baker`);
        continue;
      }
      const existing = participants.get(address) || { receipts: 0, firstLevel: row.firstLevel, lastLevel: row.firstLevel, lastAt: row.timestamp };
      existing.receipts += 1;
      existing.firstLevel = Math.min(existing.firstLevel, row.firstLevel);
      if (row.firstLevel >= existing.lastLevel) {
        existing.lastLevel = row.firstLevel;
        existing.lastAt = row.timestamp;
      }
      participants.set(address, existing);
      participantReceiptTotal += 1;
    }
    for (const row of proposalRows) {
      if (row.firstLevel < period.startLevel || row.firstLevel > period.endLevel) {
        sourceErrors.push(`${period.id} proposal receipt ${row.ptr}:${row.id} falls outside canonical period bounds`);
        continue;
      }
      const authors = proposalAuthors(row);
      if (!authors.length) sourceErrors.push(`${period.id} proposal receipt ${row.ptr}:${row.id} lacks an implicit proposer`);
      for (const address of authors) {
        authorCounts.set(address, (authorCounts.get(address) || 0) + 1);
        authoredProposalTotal += 1;
        if (!participants.has(address)) sourceErrors.push(`${period.id} author ${address} is absent from the applied upvoter receipts`);
      }
    }
    for (const [address, activity] of participants) {
      const record = ensure(address);
      const authoredProposals = authorCounts.get(address) || 0;
      record.periods.set(period.id, {
        id: period.id,
        track: period.track,
        phase: period.phase,
        contract: period.contract,
        contractVotingIndex: period.contractVotingIndex,
        receiptCount: activity.receipts,
        authoredProposals,
        firstActivityLevel: activity.firstLevel,
        lastActivityLevel: activity.lastLevel,
        lastActivityAt: activity.lastAt
      });
      const track = record.trackActivity[period.track];
      track.windows += 1;
      track[period.phase === 'proposal' ? 'proposalWindows' : 'promotionWindows'] += 1;
      track.receiptCount += activity.receipts;
      track.authoredProposals += authoredProposals;
      if (activity.lastLevel >= record.lastLevel) {
        record.lastLevel = activity.lastLevel;
        record.lastAt = activity.lastAt;
      }
    }
    ledgerPeriods.push({
      ...period,
      bigmapPtrs: { ...period.bigmapPtrs },
      participantBakers: participants.size,
      participantReceipts: participantRows.length,
      proposalKeys: proposalRows.length,
      authoredProposals: [...authorCounts.values()].reduce((sum, value) => sum + value, 0)
    });
  }
  if (sourceErrors.length) throw new Error(`L2 governance receipt validation failed: ${sourceErrors.join('; ')}`);

  const records = {};
  for (const address of [...working.keys()].sort(compareCodePoint)) {
    const row = working.get(address);
    const periodActivity = [...row.periods.values()].sort((left, right) => (
      left.firstActivityLevel - right.firstActivityLevel || compareCodePoint(left.id, right.id)
    ));
    const lifetimeProposalWindows = periodActivity.filter((item) => item.phase === 'proposal').length;
    const lifetimePromotionWindows = periodActivity.filter((item) => item.phase === 'promotion').length;
    const lifetimeReceiptCount = periodActivity.reduce((sum, item) => sum + item.receiptCount, 0);
    const lifetimeAuthoredProposals = periodActivity.reduce((sum, item) => sum + item.authoredProposals, 0);
    const tracksParticipated = L2_GOVERNANCE_TRACKS.filter((track) => row.trackActivity[track].windows > 0).length;
    records[address] = {
      schema: MAXIS_L2_GOVERNANCE_SCHEMA,
      address,
      alias: row.alias,
      clock: 'career',
      coverageMode: 'canonical-period-complete-bigmap-receipts',
      lifetimeWindows: periodActivity.length,
      lifetimeProposalWindows,
      lifetimePromotionWindows,
      lifetimeReceiptCount,
      lifetimeAuthoredProposals,
      tracksParticipated,
      trackActivity: row.trackActivity,
      periodActivity,
      lastL2GovernanceActivityLevel: row.lastLevel || null,
      lastL2GovernanceActivityAt: row.lastAt,
      activeDelegate: delegates.byAddress.has(address),
      activeDelegateL2GovernanceRank: null,
      sourceUrl: `https://tzkt.io/${address}`
    };
  }

  const activeRanked = Object.values(records).filter((record) => record.activeDelegate && record.lifetimeWindows > 0).sort(rankingComparator);
  activeRanked.forEach((record, index) => { record.activeDelegateL2GovernanceRank = index + 1; });
  const rankings = activeRanked.slice(0, MAXIS_L2_GOVERNANCE_RANKING_LIMIT).map((record, index) => rankingEntry(record, index + 1));
  const trackCounts = Object.fromEntries(L2_GOVERNANCE_TRACKS.map((track) => {
    const trackPeriods = ledgerPeriods.filter((period) => period.track === track);
    return [track, {
      periods: trackPeriods.length,
      proposalPeriods: trackPeriods.filter((period) => period.phase === 'proposal').length,
      promotionPeriods: trackPeriods.filter((period) => period.phase === 'promotion').length
    }];
  }));

  const unsigned = {
    schema: MAXIS_L2_GOVERNANCE_SCHEMA,
    kind: MAXIS_L2_GOVERNANCE_KIND,
    generatedAt: isoTime(generatedAt),
    coverage: {
      status: 'complete',
      mode: 'canonical-period-complete-bigmap-receipts',
      subjectScope: 'Every represented baker in the complete TzKT participant big maps for every completed actionable period returned by the official Etherlink FAST, SLOW, and Sequencer period ledgers, plus the current active Tezos delegate set.',
      absenceMeansZero: true,
      identitySemantics: 'The represented baker stored in governance big maps, never the transaction sender; delegated Etherlink voting keys therefore remain attributed to their baker.',
      scoringSemantics: 'One participation unit per represented baker per canonical completed governance window. Multiple proposal upvotes, proposal authorship, ballot choice, and voting power do not multiply the score.',
      canonicalPeriodSemantics: 'Official Etherlink past-period bounds select production windows; TzKT big-map state supplies applied participation truth. Calls outside those bounds are excluded.',
      activeDelegateSemantics: 'Career receipts retain inactive bakers; the crown ranks only the current complete TzKT active-delegate snapshot.',
      rankSemantics: 'Descending distinct windows, track breadth, promotion windows, receipt count, last activity level, and raw address.',
      tracks: L2_GOVERNANCE_TRACKS
    },
    contracts: {
      documentation: 'https://docs.etherlink.com/governance/overview/',
      current: { ...ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS },
      production: ETHERLINK_GOVERNANCE_PRODUCTION_CONTRACTS.map((entry) => ({ ...entry })),
      observedPeriodContracts: [...new Set(ledgerPeriods.map((period) => period.contract))].sort(compareCodePoint)
    },
    sourceReceipts: {
      periods: sourceReceipt(periods),
      bigmaps: sourceReceipt(bigmaps),
      keys: sourceReceipt(keys),
      activeDelegates: sourceReceipt(activeDelegates),
      accounts: sourceReceipt(accounts),
      currentContracts: sourceReceipt(currentContracts),
      head: { ...head.receipt }
    },
    periodLedger: {
      count: ledgerPeriods.length,
      proposalCount: ledgerPeriods.filter((period) => period.phase === 'proposal').length,
      promotionCount: ledgerPeriods.filter((period) => period.phase === 'promotion').length,
      firstLevel: ledgerPeriods[0]?.startLevel ?? null,
      lastLevel: ledgerPeriods.at(-1)?.endLevel ?? null,
      observedHeadLevel: headLevel,
      observedHeadTimestamp: headTimestamp,
      trackCounts,
      periods: ledgerPeriods
    },
    totals: {
      participantReceipts: participantReceiptTotal,
      proposalParticipantReceipts: ledgerPeriods.filter((period) => period.phase === 'proposal').reduce((sum, period) => sum + period.participantReceipts, 0),
      promotionBallots: ledgerPeriods.filter((period) => period.phase === 'promotion').reduce((sum, period) => sum + period.participantReceipts, 0),
      proposalKeys: ledgerPeriods.reduce((sum, period) => sum + period.proposalKeys, 0),
      authoredProposals: authoredProposalTotal,
      participatingBakers: Object.values(records).filter((record) => record.lifetimeWindows > 0).length,
      rankedActiveBakers: activeRanked.length
    },
    rankings,
    recordCount: Object.keys(records).length,
    records
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256-stable-json-v1',
      contentHash: l2GovernanceContentHash(unsigned)
    }
  };
}

export function validateL2GovernanceCareerArtifact(artifact) {
  const errors = [];
  if (Number(artifact?.schema) !== MAXIS_L2_GOVERNANCE_SCHEMA) errors.push(`schema must be ${MAXIS_L2_GOVERNANCE_SCHEMA}`);
  if (artifact?.kind !== MAXIS_L2_GOVERNANCE_KIND) errors.push(`kind must be ${MAXIS_L2_GOVERNANCE_KIND}`);
  if (!isoTime(artifact?.generatedAt)) errors.push('generatedAt must be an ISO timestamp');
  if (artifact?.coverage?.status !== 'complete' || artifact?.coverage?.mode !== 'canonical-period-complete-bigmap-receipts') errors.push('coverage must be canonical and complete');
  if (artifact?.coverage?.absenceMeansZero !== true) errors.push('complete coverage must declare absenceMeansZero');
  if (JSON.stringify(artifact?.coverage?.tracks) !== JSON.stringify(L2_GOVERNANCE_TRACKS)) errors.push('coverage tracks are invalid');
  if (JSON.stringify(artifact?.contracts?.current) !== JSON.stringify(ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS)) errors.push('current contract registry drifted');
  if (JSON.stringify(artifact?.contracts?.production) !== JSON.stringify(ETHERLINK_GOVERNANCE_PRODUCTION_CONTRACTS)) errors.push('production contract lineage drifted');

  const periods = artifact?.periodLedger?.periods;
  const periodById = new Map();
  if (!Array.isArray(periods)) errors.push('period ledger must be an array');
  else {
    const production = productionContractMap();
    periods.forEach((period, index) => {
      if (!period?.id || periodById.has(period.id)) errors.push(`period ledger row ${index} has an invalid or duplicate id`);
      else periodById.set(period.id, period);
      if (!L2_GOVERNANCE_TRACKS.includes(period?.track) || !['proposal', 'promotion'].includes(period?.phase)) errors.push(`period ${period?.id || index} has invalid track or phase`);
      if (production.get(period?.contract)?.track !== period?.track) errors.push(`period ${period?.id || index} uses an unreviewed contract lineage`);
      const expectedId = `${period?.track}:${period?.contract}:${period?.contractVotingIndex}:${period?.phase}`;
      if (period?.id !== expectedId) errors.push(`period ${period?.id || index} identity does not reconstruct`);
      if (integer(period?.startLevel) == null || integer(period?.endLevel) == null || Number(period.startLevel) > Number(period.endLevel)) errors.push(`period ${period?.id || index} has invalid levels`);
      if (index && Number(period.startLevel) < Number(periods[index - 1].startLevel)) errors.push('period ledger is not ordered');
      if (integer(period?.participantBakers) == null || integer(period?.participantReceipts) == null || integer(period?.proposalKeys) == null || integer(period?.authoredProposals) == null) errors.push(`period ${period?.id || index} has invalid counts`);
      if (period?.phase === 'promotion' && Number(period?.proposalKeys) !== 0) errors.push(`promotion period ${period?.id || index} must not carry proposal keys`);
      if (period?.officialZeroParticipation === true && Number(period?.participantReceipts) !== 0) errors.push(`zero-participation period ${period?.id || index} has participant receipts`);
    });
    if (Number(artifact?.periodLedger?.count) !== periods.length) errors.push('period ledger count is inconsistent');
    if (Number(artifact?.periodLedger?.proposalCount) !== periods.filter((period) => period.phase === 'proposal').length) errors.push('proposal period count is inconsistent');
    if (Number(artifact?.periodLedger?.promotionCount) !== periods.filter((period) => period.phase === 'promotion').length) errors.push('promotion period count is inconsistent');
    const firstLevel = periods[0]?.startLevel ?? null;
    const lastLevel = periods.at(-1)?.endLevel ?? null;
    if (artifact?.periodLedger?.firstLevel !== firstLevel || artifact?.periodLedger?.lastLevel !== lastLevel) errors.push('period ledger bounds are inconsistent');
    for (const track of L2_GOVERNANCE_TRACKS) {
      const trackPeriods = periods.filter((period) => period.track === track);
      for (let index = 1; index < trackPeriods.length; index += 1) {
        if (Number(trackPeriods[index].startLevel) <= Number(trackPeriods[index - 1].endLevel)) errors.push(`${track} period ledger overlaps`);
      }
      const counts = artifact?.periodLedger?.trackCounts?.[track];
      if (Number(counts?.periods) !== trackPeriods.length
        || Number(counts?.proposalPeriods) !== trackPeriods.filter((period) => period.phase === 'proposal').length
        || Number(counts?.promotionPeriods) !== trackPeriods.filter((period) => period.phase === 'promotion').length) {
        errors.push(`${track} period counts are inconsistent`);
      }
    }
  }

  const records = artifact?.records;
  const rankedActive = [];
  let participantReceipts = 0;
  let authoredProposals = 0;
  const periodRollup = new Map();
  if (!records || typeof records !== 'object' || Array.isArray(records)) errors.push('records must be an address map');
  else {
    const addresses = Object.keys(records);
    if (Number(artifact?.recordCount) !== addresses.length) errors.push('recordCount does not match records');
    if (JSON.stringify(addresses) !== JSON.stringify([...addresses].sort(compareCodePoint))) errors.push('record addresses are not deterministically sorted');
    for (const [address, record] of Object.entries(records)) {
      if (!isImplicitAddress(address) || record?.address !== address) errors.push(`${address} has an invalid identity`);
      if (Number(record?.schema) !== MAXIS_L2_GOVERNANCE_SCHEMA || record?.clock !== 'career' || record?.coverageMode !== 'canonical-period-complete-bigmap-receipts') errors.push(`${address} has invalid career metadata`);
      const activity = Array.isArray(record?.periodActivity) ? record.periodActivity : [];
      if (!Array.isArray(record?.periodActivity)) errors.push(`${address} periodActivity must be an array`);
      const seen = new Set();
      let proposals = 0;
      let promotions = 0;
      let receipts = 0;
      let authored = 0;
      let lastLevel = 0;
      let lastAt = null;
      let previousFirstLevel = 0;
      const tracks = new Set();
      const derivedTracks = Object.fromEntries(L2_GOVERNANCE_TRACKS.map((track) => [track, { windows: 0, proposalWindows: 0, promotionWindows: 0, receiptCount: 0, authoredProposals: 0 }]));
      for (const item of activity) {
        const period = periodById.get(item?.id);
        if (!period || seen.has(item?.id)) errors.push(`${address} has an invalid or duplicate period ${item?.id}`);
        seen.add(item?.id);
        if (period && (item.track !== period.track || item.phase !== period.phase || item.contract !== period.contract || Number(item.contractVotingIndex) !== Number(period.contractVotingIndex))) errors.push(`${address} activity ${item.id} disagrees with the period ledger`);
        const receiptCount = integer(item?.receiptCount);
        const authoredCount = integer(item?.authoredProposals);
        const itemFirstLevel = integer(item?.firstActivityLevel);
        const itemLastLevel = integer(item?.lastActivityLevel);
        if (receiptCount == null || receiptCount <= 0 || authoredCount == null || itemFirstLevel == null || itemLastLevel == null
          || itemFirstLevel > itemLastLevel || !isoTime(item?.lastActivityAt)) errors.push(`${address} activity ${item?.id} has invalid receipt data`);
        if (period && (itemFirstLevel < Number(period.startLevel) || itemLastLevel > Number(period.endLevel))) errors.push(`${address} activity ${item?.id} falls outside canonical period bounds`);
        if (itemFirstLevel < previousFirstLevel) errors.push(`${address} period activity is not ordered`);
        previousFirstLevel = itemFirstLevel || previousFirstLevel;
        if (period?.phase === 'proposal') proposals += 1;
        if (period?.phase === 'promotion') promotions += 1;
        receipts += receiptCount || 0;
        authored += authoredCount || 0;
        if (period?.track) {
          tracks.add(period.track);
          const track = derivedTracks[period.track];
          track.windows += 1;
          track[period.phase === 'proposal' ? 'proposalWindows' : 'promotionWindows'] += 1;
          track.receiptCount += receiptCount || 0;
          track.authoredProposals += authoredCount || 0;
        }
        if ((itemLastLevel || 0) >= lastLevel) {
          lastLevel = itemLastLevel || 0;
          lastAt = isoTime(item?.lastActivityAt);
        }
        const rollup = periodRollup.get(item?.id) || { bakers: 0, receipts: 0, authored: 0 };
        rollup.bakers += 1;
        rollup.receipts += receiptCount || 0;
        rollup.authored += authoredCount || 0;
        periodRollup.set(item?.id, rollup);
      }
      if (Number(record?.lifetimeWindows) !== activity.length || Number(record?.lifetimeProposalWindows) !== proposals || Number(record?.lifetimePromotionWindows) !== promotions) errors.push(`${address} lifetime windows do not reconstruct`);
      if (Number(record?.lifetimeReceiptCount) !== receipts || Number(record?.lifetimeAuthoredProposals) !== authored) errors.push(`${address} lifetime receipt counts do not reconstruct`);
      if (Number(record?.tracksParticipated) !== tracks.size || JSON.stringify(record?.trackActivity) !== JSON.stringify(derivedTracks)) errors.push(`${address} track activity does not reconstruct`);
      if ((record?.lastL2GovernanceActivityLevel ?? null) !== (lastLevel || null) || (record?.lastL2GovernanceActivityAt ?? null) !== lastAt) errors.push(`${address} last activity does not reconstruct`);
      participantReceipts += receipts;
      authoredProposals += authored;
      if (record?.activeDelegate && activity.length) rankedActive.push(record);
      if (record?.activeDelegate && !activity.length && record?.activeDelegateL2GovernanceRank != null) errors.push(`${address} zero-window active delegate has a rank`);
      if (!record?.activeDelegate && record?.activeDelegateL2GovernanceRank != null) errors.push(`${address} inactive delegate has an active rank`);
    }
  }
  for (const period of periods || []) {
    const rollup = periodRollup.get(period.id) || { bakers: 0, receipts: 0, authored: 0 };
    if (Number(period.participantBakers) !== rollup.bakers || Number(period.participantReceipts) !== rollup.receipts || Number(period.authoredProposals) !== rollup.authored) errors.push(`period ${period.id} counts do not reconstruct`);
  }
  rankedActive.sort(rankingComparator);
  rankedActive.forEach((record, index) => {
    if (Number(record.activeDelegateL2GovernanceRank) !== index + 1) errors.push(`${record.address} active rank does not reconstruct`);
  });
  const expectedRankings = rankedActive.slice(0, MAXIS_L2_GOVERNANCE_RANKING_LIMIT).map((record, index) => rankingEntry(record, index + 1));
  if (JSON.stringify(artifact?.rankings) !== JSON.stringify(expectedRankings)) errors.push('canonical rankings do not reconstruct from records');
  const proposalParticipantReceipts = (periods || []).filter((period) => period.phase === 'proposal').reduce((sum, period) => sum + Number(period.participantReceipts || 0), 0);
  const promotionBallots = (periods || []).filter((period) => period.phase === 'promotion').reduce((sum, period) => sum + Number(period.participantReceipts || 0), 0);
  const proposalKeys = (periods || []).reduce((sum, period) => sum + Number(period.proposalKeys || 0), 0);
  if (Number(artifact?.totals?.participantReceipts) !== participantReceipts
    || Number(artifact?.totals?.proposalParticipantReceipts) !== proposalParticipantReceipts
    || Number(artifact?.totals?.promotionBallots) !== promotionBallots
    || Number(artifact?.totals?.proposalKeys) !== proposalKeys
    || Number(artifact?.totals?.authoredProposals) !== authoredProposals) errors.push('artifact receipt totals do not reconstruct');
  if (Number(artifact?.totals?.participatingBakers) !== Object.values(records || {}).filter((record) => Number(record?.lifetimeWindows) > 0).length) errors.push('participating baker total is inconsistent');
  if (Number(artifact?.totals?.rankedActiveBakers) !== rankedActive.length) errors.push('ranked active baker total is inconsistent');

  for (const source of ['periods', 'bigmaps', 'keys', 'activeDelegates', 'accounts', 'currentContracts']) {
    const receipt = artifact?.sourceReceipts?.[source];
    if (receipt?.complete !== true || receipt?.truncated !== false || Number(receipt?.rows) !== Number(receipt?.expectedRows)) errors.push(`${source} source receipt is incomplete`);
  }
  if (Number(artifact?.sourceReceipts?.periods?.rows) !== (periods || []).length) errors.push('period source receipt does not match the ledger');
  if (Number(artifact?.sourceReceipts?.keys?.rows) !== participantReceipts + proposalKeys) errors.push('key source receipt does not match participant and proposal-key totals');
  const activeRecordCount = Object.values(records || {}).filter((record) => record?.activeDelegate === true).length;
  if (Number(artifact?.sourceReceipts?.activeDelegates?.rows) !== activeRecordCount) errors.push('active delegate source receipt does not match records');
  if (Number(artifact?.sourceReceipts?.accounts?.rows) !== Number(artifact?.totals?.participatingBakers)) errors.push('account alias source receipt does not match participating bakers');
  if (Number(artifact?.sourceReceipts?.currentContracts?.rows) !== L2_GOVERNANCE_TRACKS.length) errors.push('current contract source receipt does not cover every track');
  const observedContracts = [...new Set((periods || []).map((period) => period.contract))].sort(compareCodePoint);
  if (JSON.stringify(artifact?.contracts?.observedPeriodContracts) !== JSON.stringify(observedContracts)) errors.push('observed period contract ledger is inconsistent');
  const headLevel = integer(artifact?.periodLedger?.observedHeadLevel);
  const headTimestamp = isoTime(artifact?.periodLedger?.observedHeadTimestamp);
  if (artifact?.sourceReceipts?.head?.complete !== true || Number(artifact?.sourceReceipts?.head?.level) !== headLevel || isoTime(artifact?.sourceReceipts?.head?.timestamp) !== headTimestamp) errors.push('head receipt is incomplete or inconsistent');
  const { integrity, ...unsigned } = artifact || {};
  if (integrity?.algorithm !== 'sha256-stable-json-v1' || l2GovernanceContentHash(unsigned) !== integrity?.contentHash) errors.push('integrity content hash is invalid');
  return errors;
}
