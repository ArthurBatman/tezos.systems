#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'whale-watch.json');
const API = 'https://api.tzkt.io/v1';
const CHECK_ONLY = process.argv.includes('--check');
const MIN_TRANSFER_MUTEZ = 1_000 * 1e6;
const MIN_DORMANT_BALANCE_MUTEZ = 1_000_000 * 1e6;
const DORMANT_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISPLAY_DORMANT_LIMIT = 100;
const DISPLAY_FLOW_LIMIT = 24;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 100;
const ACCOUNT_OPERATION_PAGE_SIZE = 100;
const MAX_ACCOUNT_OPERATION_PAGES = 100;
const THRESHOLDS_XTZ = [1_000, 10_000, 100_000, 1_000_000];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function accountKind(account) {
  const type = String(account?.type || '').toLowerCase();
  if (type === 'delegate') return 'baker';
  if (type === 'contract' || String(account?.address || '').startsWith('KT1')) return 'contract';
  if (type === 'rollup' || String(account?.address || '').startsWith('sr1')) return 'rollup';
  if (type === 'user') return 'implicit-account';
  return type || 'account';
}

function operationIdentity(operation) {
  const id = finite(operation?.id, 0);
  if (id > 0) return `op:${id}`;
  const hash = String(operation?.hash || operation?.operationGroupHash || '');
  const address = operation?.sender?.address || operation?.target?.address || '';
  return `hash:${hash}:${address}:${operation?.timestamp || ''}:${finite(operation?.amount, 0)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'tezos.systems whale-watch generator' }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchPages(endpoint, params, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const rows = [];
  let offset = 0;
  let pages = 0;
  while (pages < maxPages) {
    const query = new URLSearchParams({ ...params, limit: String(pageSize), offset: String(offset) });
    const page = await fetchJson(`${API}${endpoint}?${query}`);
    if (!Array.isArray(page)) throw new Error(`Unexpected TzKT page for ${endpoint}`);
    rows.push(...page);
    pages += 1;
    if (page.length < pageSize) return { rows, pages, complete: true };
    offset += pageSize;
  }
  throw new Error(`TzKT pagination exceeded ${maxPages} pages for ${endpoint}`);
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeAccount(account, generatedAt) {
  const activityTime = iso(account?.lastActivityTime);
  const dormantDays = activityTime
    ? Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(activityTime)) / DAY_MS))
    : null;
  return {
    address: String(account?.address || ''),
    alias: String(account?.alias || '').trim() || null,
    labelSource: account?.alias ? 'tzkt-alias' : null,
    accountType: accountKind(account),
    balanceMutez: finite(account?.balance, 0),
    lastActivityLevel: finite(account?.lastActivity, 0) || null,
    lastActivityTime: activityTime,
    dormantDays
  };
}

function dormantRecordSort(left, right) {
  const leftTime = Date.parse(left.lastActivityTime || '1970-01-01T00:00:00Z');
  const rightTime = Date.parse(right.lastActivityTime || '1970-01-01T00:00:00Z');
  return leftTime - rightTime || right.balanceMutez - left.balanceMutez || left.address.localeCompare(right.address);
}

function operationType(operation) {
  const type = String(operation?.type || operation?.kind || '').toLowerCase();
  if (type === 'staking') return String(operation?.action || 'staking').toLowerCase();
  return type;
}

function isAppliedOperation(operation) {
  return String(operation?.status || '').toLowerCase() === 'applied';
}

/**
 * A moved amount is deliberately narrower than an operation's largest numeric
 * field. TzKT delegation `amount` is the sender balance, staking
 * `requestedAmount` is intent, and consensus `deposit` is a security deposit.
 * Only an applied transfer or the actual processed staking `amount` belongs
 * in the moved-amount field.
 */
function operationAmountMutez(operation) {
  if (!isAppliedOperation(operation)) return null;
  const type = operationType(operation);
  if (!['transaction', 'stake', 'unstake'].includes(type)) return null;
  const candidate = operation?.amountMutez ?? operation?.amount;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const value = finite(candidate, NaN);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeOperation(operation) {
  return {
    id: finite(operation?.id, 0) || null,
    hash: String(operation?.hash || operation?.operationGroupHash || '') || null,
    type: String(operation?.type || operation?.kind || 'operation'),
    action: operation?.action ? String(operation.action) : null,
    status: String(operation?.status || ''),
    timestamp: iso(operation?.timestamp),
    amountMutez: operationAmountMutez(operation),
    sender: operation?.sender?.address || null,
    senderAlias: operation?.sender?.alias || null,
    target: operation?.target?.address || null,
    targetAlias: operation?.target?.alias || null
  };
}

function operationChronology(left, right) {
  const timeDelta = Date.parse(left?.timestamp || '') - Date.parse(right?.timestamp || '');
  if (timeDelta) return timeDelta;
  return finite(left?.id, Number.MAX_SAFE_INTEGER) - finite(right?.id, Number.MAX_SAFE_INTEGER);
}

/**
 * Resolve the first applied operation after the prior dormant activity. TzKT's
 * account-operation stream is fetched newest-first and exhausted until the
 * old activity boundary is crossed; returning a recent row merely because it
 * fits in a small page would misidentify the awakening trigger.
 */
async function earliestAppliedAccountOperation(address, afterTime, untilTime = '') {
    const after = Date.parse(afterTime || '');
    if (!Number.isFinite(after)) return null;
    const until = Date.parse(untilTime || '');
  let earliest = null;
  let offset = 0;
  for (let page = 0; page < MAX_ACCOUNT_OPERATION_PAGES; page += 1) {
    const query = new URLSearchParams({
      limit: String(ACCOUNT_OPERATION_PAGE_SIZE),
      offset: String(offset),
      'sort.desc': 'id'
    });
    if (Number.isFinite(until)) query.set('timestamp.le', new Date(until).toISOString());
    const rows = await fetchJson(`${API}/accounts/${encodeURIComponent(address)}/operations?${query}`);
    if (!Array.isArray(rows)) return null;
    let crossedBoundary = false;
    for (const operation of rows) {
      const time = Date.parse(operation?.timestamp || '');
      if (!Number.isFinite(time)) continue;
      if (time <= after) {
        crossedBoundary = true;
        continue;
      }
      if (!isAppliedOperation(operation)) continue;
      if (!earliest || operationChronology(operation, earliest) < 0) earliest = operation;
    }
    if (crossedBoundary || rows.length < ACCOUNT_OPERATION_PAGE_SIZE) return earliest;
    offset += ACCOUNT_OPERATION_PAGE_SIZE;
  }
  throw new Error(`TzKT account-operation pagination exceeded ${MAX_ACCOUNT_OPERATION_PAGES} pages for ${address}`);
}

async function buildAwakenings(previous, currentByAddress, generatedAt) {
  const priorRows = Array.isArray(previous?.dormant?.records) ? previous.dormant.records : [];
  const priorGeneratedAt = iso(previous?.generatedAt);
  if (!priorGeneratedAt || !priorRows.length) return [];
  const discovered = [];
  for (const prior of priorRows) {
    let current = currentByAddress.get(prior.address) || null;
    if (!current) {
      try {
        const account = await fetchJson(`${API}/accounts/${encodeURIComponent(prior.address)}`);
        current = normalizeAccount(account, generatedAt);
      } catch {
        continue;
      }
    }
    const priorActivity = Date.parse(prior.lastActivityTime || '');
    const currentActivity = Date.parse(current.lastActivityTime || '');
    if (!Number.isFinite(priorActivity) || !Number.isFinite(currentActivity) || currentActivity <= priorActivity || currentActivity <= Date.parse(priorGeneratedAt)) continue;
    let operation = null;
    try {
      operation = await earliestAppliedAccountOperation(prior.address, prior.lastActivityTime, generatedAt);
    } catch {
      operation = null;
    }
    if (!operation) continue;
    const receipt = normalizeOperation(operation);
    if (!receipt.hash || !receipt.timestamp) continue;
    const awakenedAt = Date.parse(receipt.timestamp);
    const dormantDays = Math.floor((awakenedAt - priorActivity) / DAY_MS);
    if (!Number.isFinite(dormantDays) || dormantDays < DORMANT_DAYS) continue;
    discovered.push({
      id: operationIdentity(operation),
      address: prior.address,
      alias: current.alias || prior.alias || null,
      accountType: current.accountType || prior.accountType || 'account',
      balanceBeforeMutez: finite(prior.balanceMutez, 0),
      balanceAfterMutez: finite(current.balanceMutez, 0),
      previousActivityTime: iso(prior.lastActivityTime),
      dormantDays,
      awakenedAt: receipt.timestamp,
      movedAmountMutez: receipt.amountMutez ?? null,
      receipt
    });
  }
  return discovered;
}

function flowGroupRows(transfers) {
  const groups = new Map();
  for (const operation of transfers) {
    const normalized = normalizeOperation(operation);
    const hash = normalized.hash || `operation-${normalized.id || operationIdentity(operation)}`;
    const group = groups.get(hash) || {
      hash,
      timestamp: normalized.timestamp,
      grossObservedMutez: 0,
      operations: []
    };
    group.grossObservedMutez += finite(normalized.amountMutez, 0);
    group.operations.push(normalized);
    if (Date.parse(normalized.timestamp || '') > Date.parse(group.timestamp || '')) group.timestamp = normalized.timestamp;
    groups.set(hash, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, operationCount: group.operations.length }))
    .sort((left, right) => right.grossObservedMutez - left.grossObservedMutez || Date.parse(right.timestamp || '') - Date.parse(left.timestamp || ''));
}

function transferSummary(transfers, since, generatedAt) {
  const groups = flowGroupRows(transfers);
  const thresholdRows = THRESHOLDS_XTZ.map((thresholdXtz) => {
    const minimum = thresholdXtz * 1e6;
    const rows = transfers.filter((operation) => finite(operation?.amount, 0) >= minimum);
    return {
      thresholdXtz,
      operationCount: rows.length,
      operationGroupCount: new Set(rows.map((operation) => operation?.hash).filter(Boolean)).size,
      grossObservedMutez: rows.reduce((sum, operation) => sum + finite(operation?.amount, 0), 0)
    };
  });
  const largest = [...transfers].sort((left, right) => finite(right?.amount, 0) - finite(left?.amount, 0))[0] || null;
  return {
    window: { since, until: generatedAt, hours: 24 },
    semantics: 'Gross observed tez transferred by applied transaction operations. This is not economic volume and can include related internal hops.',
    minimumXtz: MIN_TRANSFER_MUTEZ / 1e6,
    complete: true,
    operationCount: transfers.length,
    operationGroupCount: groups.length,
    uniqueSenders: new Set(transfers.map((operation) => operation?.sender?.address).filter(Boolean)).size,
    uniqueTargets: new Set(transfers.map((operation) => operation?.target?.address).filter(Boolean)).size,
    grossObservedMutez: transfers.reduce((sum, operation) => sum + finite(operation?.amount, 0), 0),
    thresholds: thresholdRows,
    largestOperation: largest ? normalizeOperation(largest) : null,
    topFlowStories: groups.slice(0, DISPLAY_FLOW_LIMIT)
  };
}

function validate(snapshot) {
  const errors = [];
  const amountContractCases = [
    [{ type: 'transaction', status: 'applied', amount: 11 }, 11, 'applied transaction amount'],
    [{ type: 'staking', action: 'stake', status: 'applied', amount: 7, requestedAmount: 700 }, 7, 'actual stake amount'],
    [{ type: 'staking', action: 'unstake', status: 'applied', amount: null, requestedAmount: 700 }, null, 'missing actual unstake amount'],
    [{ type: 'delegation', status: 'applied', amount: 900 }, null, 'delegation sender balance'],
    [{ type: 'activation', status: 'applied', balance: 900 }, null, 'activation allocation'],
    [{ type: 'attestation', status: 'applied', deposit: 900 }, null, 'consensus security deposit'],
    [{ type: 'transaction', status: 'failed', amount: 900 }, null, 'failed transaction intent']
  ];
  for (const [operation, expected, label] of amountContractCases) {
    if (operationAmountMutez(operation) !== expected) errors.push(`moved-amount contract failed for ${label}`);
  }
  if (snapshot?.kind !== 'tezos-whale-watch') errors.push('kind must be tezos-whale-watch');
  if (snapshot?.version !== 1) errors.push('version must be 1');
  if (!iso(snapshot?.generatedAt)) errors.push('generatedAt must be an ISO timestamp');
  if (snapshot?.coverage?.largeAccounts?.complete !== true) errors.push('large-account coverage must be complete');
  if (snapshot?.coverage?.transfers24h?.complete !== true) errors.push('24h transfer coverage must be complete');
  const windowSince = Date.parse(snapshot?.transfers24h?.window?.since || '');
  const windowUntil = Date.parse(snapshot?.transfers24h?.window?.until || '');
  const generatedAt = Date.parse(snapshot?.generatedAt || '');
  if (!Number.isFinite(windowSince) || !Number.isFinite(windowUntil)
      || windowUntil !== generatedAt || windowUntil - windowSince !== DAY_MS) {
    errors.push('24h transfer window must end at generatedAt and span exactly 24 hours');
  }
  if (!Array.isArray(snapshot?.dormant?.records)) errors.push('dormant.records must be an array');
  if (!Array.isArray(snapshot?.awakenings)) errors.push('awakenings must be an array');
  if (!Array.isArray(snapshot?.transfers24h?.topFlowStories)) errors.push('transfers24h.topFlowStories must be an array');
  for (const record of snapshot?.dormant?.records || []) {
    if (!record.address) errors.push('dormant record missing address');
    if (!record.lastActivityTime || !iso(record.lastActivityTime)) errors.push(`dormant record ${record.address || '?'} missing lastActivityTime`);
    if (!Number.isFinite(Number(record.lastActivityLevel))) errors.push(`dormant record ${record.address || '?'} missing lastActivityLevel`);
    if (Number(record.dormantDays) < DORMANT_DAYS) errors.push(`dormant record ${record.address || '?'} is below the dormant threshold`);
  }
  for (const event of snapshot?.awakenings || []) {
    if (!event.receipt?.hash || !iso(event.receipt?.timestamp)) errors.push(`awakening ${event.id || '?'} is missing an operation receipt`);
    if (event.awakenedAt !== event.receipt?.timestamp) errors.push(`awakening ${event.id || '?'} timestamp does not match its receipt`);
    if (Date.parse(event.awakenedAt || '') > generatedAt) errors.push(`awakening ${event.id || '?'} is newer than generatedAt`);
    if (!isAppliedOperation(event.receipt)) errors.push(`awakening ${event.id || '?'} receipt must be applied`);
    if (event.movedAmountMutez != null && !Number.isFinite(Number(event.movedAmountMutez))) errors.push(`awakening ${event.id || '?'} has invalid moved amount`);
    if ((event.movedAmountMutez ?? null) !== (event.receipt?.amountMutez ?? null)) errors.push(`awakening ${event.id || '?'} moved amount does not match its receipt`);
    const previousActivity = Date.parse(event.previousActivityTime || '');
    const awakenedAt = Date.parse(event.awakenedAt || '');
    const dormantDays = Math.floor((awakenedAt - previousActivity) / DAY_MS);
    if (!Number.isFinite(previousActivity) || previousActivity >= awakenedAt) errors.push(`awakening ${event.id || '?'} is missing a valid prior-activity receipt`);
    if (!Number.isFinite(Number(event.dormantDays)) || Number(event.dormantDays) < DORMANT_DAYS || Number(event.dormantDays) !== dormantDays) errors.push(`awakening ${event.id || '?'} has an invalid receipt-to-receipt dormancy interval`);
    const semanticAmount = operationAmountMutez(event.receipt);
    if ((event.receipt?.amountMutez ?? null) !== semanticAmount) errors.push(`awakening ${event.id || '?'} exposes a non-transfer/non-staking moved amount`);
  }
  if (JSON.stringify(snapshot).includes('economicVolume')) errors.push('artifact must not expose an economicVolume field');
  if (errors.length) throw new Error(`Whale Watch artifact invalid:\n- ${errors.join('\n- ')}`);
  return snapshot;
}

async function build() {
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.parse(generatedAt) - DAY_MS).toISOString();
  const [accountPage, transferPage, previous] = await Promise.all([
    fetchPages('/accounts', {
      'balance.ge': String(MIN_DORMANT_BALANCE_MUTEZ),
      'sort.desc': 'balance',
      select: 'address,alias,type,balance,lastActivity,lastActivityTime'
    }),
    fetchPages('/operations/transactions', {
      'timestamp.ge': since,
      'timestamp.le': generatedAt,
      'amount.ge': String(MIN_TRANSFER_MUTEZ),
      status: 'applied',
      'sort.asc': 'id'
    }),
    readPrevious()
  ]);

  const accounts = accountPage.rows.map((account) => normalizeAccount(account, generatedAt));
  const currentByAddress = new Map(accounts.map((account) => [account.address, account]));
  const cutoff = Date.parse(generatedAt) - DORMANT_DAYS * DAY_MS;
  const dormant = accounts
    .filter((account) => account.lastActivityTime && Date.parse(account.lastActivityTime) <= cutoff)
    .sort(dormantRecordSort);
  const discoveredAwakenings = await buildAwakenings(previous, currentByAddress, generatedAt);
  const previousAwakenings = Array.isArray(previous?.awakenings)
    ? previous.awakenings.filter((event) => event?.receipt?.hash && iso(event.receipt.timestamp))
    : [];
  const awakeningById = new Map();
  [...discoveredAwakenings, ...previousAwakenings].forEach((event) => {
    if (event?.id && !awakeningById.has(event.id)) awakeningById.set(event.id, event);
  });
  const awakenings = [...awakeningById.values()]
    .filter((event) => {
      const awakenedAt = Date.parse(event.awakenedAt || '');
      return awakenedAt >= Date.parse(generatedAt) - 90 * DAY_MS && awakenedAt <= Date.parse(generatedAt);
    })
    .sort((left, right) => Date.parse(right.awakenedAt || '') - Date.parse(left.awakenedAt || ''))
    .slice(0, 100);

  return validate({
    kind: 'tezos-whale-watch',
    version: 1,
    generatedAt,
    methodology: {
      minimumTransferXtz: MIN_TRANSFER_MUTEZ / 1e6,
      minimumDormantBalanceXtz: MIN_DORMANT_BALANCE_MUTEZ / 1e6,
      minimumDormantDays: DORMANT_DAYS,
      identity: 'TzKT operation id identifies one operation; operation-group hash groups related hops into a flow story.',
      dormancy: 'Dormancy uses TzKT lastActivityTime. lastActivity is retained only as a block-level receipt.',
      awakening: 'An awakening is the earliest applied TzKT account operation after the prior dormant activity. Moved amount is populated only for applied transactions and actual processed stake or unstake amounts.',
      accountLanguage: 'Rows are large accounts, not presumed individual wallets. TzKT account type and alias are presented as source context.'
    },
    coverage: {
      largeAccounts: { complete: accountPage.complete, pages: accountPage.pages, eligibleCount: accounts.length },
      transfers24h: { complete: transferPage.complete, pages: transferPage.pages, eligibleCount: transferPage.rows.length }
    },
    dormant: {
      eligibleCount: dormant.length,
      eligibleBalanceMutez: dormant.reduce((sum, account) => sum + account.balanceMutez, 0),
      displayLimit: DISPLAY_DORMANT_LIMIT,
      records: dormant.slice(0, DISPLAY_DORMANT_LIMIT)
    },
    awakenings,
    transfers24h: transferSummary(transferPage.rows, since, generatedAt),
    sources: [
      { label: 'TzKT large-account ledger', url: `${API}/accounts`, observedAt: generatedAt },
      { label: 'TzKT applied transaction ledger', url: `${API}/operations/transactions`, observedAt: generatedAt }
    ]
  });
}

if (CHECK_ONLY) {
  const snapshot = validate(JSON.parse(await fs.readFile(OUTPUT, 'utf8')));
  console.log(`Whale Watch artifact valid: ${snapshot.dormant.eligibleCount} dormant accounts, ${snapshot.transfers24h.operationCount} transfers, ${snapshot.awakenings.length} awakenings`);
} else {
  const snapshot = await build();
  await fs.writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${snapshot.dormant.eligibleCount} dormant accounts and ${snapshot.transfers24h.operationCount} 24h transfers`);
}
