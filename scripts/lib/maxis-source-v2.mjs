import {
  DEEP_RANKING_LIMIT,
  MAXIS_V2_SOURCE_LIMITS,
  SEASON_EVALUATOR_VERSION,
  SEASON_LANE_RULES,
  SEASON_SCHEMA,
  buildSeasonCompetition,
  rankSeasonAppActivity,
  rankSeasonBuilders,
  rankSeasonDelegation,
  rankSeasonGovernance,
  rankSeasonLiquidity,
  rankSeasonMints,
  rankSeasonNftSales,
  rankSeasonStaking,
  rankSeasonTransactionAccounts
} from './maxis-evaluator-v2.mjs';
import { isImplicitAddress } from './maxis-evaluator-v2-primitives.mjs';

export const MAXIS_SOURCE_VERSION = 'maxis-source-v2';
export const EVALUATOR_VERSION = SEASON_EVALUATOR_VERSION;
export const IMMUTABLE_IMPLEMENTATION_FILES = Object.freeze([
  'scripts/lib/maxis-evaluator-v2.mjs',
  'scripts/lib/maxis-evaluator-v2-primitives.mjs',
  'scripts/lib/maxis-transactions-v2.mjs',
  'scripts/lib/maxis-coverage-v2.mjs',
  'scripts/lib/maxis-pagination.mjs',
  'scripts/lib/maxis-source-v2.mjs',
  'scripts/lib/maxis-artifact-budget.mjs'
]);

// These values are part of the immutable v2 source contract. The refresh
// runner imports them instead of maintaining a second mutable copy.
export const MAXIS_SOURCE_CONFIG = MAXIS_V2_SOURCE_LIMITS;

