import { createHash } from 'node:crypto';
import { compareCodePoint, compareRanked, isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';

const FULL_PROTOCOL_HASH = /^P[1-9A-HJ-NP-Za-km-z]{50}$/;

export const SEASON_SCHEMA = 1;
export const SEASON_CATALOG_SCHEMA = 1;
export const SEASON_RULES_VERSION = 'protocol-maxis-v2';
export const SEASON_EVALUATOR_VERSION = 'maxis-evaluator-v2';
export const DEEP_RANKING_LIMIT = 500;
export const UNICORN_QUALIFYING_RANK = 100;
export const UNICORN_MINIMUM_BREADTH = 3;
export const PASSPORT_SHARD_COUNT = 64;
export const PASSPORT_SHARD_ALGORITHM = 'sha256-first-byte-mask-3f-v1';
export const SEASON_SETTLEMENT_HOURS = 24;
export const MAXIS_V2_SOURCE_LIMITS = Object.freeze({
  objktPageSize: 500,
  objktMaxPages: 1000,
  tzktPageSize: 10000,
  tzktMaxPages: 60,
  transactionPageSize: 10000,
  transactionMaxPagesPerTarget: 2000,
  transactionCheckpointEveryPages: 10,
  transactionConfirmedLevelLag: 2,
  contractBatch: 40,
  accountBatch: 100,
  balanceHistoryConcurrency: 5,
  contractCatalogKinds: Object.freeze(['smart_contract', 'asset']),
  maxTransactionStateBytes: 16 * 1024 * 1024,
  maxActiveSeasonArtifactBytes: 64 * 1024 * 1024,
  maxPassportShardBytes: 1024 * 1024
});

export const SEASON_CATEGORY_ORDER = [
  'transaction',
  'collector',
  'artist',
  'minter',
  'defi',
  'gaming',
  'governance',
  'staking',
  'delegation',
  'liquidity',
  'bridge',
  'builder',
  'unicorn'
];

const TRUNCATION_DEPENDENCIES = {
  objktListingSales: ['collector', 'artist', 'minter'],
  objktMints: ['minter'],
  appTransactions: ['defi', 'gaming', 'liquidity'],
  ballots: ['governance'],
  proposals: ['governance'],
  votingPeriods: ['governance'],
  staking: ['staking'],
  delegations: ['delegation'],
  originations: ['builder'],
  builderCalls: ['builder']
};

export function truncationCoverageErrors(snapshot) {
  const errors = [];
  for (const [source, truncated] of Object.entries(snapshot?.truncation || {})) {
    if (!truncated) continue;
    const dependencies = TRUNCATION_DEPENDENCIES[source] || [];
    if (!dependencies.length) errors.push(`truncated source ${source} has no declared lane dependencies`);
    for (const category of dependencies) {
      if (snapshot?.laneStatus?.[category]?.status !== 'unavailable') {
        errors.push(`${category} must be unavailable when ${source} is truncated`);
      }
    }
  }
  return errors;
}

export const SEASON_LANE_RULES = {
  transaction: {
    title: 'Transaction Maxi',
    passportMilestone: milestone('transactions', 1000, 'Transaction Maxi', 'transactions', 'A sustained season participant, separate from the unbounded all-time Crown Hall counter.'),
    scoreOrder: [
      metric('transactions', 'successful transactions', 'transactions'),
      metric('activeDays', 'active days', 'days')
    ],
    method: 'Most successful top-level transactions sent during the protocol season, then distinct active days.',
    coverage: 'Requires an exhaustive TzKT operation scan; no winner is published when the bounded source cannot be exhausted.'
  },
  collector: {
    title: 'Collector Maxi',
    passportMilestone: milestone('artistCount', 25, 'Collector Maxi', 'artists', 'Rewards collecting breadth across a meaningful set of artists without depending on a moving leaderboard cutoff.'),
    scoreOrder: [
      metric('artistCount', 'distinct artists collected', 'artists'),
      metric('volume', 'OBJKT buy volume', 'mutez'),
      metric('purchases', 'purchases', 'sales')
    ],
    method: 'Most distinct unflagged artists collected through OBJKT listing sales during the protocol season; buy volume and purchase count break ties.',
    coverage: 'OBJKT-indexed listing sales only. Private transfers and sales outside the OBJKT index are not counted.'
  },
  artist: {
    title: 'Art Maxi',
    passportMilestone: milestone('collectorCount', 10, 'Art Maxi', 'collectors', 'Rewards independent collector spread rather than relying on one high-value sale.'),
    scoreOrder: [
      metric('collectorCount', 'distinct collectors', 'collectors'),
      metric('volume', 'attributed OBJKT sales volume', 'mutez'),
      metric('sales', 'sales', 'sales')
    ],
    method: 'Most distinct unflagged, non-self collectors of an artist\'s work in OBJKT listing sales during the protocol season; attributed volume and sales break ties.',
    coverage: 'Collaborative-token volume is divided equally across unflagged creators so a single sale is not multiplied.'
  },
  minter: {
    title: 'Mint Maxi',
    passportMilestone: milestone('successfulDrops', 3, 'Mint Maxi', 'drops', 'Three independently purchased primary drops demonstrates repeat success without rewarding mint spam.'),
    scoreOrder: [
      metric('successfulDrops', 'successful new drops', 'drops'),
      metric('tokens', 'distinct tokens minted', 'mints'),
      metric('independentCollectors', 'independent collectors', 'collectors'),
      metric('editionsSold', 'editions sold', 'editions')
    ],
    method: 'Most season-minted tokens with a positive-price primary creator sale to an independent collector, then distinct mints, collectors, and primary-sale editions.',
    coverage: 'OBJKT-indexed, non-reverted mint events for tokens first created during the season, joined to positive-price primary OBJKT listing sales. Remints of older tokens are excluded.'
  },
  defi: {
    title: 'DeFi Maxi',
    passportMilestone: milestone('appCount', 3, 'DeFi Maxi', 'apps', 'Three recognized apps represents cross-application participation rather than repetitive calls to one contract.'),
    scoreOrder: [
      metric('appCount', 'recognized DeFi apps used', 'apps'),
      metric('calls', 'successful calls', 'calls'),
      metric('contractCount', 'recognized contracts used', 'contracts')
    ],
    method: 'Most distinct recognized DeFi apps used during the protocol season, then successful top-level wallet calls and recognized contracts.',
    coverage: 'Curated TzKT-alias taxonomy. Unknown, unlabeled, or newly deployed app contracts are outside coverage until the next season taxonomy is frozen.'
  },
  gaming: {
    title: 'Gaming Maxi',
    passportMilestone: milestone('appCount', 2, 'Gaming Maxi', 'games', 'Two recognized games establishes breadth while the curated Tezos gaming universe remains compact.'),
    scoreOrder: [
      metric('appCount', 'recognized games used', 'games'),
      metric('calls', 'successful calls', 'calls'),
      metric('contractCount', 'recognized contracts used', 'contracts')
    ],
    method: 'Most distinct recognized Tezos games used during the protocol season, then successful top-level wallet calls and recognized contracts.',
    coverage: 'Curated TzKT-alias taxonomy. Unknown, unlabeled, or newly deployed game contracts are outside coverage until the next season taxonomy is frozen.'
  },
  governance: {
    title: 'Governance Maxi',
    passportMilestone: milestone('periods', 2, 'Governance Maxi', 'actionable periods', 'Two actionable proposal, exploration, or promotion windows demonstrates repeat governance participation.'),
    scoreOrder: [
      metric('periods', 'voting periods participated', 'periods'),
      metric('participationStreak', 'consecutive-period streak', 'periods'),
      metric('governanceActions', 'ballots and proposals', 'actions'),
      metric('proposals', 'proposals', 'proposals')
    ],
    method: 'Most distinct actionable Tezos voting windows participated in during the protocol season, then streak across the ordered proposal, exploration, and promotion sequence and ballots plus proposals.',
    coverage: 'Applied TzKT ballot and proposal operations attributed to implicit delegates.'
  },
  staking: {
    title: 'Staking Growth Maxi',
    passportMilestone: milestone('netStake', 1_000_000_000, 'Staking Growth Maxi', 'mutez', 'A fixed 1,000 ꜩ net season increase is substantial but reachable without comparing against whale balances.'),
    scoreOrder: [
      metric('netStake', 'net new stake', 'mutez'),
      metric('grossStake', 'gross stake added', 'mutez'),
      metric('stakeOperations', 'stake operations', 'operations')
    ],
    method: 'Largest positive net stake added by a staker during the protocol season, then gross stake and stake-operation count.',
    coverage: 'Applied TzKT staking operations. This trajectory lane is separate from the live absolute-stake Crown Hall.'
  },
  delegation: {
    title: 'Delegation Maxi',
    passportMilestone: milestone('retainedAssignments', 5, 'Delegation Maxi', 'assignments', 'Five retained in-season assignments is a human-scale baker growth milestone independent of absolute stake.'),
    scoreOrder: [
      metric('retainedAssignments', 'in-season assignments retained', 'assignments'),
      metric('retainedBalance', 'retained account balance', 'mutez')
    ],
    method: 'Most non-self wallets whose latest in-season assignment changed baker and still points to that baker with positive account balance, then retained balance.',
    coverage: 'Applied TzKT delegation operations reconciled against snapshot or exact-close state. This is retained in-season assignment, not proof of first-ever acquisition or marketing attribution.'
  },
  liquidity: {
    title: 'Liquidity Maxi',
    passportMilestone: milestone('venueCount', 2, 'Liquidity Maxi', 'venues', 'Two recognized liquidity contracts rewards breadth while value and duration remain non-comparable.'),
    scoreOrder: [
      metric('venueCount', 'recognized liquidity contracts touched', 'venues'),
      metric('appCount', 'recognized liquidity apps', 'apps'),
      metric('calls', 'successful liquidity calls', 'calls')
    ],
    method: 'Most recognized liquidity contracts reached through frozen positive-supply entrypoints, then app breadth and successful top-level calls.',
    coverage: 'Partial entrypoint coverage only; a distinct target is called a venue, not assumed to be one pool. Supplied value and LP duration are not scored.'
  },
  bridge: {
    title: 'Bridge Maxi',
    passportMilestone: milestone('deposits', 3, 'Bridge Maxi', 'deposits', 'A small repeat-use target is declared now but remains unavailable until canonical attribution is frozen.'),
    scoreOrder: [metric('deposits', 'canonical Etherlink deposits', 'deposits')],
    method: 'Canonical Etherlink L1 deposits during the protocol season. Withdrawals and round trips are deliberately excluded.',
    coverage: 'A winner is published only when the canonical L1 deposit contract and attribution semantics are frozen and exhaustively queryable.'
  },
  builder: {
    title: 'Builder Maxi',
    passportMilestone: milestone('activeDeployments', 1, 'Builder Maxi', 'contracts', 'One season deployment with verified independent use is the meaningful builder threshold.'),
    scoreOrder: [
      metric('activeDeployments', 'deployments with independent use', 'contracts'),
      metric('independentUsers', 'independent users', 'users'),
      metric('externalCalls', 'independent calls', 'calls'),
      metric('deployments', 'contracts deployed', 'contracts')
    ],
    method: 'Most directly originated contracts from an implicit sender that received successful post-deploy use from another implicit account, then user and call breadth.',
    coverage: 'Conservative TzKT scope: top-level direct originations only. Factory/internal originations and deployments without independent use do not qualify.'
  },
  unicorn: {
    title: 'Season Unicorn',
    passportMilestone: milestone('breadth', UNICORN_MINIMUM_BREADTH, 'Season Unicorn', 'lanes', 'The prestige milestone is fixed at three same-season top-100 merit lanes.'),
    scoreOrder: [
      metric('breadth', 'qualifying lanes', 'lanes'),
      metric('points', 'normalized rank points', 'points', 0.0001)
    ],
    method: `Breadth across same-season top ${UNICORN_QUALIFYING_RANK} merit lanes; normalized rank points break ties. Requires ${UNICORN_MINIMUM_BREADTH} lanes.`,
    coverage: 'Only ready on-chain season lanes participate. Social sharing never contributes to Unicorn.'
  }
};

export const LANE_EVALUATOR_SEMANTICS = Object.freeze(Object.fromEntries(
  Object.keys(SEASON_LANE_RULES).map((category) => [category, `${category}-season-ranking-v1`])
));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function definitionHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function buildLaneRuleHashes(
  lanes = SEASON_LANE_RULES,
  evaluatorSemantics = LANE_EVALUATOR_SEMANTICS
) {
  const base = Object.fromEntries(Object.entries(lanes).map(([category, rule]) => [category, definitionHash({
    evaluatorSemantics: evaluatorSemantics[category],
    rule
  })]));
  base.unicorn = definitionHash({
    evaluatorSemantics: evaluatorSemantics.unicorn,
    rule: lanes.unicorn,
    dependentLaneHashes: Object.fromEntries(Object.entries(base).filter(([category]) => category !== 'unicorn'))
  });
  return base;
}

export function buildRuleDefinition(implementationHash) {
  return {
    version: SEASON_RULES_VERSION,
    evaluator: {
      version: SEASON_EVALUATOR_VERSION,
      implementationHash,
      rankingOrder: 'Lane scoreOrder metrics descending, then lastActivity descending, then case-sensitive address ascending.',
      addressFilter: 'Implicit tz1, tz2, tz3, and tz4 addresses only.',
      objktIdentityFilter: 'Flagged OBJKT buyers, creators, and minters are excluded.',
      objktSaleDedupe: 'Each listing_sale id is one event even when several sales share an operation hash.',
      objktSelfTradeFilter: 'Buyer creator legs are excluded; independent co-creator legs retain equal-share attribution.',
      successfulDrop: 'Only tokens first created in the season qualify; each needs a unique positive-price primary sale from its creator to an independent unflagged implicit buyer, and remints/later resales do not count.',
      appCalls: 'Applied top-level calls from implicit senders to the frozen resolved address-to-app map; nonce-bearing internal calls are excluded.',
      contractResolution: `TzKT ${MAXIS_V2_SOURCE_LIMITS.contractCatalogKinds.join(' and ')} catalogs are queried in separately bounded recent-activity slices, merged by address, then matched to the curated alias taxonomy so asset-kind pools are not crowded out or omitted.`,
      governanceStreak: 'Consecutive participation in the ordered actionable proposal, exploration, and promotion sequence; testing/cooldown and adoption windows are skipped.',
      delegationRetention: 'Latest in-season assignment must change baker, be non-self, match delegate at snapshot/exact close, and retain positive liquid balance; this is identical in live and historical-close evaluation.',
      liquiditySupply: 'Only frozen app/address mappings and reviewed positive-supply entrypoints count; targets are called venues and do not imply amount or LP duration.',
      builderUse: 'Direct top-level originations from an implicit sender need post-deploy use from another implicit account; factory/internal originations are excluded.',
      pagination: `OBJKT id-keyset ascending with strict unique-cursor validation, ${MAXIS_V2_SOURCE_LIMITS.objktPageSize}×${MAXIS_V2_SOURCE_LIMITS.objktMaxPages}; TzKT ${MAXIS_V2_SOURCE_LIMITS.tzktPageSize}×${MAXIS_V2_SOURCE_LIMITS.tzktMaxPages}. A capped source withholds only dependent lanes.`,
      passportDepth: 'Every exhaustively observed eligible address receives participation progress; public standings remain capped at the deep ranking limit.',
      champions: 'Active rank-one state is provisional; season-specific champion badges are minted only by the exact settled finalization rebuild.',
      crossSeasonComeback: 'Compared per lane when that lane evaluator and rule hash match. DeFi, Gaming, and Liquidity additionally require their semantic frozen-contract coverage hash to match; volatile provenance never blocks unrelated lanes.',
      rolloverFinalization: `The new board opens at protocol activation while the prior season settles concurrently for ${SEASON_SETTLEMENT_HOURS} hours. The frozen generator cannot change until the prior exact-boundary rebuild closes; a true scoring upgrade requires versioned evaluator modules.`,
      championArchive: 'Only finalized summaries publish an explicit champions array, exactly matching ready rank-one lanes including Unicorn.'
    },
    deepRankingLimit: DEEP_RANKING_LIMIT,
    lanes: SEASON_LANE_RULES,
    socialProof: {
      meritStatus: 'excluded',
      badgeMode: 'client-only',
      reason: 'Shares and rank-card clicks are off-chain ritual signals and never change an on-chain merit rank or Unicorn.'
    }
  };
}

function metric(key, label, unit, step = 1) {
  return { key, label, unit, step };
}

function milestone(metricKey, target, label, unit, rationale) {
  return { version: 1, metric: metricKey, target, label, unit, rationale };
}

export function addressShard(address) {
  const normalized = String(address || '').trim();
  if (!isImplicitAddress(normalized)) throw new Error(`Cannot shard invalid Tezos address: ${normalized || '<empty>'}`);
  const firstByte = Number.parseInt(createHash('sha256').update(normalized).digest('hex').slice(0, 2), 16);
  return (firstByte & (PASSPORT_SHARD_COUNT - 1)).toString(16).padStart(2, '0');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanAlias(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
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

function tokenKey(row) {
  if (row?.token_pk == null) return null;
  return `${row?.fa_contract || row?.token?.fa_contract || ''}:${row.token_pk}`;
}

function operationKey(row) {
  return `${row?.hash || row?.ophash || row?.id || ''}:${row?.counter ?? ''}:${row?.nonce ?? ''}`;
}

function saleEventKey(row) {
  return row?.id != null ? `listing-sale:${row.id}` : `listing-sale:${operationKey(row)}:${row?.token_pk ?? ''}`;
}

function addWeek(set, timestamp, activatedAt) {
  const start = Date.parse(activatedAt || '');
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(start) || !Number.isFinite(time) || time < start) return;
  set.add(Math.floor((time - start) / (7 * 86400000)) + 1);
}

function sortedWeeks(set) {
  return [...set].sort((left, right) => left - right);
}

function longestConsecutive(values = []) {
  const weeks = [...new Set(values.map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
  let best = 0;
  let current = 0;
  let previous = null;
  for (const week of weeks) {
    current = previous != null && week === previous + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = week;
  }
  return best;
}

function sortByRule(rows, category) {
  const rule = SEASON_LANE_RULES[category];
  const fields = rule.scoreOrder.map((item) => ({ value: item.key }));
  fields.push({ value: (item) => Date.parse(item.lastActivity || '') || 0 });
  return rows.sort((left, right) => compareRanked(left, right, fields));
}

function rowBase(address, source = {}) {
  return {
    address,
    alias: cleanAlias(source?.tzdomain || source?.alias),
    activeWeeksSet: new Set(),
    lastActivity: null
  };
}

function finishActivity(row) {
  const { activeWeeksSet, ...rest } = row;
  return { ...rest, activeWeeks: sortedWeeks(activeWeeksSet) };
}

export function resolveProtocolSeason(protocolData, governanceReport = null, now = new Date()) {
  const protocols = Array.isArray(protocolData?.protocols) ? protocolData.protocols : [];
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now || '');
  const activeByDate = protocols
    .filter((item) => Number(item?.block) > 0 && Number.isFinite(Date.parse(`${item?.date || ''}T00:00:00Z`)))
    .filter((item) => Date.parse(`${item.date}T00:00:00Z`) <= nowTime)
    .sort((left, right) => Number(left.block) - Number(right.block));
  const reported = governanceReport?.currentProtocol;
  let protocol = null;
  if (reported?.hash && Number(reported?.firstLevel) > 0) {
    if (!FULL_PROTOCOL_HASH.test(String(reported.hash))) {
      throw new Error(`Governance current protocol hash is not a canonical full Tezos protocol hash: ${reported.hash}`);
    }
    protocol = protocols.find((item) => (
      Number(item?.number) === Number(reported.code)
      && item?.name === reported.name
      && (String(item?.hash || '').length === 51
        ? item.hash === reported.hash
        : String(reported.hash).startsWith(String(item?.hash || '')))
    ));
    if (!protocol) {
      throw new Error(`Governance reports current protocol ${reported.name} #${reported.code} ${reported.hash}, but protocol-data lore has no matching entry`);
    }
  } else {
    const named = activeByDate.find((item) => item.name === protocolData?.meta?.currentProtocol);
    protocol = named || activeByDate.at(-1);
  }
  if (!protocol) throw new Error('Protocol history has no active protocol-season boundary');
  if (!protocol.hash || String(protocol.hash).length < 8) throw new Error(`${protocol.name} is missing a protocol hash`);
  const governanceMatches = reported
    && reported.name === protocol.name
    && Number(reported.code) === Number(protocol.number)
    && Number(reported.firstLevel) > 0
    && reported.hash;
  const protocolHash = governanceMatches ? reported.hash : protocol.hash;
  const activationLevel = governanceMatches ? Number(reported.firstLevel) : Number(protocol.block);
  const protocolStart = governanceMatches ? isoTime(reported?.startTime) : null;
  return {
    id: `protocol-${Number(protocol.number)}-${String(protocolHash)}`,
    seasonOrdinal: null,
    phase: 'season',
    displayLabel: `${protocol.name} Season`,
    protocolNumber: Number(protocol.number),
    protocolName: protocol.name,
    protocolHash,
    activationLevel,
    activatedAt: protocolStart || `${protocol.date}T00:00:00.000Z`,
    activationDateSource: protocolStart
      ? 'data/governance-refresh-report.json currentProtocol.startTime'
      : 'data/protocol-data.json protocol date fallback',
    activationReceipt: {
      protocolData: {
        name: protocol.name,
        number: Number(protocol.number),
        hash: protocol.hash,
        firstLevel: Number(protocol.block),
        date: protocol.date
      },
      governanceRefresh: governanceMatches ? {
        name: reported.name,
        number: Number(reported.code),
        hash: reported.hash,
        firstLevel: Number(reported.firstLevel),
        startTime: protocolStart
      } : null
    },
    status: 'active',
    endsAt: null,
    endsWhen: 'next Tezos protocol activation'
  };
}

export function validateImmediateProtocolSuccessor(previousSeason, nextSeason, protocolData) {
  if (!previousSeason || !nextSeason || previousSeason.id === nextSeason.id) return [];
  const errors = [];
  const intervening = (protocolData?.protocols || [])
    .filter((protocol) => Number(protocol?.block) > Number(previousSeason.activationLevel))
    .filter((protocol) => Number(protocol?.block) <= Number(nextSeason.activationLevel))
    .sort((left, right) => Number(left.block) - Number(right.block));
  if (Number(nextSeason.protocolNumber) !== Number(previousSeason.protocolNumber) + 1) {
    errors.push(`protocol ${nextSeason.protocolNumber} is not the immediate successor of ${previousSeason.protocolNumber}`);
  }
  if (intervening.length !== 1) {
    errors.push(`expected one protocol boundary after ${previousSeason.protocolName}, found ${intervening.length}`);
  } else {
    const expected = intervening[0];
    if (
      Number(expected.number) !== Number(nextSeason.protocolNumber)
      || expected.name !== nextSeason.protocolName
      || Number(expected.block) !== Number(nextSeason.activationLevel)
      || (String(expected.hash || '').length === 51 && expected.hash !== nextSeason.protocolHash)
    ) errors.push('protocol history does not identify the reported current protocol as the immediate next boundary');
  }
  return errors;
}

export function rankSeasonTransactions(rows = [], activatedAt) {
  const byAddress = new Map();
  for (const row of rows) {
    if (row?.nonce != null || !isImplicitAddress(row?.sender?.address)) continue;
    const address = row.sender.address;
    const current = byAddress.get(address) || {
      ...rowBase(address, row.sender),
      operations: new Set(),
      activeDaysSet: new Set()
    };
    current.alias ||= cleanAlias(row.sender.alias);
    current.operations.add(operationKey(row));
    const timestamp = isoTime(row.timestamp);
    if (timestamp) current.activeDaysSet.add(timestamp.slice(0, 10));
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byAddress.set(address, current);
  }
  return sortByRule([...byAddress.values()].map((row) => finishActivity({
    ...row,
    score: row.operations.size,
    transactions: row.operations.size,
    activeDays: row.activeDaysSet.size
  })).map(({ operations, activeDaysSet, ...row }) => row), 'transaction');
}

export function rankSeasonTransactionAccounts(rows = []) {
  return sortByRule(rows
    .filter((row) => isImplicitAddress(row?.address) && number(row?.transactions) > 0)
    .map((row) => ({
      address: row.address,
      alias: cleanAlias(row.alias),
      transactions: number(row.transactions),
      activeDays: number(row.activeDays),
      activeWeeks: sortedWeeks(new Set(row.activeWeeks || [])),
      lastActivity: isoTime(row.lastActivity),
      score: number(row.transactions)
    })), 'transaction');
}

export function rankSeasonNftSales(rows = [], activatedAt) {
  const collectors = new Map();
  const artists = new Map();
  const seenSales = new Set();
  for (const row of rows) {
    const uniqueSale = saleEventKey(row);
    if (seenSales.has(uniqueSale)) continue;
    seenSales.add(uniqueSale);
    const buyerAddress = row?.buyer_address;
    const buyerFlag = row?.buyer?.flag;
    const price = Math.max(0, number(row?.price_xtz));
    if (!isImplicitAddress(buyerAddress) || buyerFlag && buyerFlag !== 'none' || price <= 0) continue;
    const creators = (row?.token?.creators || [])
      .filter((creator) => isImplicitAddress(creator?.creator_address))
      .filter((creator) => !creator?.holder?.flag || creator.holder.flag === 'none');
    if (!creators.length) continue;
    const independentCreators = creators.filter((creator) => creator.creator_address !== buyerAddress);
    if (!independentCreators.length) continue;
    const timestamp = isoTime(row.timestamp);
    const collector = collectors.get(buyerAddress) || {
      ...rowBase(buyerAddress, row.buyer),
      artists: new Set(), tokens: new Set(), operations: new Set(), volume: 0, purchases: 0
    };
    collector.alias ||= cleanAlias(row?.buyer?.tzdomain || row?.buyer?.alias);
    independentCreators.forEach((creator) => collector.artists.add(creator.creator_address));
    const key = tokenKey(row);
    if (key) collector.tokens.add(key);
    collector.operations.add(uniqueSale);
    collector.volume += price * independentCreators.length / creators.length;
    collector.purchases += 1;
    addWeek(collector.activeWeeksSet, timestamp, activatedAt);
    collector.lastActivity = latestIso(collector.lastActivity, timestamp);
    collectors.set(buyerAddress, collector);

    const attributedVolume = price / creators.length;
    for (const creator of creators) {
      const address = creator.creator_address;
      if (buyerAddress === address) continue;
      const artist = artists.get(address) || {
        ...rowBase(address, creator.holder),
        collectors: new Set(), tokens: new Set(), operations: new Set(), volume: 0, sales: 0
      };
      artist.alias ||= cleanAlias(creator?.holder?.tzdomain || creator?.holder?.alias);
      if (buyerAddress !== address) artist.collectors.add(buyerAddress);
      if (key) artist.tokens.add(key);
      artist.operations.add(uniqueSale);
      artist.volume += attributedVolume;
      artist.sales += 1;
      addWeek(artist.activeWeeksSet, timestamp, activatedAt);
      artist.lastActivity = latestIso(artist.lastActivity, timestamp);
      artists.set(address, artist);
    }
  }

  const collectorRows = [...collectors.values()].map((row) => finishActivity({
    ...row,
    score: row.artists.size,
    artistCount: row.artists.size,
    tokenCount: row.tokens.size,
    purchases: row.operations.size || row.purchases,
    volume: Math.round(row.volume)
  })).map(({ artists: _artists, tokens: _tokens, operations: _operations, ...row }) => row);
  const artistRows = [...artists.values()].map((row) => finishActivity({
    ...row,
    score: row.collectors.size,
    collectorCount: row.collectors.size,
    tokenCount: row.tokens.size,
    sales: row.operations.size || row.sales,
    volume: Math.round(row.volume)
  })).map(({ collectors: _collectors, tokens: _tokens, operations: _operations, ...row }) => row);
  return {
    collector: sortByRule(collectorRows.filter((row) => row.artistCount > 0), 'collector'),
    artist: sortByRule(artistRows.filter((row) => row.collectorCount > 0), 'artist')
  };
}

export function rankSeasonMints(mints = [], sales = [], activatedAt) {
  const byAddress = new Map();
  const mintedTokens = new Map();
  for (const row of mints) {
    const address = row?.creator_address;
    if (
      !isImplicitAddress(address)
      || row?.creator?.flag && row.creator.flag !== 'none'
      || (Date.parse(row?.token?.timestamp || '') || 0) < (Date.parse(activatedAt || '') || 0)
    ) continue;
    const current = byAddress.get(address) || {
      ...rowBase(address, row.creator),
      tokensSet: new Set(), operations: new Set(), successfulSet: new Set(), collectors: new Set(),
      primarySaleIds: new Set(), editions: 0, editionsSold: 0
    };
    current.alias ||= cleanAlias(row?.creator?.tzdomain || row?.creator?.alias);
    const key = tokenKey(row);
    if (key) {
      current.tokensSet.add(key);
      const known = mintedTokens.get(key);
      if (!known || Date.parse(row.timestamp || '') < Date.parse(known.timestamp || '')) {
        mintedTokens.set(key, { address, timestamp: isoTime(row.timestamp) });
      }
    }
    current.operations.add(row?.ophash || operationKey(row));
    current.editions += Math.max(0, number(row?.amount));
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byAddress.set(address, current);
  }

  for (const sale of sales) {
    const key = tokenKey(sale);
    const minted = mintedTokens.get(key);
    if (!minted || Date.parse(sale.timestamp || '') < Date.parse(minted.timestamp || '')) continue;
    const buyer = sale?.buyer_address;
    if (
      !isImplicitAddress(buyer)
      || buyer === minted.address
      || sale?.seller_address !== minted.address
      || number(sale?.price_xtz) <= 0
      || sale?.buyer?.flag && sale.buyer.flag !== 'none'
    ) continue;
    const current = byAddress.get(minted.address);
    if (!current) continue;
    const saleId = saleEventKey(sale);
    if (current.primarySaleIds.has(saleId)) continue;
    current.primarySaleIds.add(saleId);
    current.successfulSet.add(key);
    current.collectors.add(buyer);
    current.editionsSold += Math.max(0, number(sale?.amount));
    const timestamp = isoTime(sale.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
  }

  const ranked = [...byAddress.values()].map((row) => finishActivity({
    ...row,
    score: row.successfulSet.size,
    successfulDrops: row.successfulSet.size,
    tokens: row.tokensSet.size,
    mintOperations: row.operations.size,
    independentCollectors: row.collectors.size
  })).map(({ tokensSet, operations, successfulSet, collectors, primarySaleIds, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.tokens > 0), 'minter');
}

export function rankSeasonAppActivity(rows = [], contractLookup = new Map(), category, activatedAt) {
  const byAddress = new Map();
  for (const row of rows) {
    if (row?.nonce != null) continue;
    const address = row?.sender?.address;
    const contract = row?.target?.address;
    const app = contractLookup.get(contract);
    if (!isImplicitAddress(address) || !app || app.category !== category) continue;
    const current = byAddress.get(address) || {
      ...rowBase(address, row.sender),
      appsSet: new Set(), contractsSet: new Set(), operations: new Set()
    };
    current.alias ||= cleanAlias(row.sender.alias);
    current.appsSet.add(app.id);
    current.contractsSet.add(contract);
    current.operations.add(operationKey(row));
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byAddress.set(address, current);
  }
  const ranked = [...byAddress.values()].map((row) => finishActivity({
    ...row,
    score: row.appsSet.size,
    appCount: row.appsSet.size,
    apps: [...row.appsSet].sort(),
    contractCount: row.contractsSet.size,
    calls: row.operations.size
  })).map(({ appsSet, contractsSet, operations, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.appCount > 0), category);
}

export function rankSeasonGovernance(ballots = [], proposals = [], activatedAt, votingPeriods = []) {
  const actionableKinds = new Set(['proposal', 'exploration', 'promotion']);
  const actionablePeriods = [...votingPeriods]
    .filter((period) => actionableKinds.has(period?.kind))
    .sort((left, right) => number(left?.firstLevel) - number(right?.firstLevel));
  const actionableOrdinal = new Map(actionablePeriods.map((period, index) => [number(period.index), index + 1]));
  const byAddress = new Map();
  for (const [kind, rows] of [['ballot', ballots], ['proposal', proposals]]) {
    for (const row of rows) {
      const address = row?.delegate?.address;
      if (!isImplicitAddress(address)) continue;
      const period = number(row?.period?.index);
      if (!actionableOrdinal.has(period)) continue;
      const current = byAddress.get(address) || {
        ...rowBase(address, row.delegate),
        periodsSet: new Set(), operations: new Set(), ballots: 0, proposals: 0
      };
      current.periodsSet.add(period);
      current.operations.add(operationKey(row));
      current[kind === 'ballot' ? 'ballots' : 'proposals'] += 1;
      const timestamp = isoTime(row.timestamp);
      addWeek(current.activeWeeksSet, timestamp, activatedAt);
      current.lastActivity = latestIso(current.lastActivity, timestamp);
      byAddress.set(address, current);
    }
  }
  const ranked = [...byAddress.values()].map((row) => {
    const periods = [...row.periodsSet].sort((left, right) => left - right);
    const actionableParticipation = periods.map((period) => actionableOrdinal.get(period)).filter(Boolean);
    return finishActivity({
      ...row,
      score: periods.length,
      periods: periods.length,
      periodIndexes: periods,
      actionablePeriodOrdinals: actionableParticipation,
      participationStreak: longestConsecutive(actionableParticipation),
      governanceActions: row.operations.size
    });
  }).map(({ periodsSet, operations, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.governanceActions > 0), 'governance');
}

export function rankSeasonStaking(rows = [], activatedAt) {
  const byAddress = new Map();
  for (const row of rows) {
    const address = row?.staker?.address || row?.sender?.address;
    if (!isImplicitAddress(address) || !['stake', 'unstake'].includes(row?.action)) continue;
    const current = byAddress.get(address) || {
      ...rowBase(address, row.staker || row.sender),
      grossStake: 0, grossUnstake: 0, stakeOperations: 0, unstakeOperations: 0
    };
    const amount = Math.max(0, number(row.amount));
    if (row.action === 'stake') {
      current.grossStake += amount;
      current.stakeOperations += 1;
    } else {
      current.grossUnstake += amount;
      current.unstakeOperations += 1;
    }
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byAddress.set(address, current);
  }
  const ranked = [...byAddress.values()].map((row) => finishActivity({
    ...row,
    score: row.grossStake - row.grossUnstake,
    netStake: row.grossStake - row.grossUnstake
  }));
  return sortByRule(ranked.filter((row) => row.netStake > 0), 'staking');
}

export function rankSeasonDelegation(rows = [], currentAccounts = [], activatedAt) {
  const latestByDelegator = new Map();
  for (const row of rows) {
    const delegator = row?.sender?.address;
    if (!isImplicitAddress(delegator)) continue;
    const known = latestByDelegator.get(delegator);
    if (!known || number(row.id) > number(known.id)) latestByDelegator.set(delegator, row);
  }
  const accountByAddress = new Map(currentAccounts.map((account) => [account?.address, account]));
  const byBaker = new Map();
  for (const [delegator, row] of latestByDelegator) {
    const baker = row?.newDelegate?.address;
    const account = accountByAddress.get(delegator);
    const previousBaker = row?.prevDelegate?.address || null;
    const retainedBalance = Math.max(0, number(account?.balance));
    if (
      !isImplicitAddress(baker)
      || baker === delegator
      || previousBaker === baker
      || account?.delegate?.address !== baker
      || retainedBalance <= 0
    ) continue;
    const current = byBaker.get(baker) || {
      ...rowBase(baker, row.newDelegate),
      delegatorsSet: new Set(), retainedBalance: 0
    };
    current.delegatorsSet.add(delegator);
    current.retainedBalance += retainedBalance;
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byBaker.set(baker, current);
  }
  const ranked = [...byBaker.values()].map((row) => finishActivity({
    ...row,
    score: row.delegatorsSet.size,
    retainedAssignments: row.delegatorsSet.size
  })).map(({ delegatorsSet, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.retainedAssignments > 0), 'delegation');
}

export function rankSeasonLiquidity(rows = [], contractLookup = new Map(), taxonomyApps = [], activatedAt) {
  const entrypointsByApp = new Map(taxonomyApps.map((app) => [app.id, new Set(app.liquidityEntrypoints || [])]));
  const byAddress = new Map();
  for (const row of rows) {
    if (row?.nonce != null) continue;
    const address = row?.sender?.address;
    const contract = row?.target?.address;
    const app = contractLookup.get(contract);
    const entrypoint = row?.parameter?.entrypoint;
    if (!isImplicitAddress(address) || !app || !entrypoint || !entrypointsByApp.get(app.id)?.has(entrypoint)) continue;
    const current = byAddress.get(address) || {
      ...rowBase(address, row.sender),
      venuesSet: new Set(), appsSet: new Set(), operations: new Set(), entrypointsSet: new Set()
    };
    current.venuesSet.add(contract);
    current.appsSet.add(app.id);
    current.operations.add(operationKey(row));
    current.entrypointsSet.add(entrypoint);
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byAddress.set(address, current);
  }
  const ranked = [...byAddress.values()].map((row) => finishActivity({
    ...row,
    score: row.venuesSet.size,
    venueCount: row.venuesSet.size,
    appCount: row.appsSet.size,
    apps: [...row.appsSet].sort(),
    calls: row.operations.size,
    entrypoints: [...row.entrypointsSet].sort()
  })).map(({ venuesSet, appsSet, operations, entrypointsSet, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.venueCount > 0), 'liquidity');
}

export function rankSeasonBuilders(originations = [], calls = [], activatedAt) {
  const contractLookup = new Map();
  const byBuilder = new Map();
  for (const row of originations) {
    if (row?.nonce != null || !isImplicitAddress(row?.sender?.address)) continue;
    const builder = row.sender.address;
    const contract = row?.originatedContract?.address;
    if (!builder || !contract) continue;
    const timestamp = isoTime(row.timestamp);
    contractLookup.set(contract, { builder, timestamp });
    const current = byBuilder.get(builder) || {
      ...rowBase(builder, row.sender),
      deploymentsSet: new Set(), activeSet: new Set(), usersSet: new Set(), operations: new Set()
    };
    current.deploymentsSet.add(contract);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
    byBuilder.set(builder, current);
  }
  for (const row of calls) {
    if (row?.nonce != null) continue;
    const contract = row?.target?.address;
    const deployment = contractLookup.get(contract);
    if (!deployment || Date.parse(row.timestamp || '') < Date.parse(deployment.timestamp || '')) continue;
    const user = isImplicitAddress(row?.initiator?.address)
      ? row.initiator.address
      : isImplicitAddress(row?.sender?.address) ? row.sender.address : null;
    if (!user || user === deployment.builder) continue;
    const current = byBuilder.get(deployment.builder);
    if (!current) continue;
    current.activeSet.add(contract);
    current.usersSet.add(user);
    current.operations.add(operationKey(row));
    const timestamp = isoTime(row.timestamp);
    addWeek(current.activeWeeksSet, timestamp, activatedAt);
    current.lastActivity = latestIso(current.lastActivity, timestamp);
  }
  const ranked = [...byBuilder.values()].map((row) => finishActivity({
    ...row,
    score: row.activeSet.size,
    activeDeployments: row.activeSet.size,
    independentUsers: row.usersSet.size,
    externalCalls: row.operations.size,
    deployments: row.deploymentsSet.size
  })).map(({ deploymentsSet, activeSet, usersSet, operations, ...row }) => row);
  return sortByRule(ranked.filter((row) => row.activeDeployments > 0), 'builder');
}

export function rankSeasonUnicorn(categoryRows = {}, laneStatus = {}) {
  const candidates = new Map();
  for (const [category, rows] of Object.entries(categoryRows)) {
    if (category === 'unicorn' || laneStatus?.[category]?.status === 'unavailable') continue;
    (rows || []).slice(0, UNICORN_QUALIFYING_RANK).forEach((row, index) => {
      if (!isImplicitAddress(row?.address)) return;
      const current = candidates.get(row.address) || {
        address: row.address, alias: cleanAlias(row.alias), categories: [], points: 0,
        activeWeeksSet: new Set(), lastActivity: null
      };
      const rank = index + 1;
      current.alias ||= cleanAlias(row.alias);
      current.categories.push({ category, rank });
      current.points += (UNICORN_QUALIFYING_RANK - index) / UNICORN_QUALIFYING_RANK;
      (row.activeWeeks || []).forEach((week) => current.activeWeeksSet.add(week));
      current.lastActivity = latestIso(current.lastActivity, row.lastActivity);
      candidates.set(row.address, current);
    });
  }
  const ranked = [...candidates.values()].map((row) => finishActivity({
    ...row,
    breadth: row.categories.length,
    points: Number(row.points.toFixed(4)),
    score: row.categories.length
  }));
  return sortByRule(ranked.filter((row) => row.breadth >= UNICORN_MINIMUM_BREADTH), 'unicorn');
}

function sourceUrl(category, address) {
  return ['collector', 'artist', 'minter'].includes(category)
    ? `https://objkt.com/profile/${encodeURIComponent(address)}`
    : `https://tzkt.io/${encodeURIComponent(address)}`;
}

function scoreVector(category, row) {
  return SEASON_LANE_RULES[category].scoreOrder.map((item) => ({
    metric: item.key,
    label: item.label,
    unit: item.unit,
    value: number(row?.[item.key])
  }));
}

function scoreVectorImproves(current = [], previous = []) {
  if (current.length !== previous.length || !current.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index]?.metric !== previous[index]?.metric) return false;
    const currentValue = number(current[index]?.value);
    const previousValue = number(previous[index]?.value);
    if (currentValue === previousValue) continue;
    return currentValue > previousValue;
  }
  return false;
}

function personalBestImproves(candidate, known) {
  if (!candidate) return false;
  if (!known) return true;
  if (number(candidate.rank) < number(known.rank)) return true;
  return number(candidate.rank) === number(known.rank)
    && candidate.laneRuleHash
    && candidate.laneRuleHash === known.laneRuleHash
    && scoreVectorImproves(candidate.scoreVector, known.scoreVector);
}

function gapToTarget(category, row, target) {
  if (!row || !target || row.rank <= target.rank) return null;
  const rule = SEASON_LANE_RULES[category];
  const current = scoreVector(category, row);
  const targetVector = scoreVector(category, target);
  const primaryRule = rule.scoreOrder[0];
  const primaryGap = Math.max(0, targetVector[0].value - current[0].value + primaryRule.step);
  const conservativeVectorPath = [];
  for (let index = 0; index < current.length; index += 1) {
    const deficit = targetVector[index].value - current[index].value;
    const scoreRule = rule.scoreOrder[index];
    if (deficit > 0) {
      conservativeVectorPath.push({
        metric: current[index].metric,
        label: current[index].label,
        unit: current[index].unit,
        amount: deficit + (index > 0 || index === current.length - 1 ? scoreRule.step : 0)
      });
      if (index > 0 || index === current.length - 1) break;
    }
    if (deficit < 0) break;
    if (index === current.length - 1 && deficit === 0) {
      conservativeVectorPath.push({
        metric: scoreRule.key,
        label: scoreRule.label,
        unit: scoreRule.unit,
        amount: scoreRule.step
      });
    }
  }
  return {
    targetRank: target.rank,
    targetAddress: target.address,
    guaranteedPrimary: {
      metric: primaryRule.key,
      label: primaryRule.label,
      unit: primaryRule.unit,
      amount: primaryGap,
      kind: 'strictly-exceed-primary'
    },
    conservativeVectorPath: conservativeVectorPath.filter((step) => step.amount > 0),
    caveat: 'The guaranteed path strictly exceeds the primary metric. The conservative vector path ignores a later-activity tie-break and can overstate the static-snapshot minimum; it also cannot predict other wallets moving.'
  };
}

function scoreLabel(category, row) {
  const integer = (value) => Math.round(number(value)).toLocaleString('en-US');
  const xtz = (value) => `${(number(value) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })} ꜩ`;
  const labels = {
    transaction: `${integer(row.transactions)} season transactions`,
    collector: `${integer(row.artistCount)} artists · ${xtz(row.volume)}`,
    artist: `${integer(row.collectorCount)} collectors · ${xtz(row.volume)}`,
    minter: `${integer(row.successfulDrops)} successful drops · ${integer(row.tokens)} mints`,
    defi: `${integer(row.appCount)} apps · ${integer(row.calls)} calls`,
    gaming: `${integer(row.appCount)} games · ${integer(row.calls)} calls`,
    governance: `${integer(row.periods)} periods · ${integer(row.governanceActions)} actions`,
    staking: `${xtz(row.netStake)} net new stake`,
    delegation: `${integer(row.retainedAssignments)} retained assignments`,
    liquidity: `${integer(row.venueCount)} venues · ${integer(row.calls)} calls`,
    bridge: `${integer(row.deposits)} canonical deposits`,
    builder: `${integer(row.activeDeployments)} used deployments · ${integer(row.independentUsers)} users`,
    unicorn: `${integer(row.breadth)} qualifying lanes`
  };
  return labels[category] || `${integer(row.score)} points`;
}

function decorateRanking(category, rows, previousSnapshot) {
  const previousRows = previousSnapshot?.rankings?.[category] || [];
  const previousRanks = new Map(previousRows.map((row) => [row.address, row.rank]));
  const ranked = rows.map((row, index) => ({
    ...row,
    category,
    title: SEASON_LANE_RULES[category].title,
    status: 'ready',
    rank: index + 1,
    scoreVector: scoreVector(category, row),
    scoreLabel: scoreLabel(category, row),
    sourceUrl: sourceUrl(category, row.address),
    method: SEASON_LANE_RULES[category].method,
    windowKind: 'protocol-season',
    previousRank: previousRanks.get(row.address) || null,
    delta: previousRanks.has(row.address) ? previousRanks.get(row.address) - (index + 1) : null,
    deltaComparable: previousRanks.has(row.address)
  }));
  return ranked.map((row, index) => ({
    ...row,
    passGap: {
      next: index > 0 ? gapToTarget(category, row, ranked[index - 1]) : null,
      topTen: index >= 10 && ranked[9] ? gapToTarget(category, row, ranked[9]) : null,
      leader: index > 0 ? gapToTarget(category, row, ranked[0]) : null
    }
  }));
}

function badgeProgress(category, row) {
  const milestone = SEASON_LANE_RULES[category]?.passportMilestone;
  if (!milestone) return null;
  const value = Math.max(0, number(row?.[milestone.metric]));
  return {
    version: milestone.version,
    metric: milestone.metric,
    label: milestone.label,
    unit: milestone.unit,
    value,
    target: milestone.target,
    remaining: Math.max(0, milestone.target - value),
    percent: Math.min(100, Math.round((value / milestone.target) * 100)),
    earned: value >= milestone.target,
    rationale: milestone.rationale
  };
}

function buildHistory(rankings, previousSnapshot, comparable) {
  const previous = comparable ? previousSnapshot?.history?.topTenByLane || {} : {};
  const topTenByLane = {};
  for (const category of SEASON_CATEGORY_ORDER) {
    const addresses = new Set(previous[category] || []);
    (rankings[category] || []).slice(0, 10).forEach((row) => addresses.add(row.address));
    topTenByLane[category] = [...addresses].sort();
  }
  return {
    snapshotCount: comparable ? number(previousSnapshot?.history?.snapshotCount) + 1 : 1,
    previousGeneratedAt: comparable ? previousSnapshot.generatedAt : null,
    topTenByLane
  };
}

function passportBadge(id, label, seasonId, earnedAt) {
  return { id, label, earnedSeasonId: seasonId, earnedAt };
}

export function expandPassportRecord(passport) {
  if (passport?.format !== 'transaction-only-v1') return passport;
  const implicitQualifyingLanes = Number(passport.transaction?.rank) <= UNICORN_QUALIFYING_RANK
    ? [{ category: 'transaction', rank: Number(passport.transaction.rank) }]
    : [];
  const qualifyingLanes = passport.unicornProgress?.qualifyingLanes || implicitQualifyingLanes;
  const breadth = passport.unicornProgress?.breadth ?? qualifyingLanes.length;
  return {
    address: passport.address,
    alias: passport.alias || null,
    lanes: {
      transaction: {
        ...passport.transaction,
        passGap: { next: null, topTen: passport.transaction?.topTenGap || null, leader: null }
      }
    },
    personalBests: passport.personalBest ? { transaction: passport.personalBest } : {},
    touchedLanes: [{ category: 'transaction', rank: passport.transaction?.rank }],
    nearMisses: passport.transaction?.rank > 10 && passport.transaction?.rank <= 25 && passport.transaction?.topTenGap
      ? [{ category: 'transaction', rank: passport.transaction.rank, passGap: passport.transaction.topTenGap }]
      : [],
    activeWeeks: passport.activeWeeks || [],
    activeWeekStreak: passport.activeWeekStreak || 0,
    badges: passport.badges || [],
    unicorn: {
      earned: false,
      rank: null,
      qualifyingLanes,
      breadth,
      lanesNeeded: passport.unicornProgress?.lanesNeeded ?? Math.max(0, UNICORN_MINIMUM_BREADTH - breadth),
      progressPercent: passport.unicornProgress?.progressPercent ?? Math.min(100, Math.round((breadth / UNICORN_MINIMUM_BREADTH) * 100)),
      badgeProgress: passport.unicornProgress?.badgeProgress || {
        ...SEASON_LANE_RULES.unicorn.passportMilestone,
        value: breadth,
        remaining: Math.max(0, UNICORN_MINIMUM_BREADTH - breadth),
        percent: Math.min(100, Math.round((breadth / UNICORN_MINIMUM_BREADTH) * 100)),
        earned: false
      }
    }
  };
}

function buildPassports(rankings, laneStatus, season, generatedAt, previousSnapshot, comparable, inheritedPassportSnapshot, rules) {
  const previousPassports = Object.fromEntries(Object.entries(previousSnapshot?.passportIndex?.byAddress || {}).map(([address, passport]) => [address, expandPassportRecord(passport)]));
  const inheritedPassports = Object.fromEntries(Object.entries(inheritedPassportSnapshot?.passportIndex?.byAddress || {}).map(([address, passport]) => [address, expandPassportRecord(passport)]));
  const unicornByAddress = new Map((rankings.unicorn || []).map((row) => [row.address, row]));
  const candidates = new Map();
  for (const address of new Set([...Object.keys(inheritedPassports), ...Object.keys(previousPassports)])) {
    const previous = previousPassports[address] || null;
    const inherited = inheritedPassports[address] || null;
    candidates.set(address, {
      address,
      alias: previous?.alias || inherited?.alias || null,
      lanes: {},
      activeWeeksSet: new Set(comparable ? previous?.activeWeeks || [] : []),
      previous,
      inherited
    });
  }
  for (const category of SEASON_CATEGORY_ORDER.filter((item) => item !== 'unicorn')) {
    for (const row of rankings[category] || []) {
      const current = candidates.get(row.address) || {
        address: row.address, alias: row.alias || null, lanes: {}, activeWeeksSet: new Set(), previous: null, inherited: null
      };
      if (row.alias) current.alias = row.alias;
      (row.activeWeeks || []).forEach((week) => current.activeWeeksSet.add(week));
      const previousLane = current.previous?.lanes?.[category] || null;
      const previousBest = current.previous?.personalBests?.[category] || null;
      current.lanes[category] = {
        rank: row.rank,
        eligibleCount: laneStatus[category]?.eligibleCount || rankings[category].length,
        publishedDepth: DEEP_RANKING_LIMIT,
        outsidePublishedDepth: row.rank > DEEP_RANKING_LIMIT,
        scoreLabel: row.scoreLabel,
        scoreVector: row.scoreVector,
        delta: row.delta,
        previousRank: row.previousRank,
        passGap: row.rank > DEEP_RANKING_LIMIT
          ? { next: null, topTen: row.passGap?.topTen || null, leader: null }
          : row.passGap,
        badgeProgress: badgeProgress(category, row),
        activeWeeks: row.activeWeeks || [],
        personalBestRank: Math.min(
          row.rank,
          number(previousLane?.personalBestRank) || row.rank,
          number(previousBest?.rank) || row.rank
        ),
        sourceUrl: row.sourceUrl
      };
      candidates.set(row.address, current);
    }
  }

  const byAddress = {};
  for (const [address, current] of candidates) {
    const unicornRank = unicornByAddress.get(address) || null;
    const personalBests = { ...(current.inherited?.personalBests || {}) };
    for (const [category, best] of Object.entries(current.previous?.personalBests || {})) {
      const inheritedBest = personalBests[category];
      if (personalBestImproves(best, inheritedBest)) personalBests[category] = best;
    }
    for (const [category, lane] of Object.entries(current.lanes)) {
      const known = personalBests[category];
      const laneRuleHash = rules?.laneRuleHashes?.[category] || null;
      const improvesAtTiedRank = known
        && lane.rank === known.rank
        && laneRuleHash
        && known.laneRuleHash === laneRuleHash
        && scoreVectorImproves(lane.scoreVector, known.scoreVector);
      if (!known || lane.personalBestRank < known.rank || improvesAtTiedRank) {
        personalBests[category] = {
          rank: lane.personalBestRank,
          scoreLabel: lane.scoreLabel,
          scoreVector: lane.scoreVector,
          laneRuleHash,
          seasonId: season.id,
          recordedAt: generatedAt
        };
      }
    }
    if (unicornRank) {
      const known = personalBests.unicorn;
      const laneRuleHash = rules?.laneRuleHashes?.unicorn || null;
      const improvesAtTiedRank = known
        && unicornRank.rank === known.rank
        && laneRuleHash
        && known.laneRuleHash === laneRuleHash
        && scoreVectorImproves(unicornRank.scoreVector, known.scoreVector);
      if (!known || unicornRank.rank < known.rank || improvesAtTiedRank) personalBests.unicorn = {
        rank: unicornRank.rank,
        scoreLabel: unicornRank.scoreLabel,
        scoreVector: unicornRank.scoreVector,
        laneRuleHash,
        seasonId: season.id,
        recordedAt: generatedAt
      };
    }
    const laneEntries = Object.entries(current.lanes);
    const qualifyingLanes = laneEntries
      .filter(([category, lane]) => laneStatus[category]?.status === 'ready' && lane.rank <= UNICORN_QUALIFYING_RANK)
      .map(([category, lane]) => ({ category, rank: lane.rank }))
      .sort((left, right) => left.rank - right.rank);
    const touchedLanes = laneEntries.map(([category, lane]) => ({ category, rank: lane.rank }));
    const nearMisses = laneEntries
      .filter(([, lane]) => lane.rank > 10 && lane.rank <= 25 && lane.passGap?.topTen)
      .sort((left, right) => left[1].rank - right[1].rank)
      .slice(0, 3)
      .map(([category, lane]) => ({ category, rank: lane.rank, passGap: lane.passGap.topTen }));
    const activeWeeks = sortedWeeks(current.activeWeeksSet);
    const completedWeeks = Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(season.activatedAt)) / (7 * 86400000)));
    const completedActiveWeeks = activeWeeks.filter((week) => week <= completedWeeks);
    const activeWeekStreak = longestConsecutive(completedActiveWeeks);
    const priorBadges = [
      ...(current.inherited?.badges || []),
      ...(current.previous?.badges || [])
    ];
    const badgeMap = new Map(priorBadges.map((badge) => [badge.id, badge]));
    for (const { category, rank } of touchedLanes) {
      const laneBadgeId = `season-${season.id}-lane-${category}`;
      if (!badgeMap.has(laneBadgeId)) badgeMap.set(laneBadgeId, passportBadge(laneBadgeId, `${season.displayLabel} ${SEASON_LANE_RULES[category].title} lane touched`, season.id, generatedAt));
      const progress = current.lanes[category]?.badgeProgress;
      const lifetimeMaxiId = `lifetime-maxi-${category}`;
      if (progress?.earned && !badgeMap.has(lifetimeMaxiId)) {
        badgeMap.set(lifetimeMaxiId, passportBadge(lifetimeMaxiId, `${progress.label} lifetime milestone`, season.id, generatedAt));
      }
      const topTenId = `season-${season.id}-top-10-${category}`;
      if (rank <= 10 && !badgeMap.has(topTenId)) badgeMap.set(topTenId, passportBadge(topTenId, `${season.displayLabel} ${SEASON_LANE_RULES[category].title} top 10`, season.id, generatedAt));
      if (rank === 1 && ['finalizing', 'finalized'].includes(season.status)) {
        const championId = `champion-${season.id}-${category}`;
        if (!badgeMap.has(championId)) badgeMap.set(championId, passportBadge(championId, `${season.displayLabel || season.protocolName} ${SEASON_LANE_RULES[category].title} Champion`, season.id, generatedAt));
      }
    }
    const seasonUnicornId = `season-${season.id}-unicorn`;
    if (qualifyingLanes.length >= UNICORN_MINIMUM_BREADTH && !badgeMap.has(seasonUnicornId)) {
      badgeMap.set(seasonUnicornId, passportBadge(seasonUnicornId, `${season.displayLabel} Unicorn`, season.id, generatedAt));
    }
    if (unicornRank?.rank === 1 && ['finalizing', 'finalized'].includes(season.status)) {
      const championId = `champion-${season.id}-unicorn`;
      if (!badgeMap.has(championId)) badgeMap.set(championId, passportBadge(championId, `${season.displayLabel || `${season.protocolName} Season`} Unicorn Champion`, season.id, generatedAt));
    }
    const activeWeekStreakId = `season-${season.id}-active-week-streak`;
    if (activeWeekStreak >= 2 && !badgeMap.has(activeWeekStreakId)) {
      badgeMap.set(activeWeekStreakId, passportBadge(activeWeekStreakId, `${season.displayLabel} active-week streak`, season.id, generatedAt));
    }
    const passport = {
      address,
      alias: current.alias,
      lanes: current.lanes,
      personalBests,
      touchedLanes,
      nearMisses,
      activeWeeks,
      activeWeekStreak,
      badges: [...badgeMap.values()],
      unicorn: {
        earned: qualifyingLanes.length >= UNICORN_MINIMUM_BREADTH,
        rank: unicornRank?.rank || null,
        previousRank: unicornRank?.previousRank || null,
        delta: unicornRank?.delta ?? null,
        scoreLabel: unicornRank?.scoreLabel || null,
        points: unicornRank?.points || 0,
        badgeProgress: {
          ...SEASON_LANE_RULES.unicorn.passportMilestone,
          value: qualifyingLanes.length,
          remaining: Math.max(0, UNICORN_MINIMUM_BREADTH - qualifyingLanes.length),
          percent: Math.min(100, Math.round((qualifyingLanes.length / UNICORN_MINIMUM_BREADTH) * 100)),
          earned: qualifyingLanes.length >= UNICORN_MINIMUM_BREADTH
        },
        qualifyingRank: UNICORN_QUALIFYING_RANK,
        qualifyingLanes,
        breadth: qualifyingLanes.length,
        lanesNeeded: Math.max(0, UNICORN_MINIMUM_BREADTH - qualifyingLanes.length),
        progressPercent: Math.min(100, Math.round((qualifyingLanes.length / UNICORN_MINIMUM_BREADTH) * 100))
      }
    };
    const personalBestCategories = Object.keys(personalBests);
    byAddress[address] = laneEntries.length === 1
      && laneEntries[0][0] === 'transaction'
      && personalBestCategories.every((category) => category === 'transaction')
      && !unicornRank
      ? {
          format: 'transaction-only-v1',
          address,
          alias: current.alias,
          transaction: {
            rank: current.lanes.transaction.rank,
            eligibleCount: current.lanes.transaction.eligibleCount,
            outsidePublishedDepth: current.lanes.transaction.outsidePublishedDepth,
            scoreLabel: current.lanes.transaction.scoreLabel,
            scoreVector: current.lanes.transaction.scoreVector,
            delta: current.lanes.transaction.delta,
            previousRank: current.lanes.transaction.previousRank,
            topTenGap: current.lanes.transaction.passGap?.topTen || null,
            badgeProgress: current.lanes.transaction.badgeProgress,
            activeWeeks: current.lanes.transaction.activeWeeks,
            personalBestRank: current.lanes.transaction.personalBestRank,
            sourceUrl: current.lanes.transaction.sourceUrl
          },
          personalBest: personalBests.transaction || null,
          badges: [...badgeMap.values()],
          activeWeeks,
          activeWeekStreak,
          ...(qualifyingLanes.length ? {
            unicornProgress: {
              qualifyingLanes,
              breadth: qualifyingLanes.length,
              lanesNeeded: Math.max(0, UNICORN_MINIMUM_BREADTH - qualifyingLanes.length),
              progressPercent: Math.min(100, Math.round((qualifyingLanes.length / UNICORN_MINIMUM_BREADTH) * 100)),
              badgeProgress: passport.unicorn.badgeProgress
            }
          } : {})
        }
      : passport;
  }
  return { format: 'address-map', indexedAddresses: Object.keys(byAddress).length, byAddress };
}

function buildHonors(rankings, laneStatus, historyBefore, passportIndex, previousSnapshot, comparable, previousSeasonSnapshot, season, generatedAt, rules) {
  const climbing = [];
  if (comparable) {
    for (const category of SEASON_CATEGORY_ORDER) {
      for (const row of rankings[category] || []) {
        if (row.deltaComparable && row.delta > 0) climbing.push({
          address: row.address, alias: row.alias, category,
          previousRank: row.previousRank, rank: row.rank, delta: row.delta,
          checkpointFrom: previousSnapshot.generatedAt,
          checkpointTo: generatedAt
        });
      }
    }
    climbing.sort((left, right) => right.delta - left.delta || left.rank - right.rank || compareCodePoint(left.address, right.address));
  }
  const climbLedger = [...(previousSnapshot?.honors?.rankClimb?.candidates || []), ...climbing]
    .sort((left, right) => right.delta - left.delta || left.rank - right.rank || compareCodePoint(left.address, right.address))
    .slice(0, 10);

  const debuts = [];
  if (comparable) {
    for (const category of SEASON_CATEGORY_ORDER) {
      const seen = new Set(historyBefore?.[category] || []);
      for (const row of (rankings[category] || []).slice(0, 10)) {
        if (!seen.has(row.address)) debuts.push({
          address: row.address,
          alias: row.alias,
          category,
          rankAtDebut: row.rank,
          firstRecordedAt: generatedAt
        });
      }
    }
    debuts.sort((left, right) => left.rankAtDebut - right.rankAtDebut || compareCodePoint(left.address, right.address));
  }
  const topTenDebutMap = new Map();
  for (const row of [...(previousSnapshot?.honors?.topTenDebut?.winners || []), ...debuts]) {
    topTenDebutMap.set(`${row.category}:${row.address}`, topTenDebutMap.get(`${row.category}:${row.address}`) || row);
  }
  const topTenDebutLedger = [...topTenDebutMap.values()].sort((left, right) => (
    Date.parse(left.firstRecordedAt || '') - Date.parse(right.firstRecordedAt || '')
    || left.rankAtDebut - right.rankAtDebut
    || compareCodePoint(left.address, right.address)
  ));

  const completedWeeks = Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(season.activatedAt)) / (7 * 86400000)));
  const streaks = Object.values(passportIndex.byAddress)
    .filter((passport) => passport.activeWeekStreak >= 2)
    .map((passport) => ({ address: passport.address, alias: passport.alias, streak: passport.activeWeekStreak, activeWeeks: passport.activeWeeks }))
    .sort((left, right) => right.streak - left.streak || compareCodePoint(left.address, right.address));

  const readyMeritLanes = SEASON_CATEGORY_ORDER.filter((category) => (
    category !== 'unicorn' && laneStatus?.[category]?.status === 'ready'
  ));
  const diversified = Object.values(passportIndex.byAddress)
    .map((passport) => {
      const lanes = readyMeritLanes
        .filter((category) => passport?.lanes?.[category]?.rank)
        .map((category) => ({ category, rank: passport.lanes[category].rank }));
      return {
        address: passport.address,
        alias: passport.alias,
        breadth: lanes.length,
        rankSum: lanes.reduce((total, lane) => total + lane.rank, 0),
        lanes
      };
    })
    .filter((row) => row.breadth >= 2)
    .sort((left, right) => (
      right.breadth - left.breadth
      || left.rankSum - right.rankSum
      || compareCodePoint(left.address, right.address)
    ));

  const laneDebut = (category) => {
    if (!comparable) {
      return {
        status: 'pending',
        reason: `A second snapshot is required before first-recorded ${category} participation can be measured.`,
        claimScope: 'first recorded since the prior same-season snapshot; not first-ever on-chain'
      };
    }
    const priorPassports = previousSnapshot?.passportIndex?.byAddress || {};
    const newlyRecorded = (rankings[category] || [])
      .filter((row) => !priorPassports?.[row.address]?.lanes?.[category])
      .map((row) => ({
        address: row.address,
        alias: row.alias,
        rankAtDebut: row.rank,
        scoreLabelAtDebut: row.scoreLabel,
        firstRecordedAt: generatedAt
      }));
    const awardKey = `${category}Debut`;
    const ledger = new Map();
    for (const row of [...(previousSnapshot?.honors?.[awardKey]?.debuts || []), ...newlyRecorded]) {
      if (!ledger.has(row.address)) ledger.set(row.address, row);
    }
    const debuts = [...ledger.values()].sort((left, right) => (
      Date.parse(left.firstRecordedAt || '') - Date.parse(right.firstRecordedAt || '')
      || left.rankAtDebut - right.rankAtDebut
      || compareCodePoint(left.address, right.address)
    ));
    const candidates = [...debuts].sort((left, right) => left.rankAtDebut - right.rankAtDebut || compareCodePoint(left.address, right.address));
    return debuts.length
      ? {
          status: 'ready',
          winner: candidates[0],
          candidates: candidates.slice(0, 10),
          debuts,
          recordedCount: debuts.length,
          newSinceLastSnapshot: newlyRecorded.length,
          comparedWith: previousSnapshot.generatedAt,
          claimScope: 'first recorded since the prior same-season snapshot; not first-ever on-chain'
        }
      : {
          status: 'empty',
          reason: `No first-recorded ${category} participant appeared since the prior same-season snapshot.`,
          debuts: [],
          recordedCount: 0,
          newSinceLastSnapshot: 0,
          comparedWith: previousSnapshot.generatedAt,
          claimScope: 'first recorded since the prior same-season snapshot; not first-ever on-chain'
        };
  };

  const comeback = [];
  const compatibleLanes = [];
  const excludedLanes = [];
  if (previousSeasonSnapshot) {
    const contractSensitive = new Set(['defi', 'gaming', 'liquidity']);
    for (const category of SEASON_CATEGORY_ORDER) {
      const ruleComparable = Boolean(
        rules?.laneRuleHashes?.[category]
        && previousSeasonSnapshot?.rules?.laneRuleHashes?.[category]
        && rules.laneRuleHashes[category] === previousSeasonSnapshot.rules.laneRuleHashes[category]
      );
      const requiredCoverage = category === 'unicorn'
        ? [...contractSensitive]
        : contractSensitive.has(category) ? [category] : [];
      const coverageComparable = requiredCoverage.every((lane) => (
        rules?.semanticContractCoverageHashes?.[lane]
        && previousSeasonSnapshot?.rules?.semanticContractCoverageHashes?.[lane]
        && rules.semanticContractCoverageHashes[lane] === previousSeasonSnapshot.rules.semanticContractCoverageHashes[lane]
      ));
      if (!ruleComparable || !coverageComparable) {
        excludedLanes.push({
          category,
          reason: !ruleComparable
            ? 'lane evaluator or scoring rule changed'
            : 'semantic resolved-contract coverage changed'
        });
        continue;
      }
      compatibleLanes.push(category);
      const prior = new Map((previousSeasonSnapshot.rankings?.[category] || []).map((row) => [row.address, row.rank]));
      for (const row of rankings[category] || []) {
        if (!prior.has(row.address)) continue;
        const delta = prior.get(row.address) - row.rank;
        if (delta > 0) comeback.push({ address: row.address, alias: row.alias, category, previousRank: prior.get(row.address), rank: row.rank, delta });
      }
    }
    comeback.sort((left, right) => right.delta - left.delta || left.rank - right.rank || compareCodePoint(left.address, right.address));
  }

  return {
    rankClimb: comparable
      ? climbLedger.length ? {
          status: 'ready',
          label: 'Largest checkpoint rank climb',
          measurement: 'best single movement between consecutive same-season snapshots; not start-to-finish',
          winner: climbLedger[0],
          candidates: climbLedger,
          comparedWith: previousSnapshot.generatedAt
        }
        : { status: 'empty', reason: 'No wallet improved a comparable published rank.', label: 'Largest checkpoint rank climb' }
      : { status: 'pending', reason: 'A second snapshot in this protocol season is required.' },
    topTenDebut: comparable
      ? topTenDebutLedger.length ? { status: 'ready', winners: topTenDebutLedger, newSinceLastSnapshot: debuts.length }
        : { status: 'empty', reason: 'No first recorded top-10 entry since the previous snapshot.' }
      : { status: 'pending', reason: 'Top-10 history begins with this season snapshot.' },
    activeWeekStreak: completedWeeks >= 2
      ? streaks.length ? { status: 'ready', winner: streaks[0], candidates: streaks.slice(0, 10), completedWeeks }
        : { status: 'empty', reason: 'No wallet was active in two consecutive completed season weeks.', completedWeeks }
      : { status: 'pending', reason: 'Two completed protocol-season weeks are required.', completedWeeks },
    diversifiedWallet: readyMeritLanes.length < 2
      ? {
          status: 'pending',
          reason: 'At least two ready merit lanes are required to measure same-season diversification.',
          readyLanes: readyMeritLanes
        }
      : diversified.length
        ? { status: 'ready', winner: diversified[0], candidates: diversified.slice(0, 10), readyLanes: readyMeritLanes }
        : { status: 'empty', reason: 'No wallet has touched two ready merit lanes this season.', readyLanes: readyMeritLanes },
    collectorDebut: laneDebut('collector'),
    artistDebut: laneDebut('artist'),
    comeback: previousSeasonSnapshot && !compatibleLanes.length
      ? {
          status: 'unavailable',
          reason: 'No lane has compatible evaluator, scoring-rule, and required semantic contract-coverage hashes in the prior season.',
          previousSeasonId: previousSeasonSnapshot.season?.id,
          compatibleLanes,
          excludedLanes
        }
      : previousSeasonSnapshot
      ? comeback.length ? {
          status: 'ready',
          winner: comeback[0],
          candidates: comeback.slice(0, 10),
          previousSeasonId: previousSeasonSnapshot.season?.id,
          compatibleLanes,
          excludedLanes
        }
        : {
            status: 'empty',
            reason: 'No wallet improved in a compatible previous-season lane.',
            previousSeasonId: previousSeasonSnapshot.season?.id,
            compatibleLanes,
            excludedLanes
          }
      : { status: 'pending', reason: 'A finalized prior protocol season is required.' }
  };
}

export function buildSeasonCompetition({
  rawRankings,
  availability = {},
  season,
  rules = null,
  generatedAt,
  previousSnapshot = null,
  previousSeasonSnapshot = null,
  inheritedPassportSnapshot = null
}) {
  const comparable = previousSnapshot?.season?.protocolHash === season.protocolHash;
  const preliminaryStatus = {};
  for (const category of SEASON_CATEGORY_ORDER.filter((item) => item !== 'unicorn')) {
    const explicit = availability[category];
    const rows = rawRankings[category] || [];
    preliminaryStatus[category] = explicit?.status === 'unavailable'
      ? { ...explicit, category, title: SEASON_LANE_RULES[category].title, eligibleCount: 0, publishedCount: 0 }
      : {
          category,
          title: SEASON_LANE_RULES[category].title,
          status: rows.length ? 'ready' : 'empty',
          reason: rows.length ? null : explicit?.reason || 'No qualifying season activity was found.',
          coverageState: explicit?.coverageState || 'declared',
          coverage: explicit?.coverage || SEASON_LANE_RULES[category].coverage,
          eligibleCount: rows.length,
          publishedCount: Math.min(rows.length, DEEP_RANKING_LIMIT),
          completePublishedRanking: rows.length <= DEEP_RANKING_LIMIT
        };
  }
  rawRankings.unicorn = rankSeasonUnicorn(rawRankings, preliminaryStatus);
  preliminaryStatus.unicorn = {
    category: 'unicorn',
    title: SEASON_LANE_RULES.unicorn.title,
    status: rawRankings.unicorn.length ? 'ready' : 'empty',
    reason: rawRankings.unicorn.length ? null : `No wallet has reached ${UNICORN_MINIMUM_BREADTH} same-season top-${UNICORN_QUALIFYING_RANK} lanes.`,
    coverageState: 'derived-ready-season-lanes',
    coverage: SEASON_LANE_RULES.unicorn.coverage,
    eligibleCount: rawRankings.unicorn.length,
    publishedCount: Math.min(rawRankings.unicorn.length, DEEP_RANKING_LIMIT),
    completePublishedRanking: rawRankings.unicorn.length <= DEEP_RANKING_LIMIT
  };

  const allRankings = {};
  const rankings = {};
  for (const category of SEASON_CATEGORY_ORDER) {
    allRankings[category] = preliminaryStatus[category].status === 'unavailable'
      ? []
      : decorateRanking(category, rawRankings[category] || [], comparable ? previousSnapshot : null);
    rankings[category] = allRankings[category].slice(0, DEEP_RANKING_LIMIT);
  }
  const historyBefore = comparable ? previousSnapshot?.history?.topTenByLane || {} : {};
  const history = buildHistory(rankings, previousSnapshot, comparable);
  const passportIndex = buildPassports(allRankings, preliminaryStatus, season, generatedAt, previousSnapshot, comparable, inheritedPassportSnapshot, rules);
  const honors = buildHonors(allRankings, preliminaryStatus, historyBefore, passportIndex, previousSnapshot, comparable, previousSeasonSnapshot, season, generatedAt, rules);
  const leaders = SEASON_CATEGORY_ORDER.map((category) => {
    const status = preliminaryStatus[category];
    const top = rankings[category]?.[0];
    if (top) return top;
    return {
      category,
      title: SEASON_LANE_RULES[category].title,
      status: status.status,
      reason: status.reason,
      method: SEASON_LANE_RULES[category].method,
      windowKind: 'protocol-season'
    };
  });
  return { laneStatus: preliminaryStatus, rankings, leaders, passportIndex, honors, history };
}

export function validateSeasonSnapshot(snapshot) {
  const errors = [];
  if (number(snapshot?.schema) !== SEASON_SCHEMA) errors.push(`season snapshot schema must be ${SEASON_SCHEMA}`);
  if (!Number.isFinite(Date.parse(snapshot?.generatedAt || ''))) errors.push('season snapshot generatedAt must be an ISO timestamp');
  if (!Number.isFinite(Date.parse(snapshot?.observedAt || ''))) errors.push('season snapshot observedAt must be an ISO timestamp');
  if (!snapshot?.season?.protocolHash || number(snapshot?.season?.activationLevel) <= 0) errors.push('season protocol hash and activation level are required');
  if (!Number.isFinite(Date.parse(snapshot?.season?.activatedAt || ''))) errors.push('season activatedAt must be an ISO timestamp');
  if (
    !snapshot?.rules?.version
    || !snapshot?.rules?.evaluatorVersion
    || !snapshot?.rules?.evaluatorImplementationHash
    || !snapshot?.rules?.rulesHash
    || !snapshot?.rules?.taxonomyHash
    || !snapshot?.rules?.contractCoverageHash
    || !snapshot?.rules?.semanticContractCoverageHash
    || !snapshot?.rules?.semanticContractCoverageHashes
    || !snapshot?.rules?.laneRuleHashes
  ) errors.push('frozen season evaluator, rules, taxonomy, lane, and resolved-contract coverage hashes are required');
  if (number(snapshot?.deepRankingLimit) !== DEEP_RANKING_LIMIT) errors.push(`deepRankingLimit must be ${DEEP_RANKING_LIMIT}`);
  for (const category of SEASON_CATEGORY_ORDER) {
    const status = snapshot?.laneStatus?.[category];
    const ranking = snapshot?.rankings?.[category];
    if (!status || !['ready', 'empty', 'unavailable'].includes(status.status)) errors.push(`${category} has invalid lane status`);
    if (!Array.isArray(ranking)) {
      errors.push(`${category} ranking must be an array`);
      continue;
    }
    if (ranking.length > DEEP_RANKING_LIMIT) errors.push(`${category} exceeds deep ranking limit`);
    if (status?.status === 'unavailable' && ranking.length) errors.push(`${category} publishes rows while unavailable`);
    const addresses = new Set();
    ranking.forEach((row, index) => {
      if (row.rank !== index + 1) errors.push(`${category} rank order is invalid`);
      if (!isImplicitAddress(row.address)) errors.push(`${category} rank ${index + 1} has an invalid address`);
      if (!Array.isArray(row.scoreVector) || !row.scoreVector.length) errors.push(`${category} rank ${index + 1} lacks a score vector`);
      if (!row.passGap || !Object.hasOwn(row, 'delta')) errors.push(`${category} rank ${index + 1} lacks movement or pass-gap data`);
      if (addresses.has(row.address)) errors.push(`${category} repeats ${row.address}`);
      addresses.add(row.address);
    });
  }
  errors.push(...truncationCoverageErrors(snapshot));
  for (const award of ['rankClimb', 'topTenDebut', 'activeWeekStreak', 'diversifiedWallet', 'collectorDebut', 'artistDebut', 'comeback']) {
    if (!['ready', 'empty', 'pending', 'unavailable'].includes(snapshot?.honors?.[award]?.status)) {
      errors.push(`honors.${award} has invalid status`);
    }
  }
  for (const award of ['collectorDebut', 'artistDebut']) {
    if (!String(snapshot?.honors?.[award]?.claimScope || '').includes('not first-ever')) {
      errors.push(`honors.${award} must limit its claim to first recorded since a prior same-season snapshot`);
    }
    if (snapshot?.honors?.[award]?.status === 'ready') {
      const debuts = snapshot.honors[award].debuts || [];
      if (number(snapshot.honors[award].recordedCount) !== debuts.length) errors.push(`honors.${award} recordedCount does not match its cumulative ledger`);
      if (new Set(debuts.map((row) => row.address)).size !== debuts.length) errors.push(`honors.${award} cumulative ledger repeats an address`);
    }
  }
  if (snapshot?.honors?.rankClimb?.status === 'ready' && (
    snapshot.honors.rankClimb.label !== 'Largest checkpoint rank climb'
    || !String(snapshot.honors.rankClimb.measurement || '').includes('consecutive same-season snapshots')
    || !snapshot.honors.rankClimb?.winner?.checkpointFrom
    || !snapshot.honors.rankClimb?.winner?.checkpointTo
  )) errors.push('honors.rankClimb must preserve and precisely label its checkpoint ledger');
  if (snapshot?.honors?.topTenDebut?.status === 'ready') {
    const winners = snapshot.honors.topTenDebut.winners || [];
    if (new Set(winners.map((row) => `${row.category}:${row.address}`)).size !== winners.length) errors.push('honors.topTenDebut cumulative ledger contains duplicates');
  }
  if (snapshot?.honors?.diversifiedWallet?.status === 'ready' && number(snapshot.honors.diversifiedWallet?.winner?.breadth) < 2) {
    errors.push('honors.diversifiedWallet winner must touch at least two ready merit lanes');
  }
  const passports = snapshot?.passportIndex?.byAddress;
  if (!passports || typeof passports !== 'object') errors.push('season snapshot passport index is required');
  else {
    const participationCounts = Object.fromEntries(SEASON_CATEGORY_ORDER.map((category) => [category, 0]));
    for (const [address, rawPassport] of Object.entries(passports)) {
      const passport = expandPassportRecord(rawPassport);
      if (!isImplicitAddress(address)) errors.push(`passport index has invalid address ${address}`);
      for (const [category, lane] of Object.entries(passport?.lanes || {})) {
        participationCounts[category] = number(participationCounts[category]) + 1;
        if (!lane?.badgeProgress || lane.badgeProgress.percent == null || !Number.isFinite(Number(lane.badgeProgress.percent))) errors.push(`${address} ${category} lane lacks stable badge progress`);
        if (Boolean(lane?.outsidePublishedDepth) !== (number(lane?.rank) > DEEP_RANKING_LIMIT)) errors.push(`${address} ${category} published-depth state is inconsistent`);
      }
      if (passport?.unicorn?.rank) participationCounts.unicorn += 1;
    }
    for (const category of SEASON_CATEGORY_ORDER) {
      const eligible = number(snapshot?.laneStatus?.[category]?.eligibleCount);
      if (participationCounts[category] !== eligible) {
        errors.push(`${category} Passport participation covers ${participationCounts[category]}/${eligible} eligible addresses`);
      }
    }
  }
  return errors;
}

export function validateSeasonCatalog(catalog) {
  const errors = [];
  if (number(catalog?.schema) !== SEASON_CATALOG_SCHEMA) errors.push(`season catalog schema must be ${SEASON_CATALOG_SCHEMA}`);
  if (!Array.isArray(catalog?.seasons) || !catalog.seasons.length) errors.push('season catalog must contain at least one season');
  const ids = new Set();
  let active = 0;
  let settling = 0;
  for (const season of catalog?.seasons || []) {
    if (!season?.id || !season?.protocolHash || number(season?.activationLevel) <= 0) errors.push('season catalog entry is incomplete');
    if (ids.has(season?.id)) errors.push(`season catalog repeats ${season.id}`);
    ids.add(season?.id);
    if (season?.status === 'active') active += 1;
    if (season?.status === 'settling') settling += 1;
    if (!['active', 'settling', 'finalized'].includes(season?.status)) errors.push(`${season?.id || 'season'} has invalid status`);
    if (season?.status === 'finalized' && !season?.archiveUrl) errors.push(`${season.id} is finalized without an archive`);
  }
  const orderedSeasons = [...(catalog?.seasons || [])].sort((left, right) => Number(left.activationLevel) - Number(right.activationLevel));
  for (let index = 0; index < orderedSeasons.length; index += 1) {
    const season = orderedSeasons[index];
    if (season.status !== 'finalized') continue;
    const next = orderedSeasons[index + 1];
    if (!next) errors.push(`${season.id} is finalized without its immediate successor in the catalog`);
    else {
      if (Number(next.protocolNumber) !== Number(season.protocolNumber) + 1) errors.push(`${season.id} skips its immediate protocol successor`);
      if (season.endsAt !== next.activatedAt) errors.push(`${season.id} finalized endsAt does not match ${next.id} activation`);
    }
  }
  const rolloverStatus = catalog?.rollover?.status;
  if (active !== 1) errors.push(`season catalog must have one active season, found ${active}`);
  if (settling > 1) errors.push(`season catalog can have at most one settling season, found ${settling}`);
  if (settling === 1 && rolloverStatus !== 'active-with-settling') errors.push('a settling season requires active-with-settling rollover metadata');
  if (settling === 0 && catalog?.rollover != null) errors.push('rollover metadata is only allowed while a prior season is settling');
  if (rolloverStatus === 'active-with-settling') {
    const settlingEntry = (catalog?.seasons || []).find((season) => season.status === 'settling');
    if (!settlingEntry || catalog?.rollover?.settlingSeasonId !== settlingEntry.id) errors.push('rollover settlingSeasonId must identify the settling season');
    if (catalog?.rollover?.activeSeasonId !== catalog?.activeSeasonId) errors.push('rollover activeSeasonId must match the current active season');
    if (!Number.isFinite(Date.parse(catalog?.rollover?.eligibleAt || ''))) errors.push('rollover must declare a settlement eligibility time');
    if (!catalog?.rollover?.evaluatorConstraint?.implementationHash) errors.push('rollover must freeze the settling evaluator constraint');
  }
  const activeEntry = (catalog?.seasons || []).find((season) => season.id === catalog?.activeSeasonId);
  if (!activeEntry) errors.push('activeSeasonId does not match the catalog');
  else if (activeEntry.status !== 'active') errors.push('activeSeasonId must point to the active season');
  if (catalog?.current?.seasonId !== catalog?.activeSeasonId) errors.push('current.seasonId must match activeSeasonId');
  if (activeEntry && (
    catalog?.current?.displayLabel !== activeEntry.displayLabel
    || catalog?.current?.summaryPath !== activeEntry.summaryPath
    || catalog?.current?.rulesPath !== activeEntry.rulesPath
    || catalog?.current?.passportPathTemplate !== activeEntry.passportPathTemplate
  )) errors.push('current artifact paths must match the active season entry');
  return errors;
}