function formatInteger(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function requireIo(io, name) {
  if (typeof io?.[name] !== 'function') throw new Error(`Maxis v2 source adapter requires io.${name}`);
  return io[name];
}

export async function fetchSeasonDataV2({
  season,
  rules,
  generatedAt,
  observedAt = generatedAt,
  endLevelExclusive = null
}, io) {
  const fetchObjktListingSales = requireIo(io, 'fetchObjktListingSales');
  const fetchObjktMints = requireIo(io, 'fetchObjktMints');
  const fetchAppTransactions = requireIo(io, 'fetchAppTransactions');
  const fetchPagedTzkt = requireIo(io, 'fetchPagedTzkt');
  const updateTransactionAccumulator = requireIo(io, 'updateTransactionAccumulator');
  const fetchClosingDelegationAccounts = requireIo(io, 'fetchClosingDelegationAccounts');
  const fetchCurrentAccounts = requireIo(io, 'fetchCurrentAccounts');
  const fetchTargetTransactions = requireIo(io, 'fetchTargetTransactions');

  const from = season.activatedAt;
  const to = generatedAt;
  const frozenConfig = rules.taxonomySnapshot;
  const seasonCoverage = rules.contractCoverageSnapshot;
  const contractLookup = new Map(seasonCoverage.map((item) => [item.address, item.app]));
  const operationParams = (extra = {}) => ({
    'level.ge': String(season.activationLevel),
    ...(endLevelExclusive ? { 'level.lt': String(endLevelExclusive) } : {}),
    'timestamp.lt': to,
    'sort.asc': 'id',
    ...extra
  });

  const transactionAccumulatorPromise = updateTransactionAccumulator({ season, rules, generatedAt, endLevelExclusive });
  const [
    listingSales,
    mints,
    appTransactions,
    ballots,
    proposals,
    votingPeriods,
    staking,
    delegations,
    originations,
    transactionAccumulator
  ] = await Promise.all([
    fetchObjktListingSales(from, to),
    fetchObjktMints(from, to, { tokenCreatedWithinWindow: true }),
    fetchAppTransactions(seasonCoverage, from, to),
    fetchPagedTzkt('/operations/ballots', operationParams()),
    fetchPagedTzkt('/operations/proposals', operationParams()),
    fetchPagedTzkt('/voting/periods', {
      'firstLevel.ge': String(season.activationLevel),
      ...(endLevelExclusive ? { 'firstLevel.lt': String(endLevelExclusive) } : {})
    }, { pageSize: 100, maxPages: 10 }),
    fetchPagedTzkt('/operations/staking', operationParams({ status: 'applied' })),
    fetchPagedTzkt('/operations/delegations', operationParams({ status: 'applied' })),
    fetchPagedTzkt('/operations/originations', operationParams({ status: 'applied' })),
    transactionAccumulatorPromise
  ]);

  const cappedSources = {
    objktListingSales: listingSales.truncated,
    objktMints: mints.truncated,
    appTransactions: appTransactions.truncated,
    ballots: ballots.truncated,
    proposals: proposals.truncated,
    votingPeriods: votingPeriods.truncated,
    staking: staking.truncated,
    delegations: delegations.truncated,
    originations: originations.truncated
  };

  const transactionWithinBudget = transactionAccumulator.bytes <= MAXIS_SOURCE_CONFIG.maxTransactionStateBytes;
  const transactionUnavailable = transactionWithinBudget
    ? null
    : `The exact Transaction accumulator is ${formatInteger(transactionAccumulator.bytes)} bytes, above the ${formatInteger(MAXIS_SOURCE_CONFIG.maxTransactionStateBytes)}-byte state budget. Its checkpoint is retained, but the lane is withheld until a compact state migration is available.`;

  const delegationAddresses = cappedSources.delegations
    ? []
    : [...new Set(delegations.rows.map((row) => row?.sender?.address).filter(isImplicitAddress))];
  const closingAccounts = endLevelExclusive && delegationAddresses.length
    ? await fetchClosingDelegationAccounts(delegations.rows, endLevelExclusive - 1)
    : null;
  const currentAccounts = closingAccounts
    ? closingAccounts.rows
    : delegationAddresses.length ? await fetchCurrentAccounts(delegationAddresses) : [];
  let delegationUnavailable = cappedSources.delegations
    ? `TzKT delegation operations reached the ${formatInteger(MAXIS_SOURCE_CONFIG.tzktMaxPages * MAXIS_SOURCE_CONFIG.tzktPageSize)}-row pagination bound. A partial winner is not published.`
    : null;
  if (!delegationUnavailable && closingAccounts?.missing?.length) {
    delegationUnavailable = `Exact-close delegation balances resolved ${formatInteger(currentAccounts.length)}/${formatInteger(closingAccounts.expected)} retained assignments at level ${formatInteger(endLevelExclusive - 1)}. A partial winner is not published.`;
  } else if (!delegationUnavailable && !closingAccounts && currentAccounts.length !== delegationAddresses.length) {
    delegationUnavailable = `Delegation retention reconciled ${formatInteger(currentAccounts.length)}/${formatInteger(delegationAddresses.length)} candidate accounts. A partial winner is not published.`;
  }

  const originatedContracts = cappedSources.originations
    ? []
    : [...new Set(originations.rows
        .filter((row) => row?.nonce == null && isImplicitAddress(row?.sender?.address))
        .map((row) => row?.originatedContract?.address)
        .filter(Boolean))];
  const builderCalls = originatedContracts.length
    ? await fetchTargetTransactions(originatedContracts, from, to)
    : { rows: [], truncated: false };
  const builderUnavailable = cappedSources.originations || builderCalls.truncated
    ? 'Builder originations or post-deploy calls reached a TzKT pagination bound. A partial winner is not published.'
    : null;

  const nftSalesUnavailable = cappedSources.objktListingSales
    ? `OBJKT listing sales reached the ${formatInteger(MAXIS_SOURCE_CONFIG.objktMaxPages * MAXIS_SOURCE_CONFIG.objktPageSize)}-row protocol-season pagination bound. Dependent winners are withheld.`
    : null;
  const mintUnavailable = cappedSources.objktMints
    ? `OBJKT mint events reached the ${formatInteger(MAXIS_SOURCE_CONFIG.objktMaxPages * MAXIS_SOURCE_CONFIG.objktPageSize)}-row protocol-season pagination bound. A partial winner is not published.`
    : nftSalesUnavailable;
  const appUnavailable = cappedSources.appTransactions
    ? 'Recognized-contract calls reached a TzKT pagination bound. DeFi, Gaming, and Liquidity winners are withheld.'
    : null;
  const governanceUnavailable = cappedSources.ballots || cappedSources.proposals || cappedSources.votingPeriods
    ? 'TzKT ballot or proposal pagination was incomplete. A partial Governance winner is not published.'
    : null;
  const stakingUnavailable = cappedSources.staking
    ? 'TzKT staking-operation pagination was incomplete. A partial Staking Growth winner is not published.'
    : null;

  const nft = nftSalesUnavailable ? { collector: [], artist: [] } : rankSeasonNftSales(listingSales.rows, from);
  const rawRankings = {
    transaction: transactionUnavailable ? [] : rankSeasonTransactionAccounts(transactionAccumulator.rows),
    collector: nft.collector,
    artist: nft.artist,
    minter: mintUnavailable ? [] : rankSeasonMints(mints.rows, listingSales.rows, from),
    defi: appUnavailable ? [] : rankSeasonAppActivity(appTransactions.rows, contractLookup, 'defi', from),
    gaming: appUnavailable ? [] : rankSeasonAppActivity(appTransactions.rows, contractLookup, 'gaming', from),
    governance: governanceUnavailable ? [] : rankSeasonGovernance(ballots.rows, proposals.rows, from, votingPeriods.rows),
    staking: stakingUnavailable ? [] : rankSeasonStaking(staking.rows, from),
    delegation: delegationUnavailable ? [] : rankSeasonDelegation(delegations.rows, currentAccounts, from),
    liquidity: appUnavailable ? [] : rankSeasonLiquidity(appTransactions.rows, contractLookup, frozenConfig.apps, from),
    bridge: [],
    builder: builderUnavailable ? [] : rankSeasonBuilders(originations.rows, builderCalls.rows, from)
  };

  const availability = {
    transaction: transactionUnavailable ? {
      status: 'unavailable',
      reason: transactionUnavailable,
      coverageState: 'withheld-incomplete'
    } : { coverageState: 'exhaustive' },
    collector: nftSalesUnavailable ? { status: 'unavailable', reason: nftSalesUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive-within-objkt-index' },
    artist: nftSalesUnavailable ? { status: 'unavailable', reason: nftSalesUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive-within-objkt-index' },
    minter: mintUnavailable ? { status: 'unavailable', reason: mintUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive-within-objkt-index' },
    defi: appUnavailable ? { status: 'unavailable', reason: appUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'curated-taxonomy', coverage: SEASON_LANE_RULES.defi.coverage },
    gaming: appUnavailable ? { status: 'unavailable', reason: appUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'curated-taxonomy', coverage: SEASON_LANE_RULES.gaming.coverage },
    governance: governanceUnavailable ? { status: 'unavailable', reason: governanceUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive' },
    staking: stakingUnavailable ? { status: 'unavailable', reason: stakingUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive' },
    delegation: delegationUnavailable ? { status: 'unavailable', reason: delegationUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive-reconciled-snapshot' },
    liquidity: appUnavailable ? { status: 'unavailable', reason: appUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'curated-entrypoints', coverage: SEASON_LANE_RULES.liquidity.coverage },
    bridge: {
      status: 'unavailable',
      coverageState: 'withheld-unfrozen-contract',
      reason: 'No canonical Etherlink L1 deposit contract and address-attribution rule is frozen in this season taxonomy. Publishing a bridge winner would be unsafe.'
    },
    builder: builderUnavailable ? { status: 'unavailable', reason: builderUnavailable, coverageState: 'withheld-incomplete' } : { coverageState: 'exhaustive-season-originations' }
  };

  return {
    rawRankings,
    availability,
    sourceReceipts: {
      activation: season.activationReceipt,
      contractCatalog: {
        source: 'TzKT contracts catalog',
        queriedKinds: MAXIS_SOURCE_CONFIG.contractCatalogKinds,
        recentRowsRequestedPerKind: frozenConfig.contractCatalogLimit,
        frozenAt: rules.frozenAt,
        resolvedContracts: seasonCoverage.length,
        resolvedByKind: Object.fromEntries(MAXIS_SOURCE_CONFIG.contractCatalogKinds.map((kind) => [
          kind,
          seasonCoverage.filter((item) => item.catalogKind === kind).length
        ])),
        completeWithinDeclaredRecentPerKindSlices: true
      },
      transaction: {
        ...transactionAccumulator.receipt,
        stateBudgetBytes: MAXIS_SOURCE_CONFIG.maxTransactionStateBytes,
        availability: transactionUnavailable ? 'withheld-artifact-budget' : 'ready'
      },
      objktListingSales: {
        source: 'OBJKT listing_sale',
        from,
        toExclusive: to,
        observedAt,
        rows: listingSales.rows.length,
        pages: listingSales.pages,
        pageSize: MAXIS_SOURCE_CONFIG.objktPageSize,
        maximumRows: MAXIS_SOURCE_CONFIG.objktMaxPages * MAXIS_SOURCE_CONFIG.objktPageSize,
        complete: !listingSales.truncated,
        pagination: {
          mode: 'id-keyset-ascending',
          firstId: listingSales.firstCursor,
          lastId: listingSales.lastCursor,
          nextAfter: listingSales.nextAfter,
          strictlyIncreasingUniqueIds: listingSales.cursorOrderVerified === true
        }
      },
      objktMints: {
        source: 'OBJKT new-token event(event_type=mint, token.timestamp in season)',
        from,
        toExclusive: to,
        observedAt,
        rows: mints.rows.length,
        pages: mints.pages,
        pageSize: MAXIS_SOURCE_CONFIG.objktPageSize,
        maximumRows: MAXIS_SOURCE_CONFIG.objktMaxPages * MAXIS_SOURCE_CONFIG.objktPageSize,
        complete: !mints.truncated,
        pagination: {
          mode: 'id-keyset-ascending',
          firstId: mints.firstCursor,
          lastId: mints.lastCursor,
          nextAfter: mints.nextAfter,
          strictlyIncreasingUniqueIds: mints.cursorOrderVerified === true
        }
      },
      appTransactions: { source: 'TzKT recognized-contract transactions', from, toExclusive: to, rows: appTransactions.rows.length, contracts: seasonCoverage.length, maximumRowsPerContractBatch: MAXIS_SOURCE_CONFIG.tzktMaxPages * MAXIS_SOURCE_CONFIG.tzktPageSize, complete: !appTransactions.truncated },
      governance: {
        source: 'TzKT ballots + proposals + actionable voting-period sequence',
        ballots: ballots.rows.length,
        proposals: proposals.rows.length,
        votingPeriods: votingPeriods.rows.map((period) => ({ index: period.index, epoch: period.epoch, kind: period.kind, firstLevel: period.firstLevel, lastLevel: period.lastLevel })),
        complete: !governanceUnavailable
      },
      staking: { source: 'TzKT staking operations', rows: staking.rows.length, complete: !stakingUnavailable },
      delegation: {
        source: endLevelExclusive ? 'TzKT delegation operations + exact-close balance history' : 'TzKT delegation operations + current accounts',
        operations: delegations.rows.length,
        reconciledAccounts: currentAccounts.length,
        reconciliationMode: endLevelExclusive ? 'last-season-assignment plus balance at close level' : 'current delegate and balance snapshot',
        balanceLevel: endLevelExclusive ? endLevelExclusive - 1 : null,
        complete: !delegationUnavailable
      },
      builder: { source: 'TzKT originations + post-deploy transactions', originations: originations.rows.length, originatedContracts: originatedContracts.length, postDeployCalls: builderCalls.rows.length, complete: !builderUnavailable }
    },
    coverage: {
      taxonomyFrozenAt: rules.frozenAt,
      taxonomyHash: rules.taxonomyHash,
      contractCatalogLimitPerKind: frozenConfig.contractCatalogLimit,
      contractCatalogKinds: MAXIS_SOURCE_CONFIG.contractCatalogKinds,
      paginationBounds: {
        objktRowsPerEventType: MAXIS_SOURCE_CONFIG.objktMaxPages * MAXIS_SOURCE_CONFIG.objktPageSize,
        tzktRowsPerPagedQueryOrContractBatch: MAXIS_SOURCE_CONFIG.tzktMaxPages * MAXIS_SOURCE_CONFIG.tzktPageSize,
        policy: 'A source that reaches its bound withholds only dependent lanes; unrelated complete lanes remain publishable.'
      },
      recognizedApps: frozenConfig.apps.length,
      recognizedContracts: seasonCoverage.length,
      byCategory: Object.fromEntries(['defi', 'gaming'].map((category) => [category, {
        apps: frozenConfig.apps.filter((app) => app.category === category).length,
        contracts: seasonCoverage.filter((item) => item.app.category === category).length
      }])),
      liquidityEntrypoints: Object.fromEntries(frozenConfig.apps
        .filter((app) => app.liquidityEntrypoints?.length)
        .map((app) => [app.id, app.liquidityEntrypoints])),
      bridge: { state: 'unavailable', reason: availability.bridge.reason }
    },
    truncation: {
      ...cappedSources,
      builderCalls: builderCalls.truncated
    },
    transactionAccumulator: transactionAccumulator.document
  };
}

function assembleFullSeasonSnapshotV2({
  season,
  rules,
  generatedAt,
  observedAt = generatedAt,
  previousSnapshot,
  previousSeasonSnapshot,
  inheritedPassportSnapshot
}, data) {
  const competition = buildSeasonCompetition({
    rawRankings: data.rawRankings,
    availability: data.availability,
    season,
    rules,
    generatedAt,
    previousSnapshot,
    previousSeasonSnapshot,
    inheritedPassportSnapshot
  });
  const snapshot = {
    schema: SEASON_SCHEMA,
    generatedAt,
    observedAt,
    staleAfterHours: 48,
    season,
    deepRankingLimit: DEEP_RANKING_LIMIT,
    rules,
    sources: [
      { name: 'TzKT', url: 'https://api.tzkt.io/', role: 'protocol activation, operations, accounts, contracts, delegation retention' },
      { name: 'OBJKT API v3', url: 'https://data.objkt.com/docs/', role: 'season mint and listing-sale events with profile identity' }
    ],
    sourceReceipts: data.sourceReceipts,
    coverage: data.coverage,
    truncation: data.truncation,
    transactionAccumulator: data.transactionAccumulator,
    ...competition,
    offchainBadges: {
      socialProof: {
        status: 'client-only',
        affectsMerit: false,
        affectsUnicorn: false,
        label: 'Social Proof',
        note: 'The browser may record a personal share ritual badge, but no click or post changes on-chain ranks.'
      }
    }
  };
  Object.defineProperty(snapshot, '_maxisSourceData', {
    value: data,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return snapshot;
}

export async function buildFullSeasonSnapshotV2(options, io) {
  const data = await fetchSeasonDataV2({
    season: options.season,
    rules: options.rules,
    generatedAt: options.generatedAt,
    observedAt: options.observedAt,
    endLevelExclusive: options.endLevelExclusive
  }, io);
  return assembleFullSeasonSnapshotV2(options, data);
}

export function rebuildWithoutTransactionLaneV2(options, snapshot, reason) {
  const data = snapshot?._maxisSourceData;
  if (!data) throw new Error('Maxis v2 artifact fallback requires retained source data from the same build');
  const unavailableReason = reason || 'Transaction is withheld because publishing every eligible Transaction Passport would exceed the frozen artifact budget.';
  const fallbackData = {
    ...data,
    rawRankings: { ...data.rawRankings, transaction: [] },
    availability: {
      ...data.availability,
      transaction: {
        status: 'unavailable',
        reason: unavailableReason,
        coverageState: 'withheld-artifact-budget'
      }
    },
    sourceReceipts: {
      ...data.sourceReceipts,
      transaction: {
        ...data.sourceReceipts.transaction,
        availability: 'withheld-artifact-budget'
      }
    }
  };
  return assembleFullSeasonSnapshotV2(options, fallbackData);
}

// All version modules expose the same dispatcher-facing surface. The explicit
// v2 names remain exported for direct invariant fixtures.
export const fetchSeasonData = fetchSeasonDataV2;
export const buildFullSeasonSnapshot = buildFullSeasonSnapshotV2;
export const rebuildWithoutTransactionLane = rebuildWithoutTransactionLaneV2;
