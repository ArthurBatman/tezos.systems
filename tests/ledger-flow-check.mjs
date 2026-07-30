#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildLedgerFlowModel,
  layoutLedgerFlowNodes
} from '../js/features/ledger-flow-model.mjs';

const ACCOUNT = 'tz1LedgerFlowModelUnderTest';
const MUTEZ = 1_000_000;

function transfer({
  id,
  amount,
  sender = ACCOUNT,
  target = `tz1Counterparty${id}`,
  timestamp = `2026-07-${String((id % 20) + 1).padStart(2, '0')}T12:00:00Z`
}) {
  return {
    id,
    hash: `opLedgerFlowModel${id}`,
    level: 10_000_000 + id,
    timestamp,
    amount,
    sender: typeof sender === 'string' ? { address: sender, alias: '' } : sender,
    target: typeof target === 'string' ? { address: target, alias: '' } : target
  };
}

function model(transactions, options = {}) {
  return buildLedgerFlowModel({
    address: ACCOUNT,
    transactions
  }, options);
}

function testPerTransferThresholdHasNoOrphans() {
  const below = 'tz1BelowThreshold';
  const above = 'tz1AboveThreshold';
  const result = model([
    transfer({ id: 1, amount: 60 * MUTEZ, target: below }),
    transfer({ id: 2, amount: 60 * MUTEZ, sender: below, target: ACCOUNT }),
    transfer({ id: 3, amount: 120 * MUTEZ, target: above })
  ], { thresholdMutez: 100 * MUTEZ });

  assert.deepEqual(result.transfers.map((row) => row.transactionId), [3]);
  assert.deepEqual(result.counterparties.map((row) => row.address), [above]);
  assert.equal(result.totals.sent, 120 * MUTEZ);
  assert.equal(result.totals.received, 0);

  const edgeKeys = new Set(result.edges.map((edge) => edge.counterparty.key));
  const visibleTransferNodes = result.visibleCounterparties.filter((node) => !node.isContext);
  assert(visibleTransferNodes.every((node) => edgeKeys.has(node.key)), 'a visible transfer node has no edge');
  assert(result.edges.every((edge) => edge.amount >= 100 * MUTEZ), 'an edge bypassed the per-transfer threshold');
}

function testDirectionalCountsAndLatestTimestamps() {
  const counterparty = { address: 'tz1DirectionalCounterparty', alias: 'Directional QA' };
  const result = model([
    transfer({ id: 11, amount: 8 * MUTEZ, target: counterparty, timestamp: '2026-07-01T00:00:00Z' }),
    transfer({ id: 12, amount: 5 * MUTEZ, sender: counterparty, target: ACCOUNT, timestamp: '2026-07-02T00:00:00Z' }),
    transfer({ id: 13, amount: 3 * MUTEZ, target: counterparty, timestamp: '2026-07-03T00:00:00Z' })
  ]);

  const row = result.counterparties[0];
  assert.equal(row.sent, 11 * MUTEZ);
  assert.equal(row.received, 5 * MUTEZ);
  assert.equal(row.sentCount, 2);
  assert.equal(row.receivedCount, 1);
  assert.equal(row.count, 3);
  assert.equal(row.sentLatest, '2026-07-03T00:00:00Z');
  assert.equal(row.receivedLatest, '2026-07-02T00:00:00Z');
  assert.equal(result.latest, '2026-07-03T00:00:00Z');
}

function testDirectionalRollupsReconcileExactly() {
  const transactions = [];
  for (let index = 0; index < 14; index += 1) {
    const address = `tz1Rollup${String(index).padStart(2, '0')}`;
    transactions.push(transfer({
      id: 100 + index * 2,
      amount: (index + 1) * MUTEZ,
      target: { address, alias: `Rollup ${index}` }
    }));
    transactions.push(transfer({
      id: 101 + index * 2,
      amount: (index + 2) * MUTEZ,
      sender: { address, alias: `Rollup ${index}` },
      target: ACCOUNT
    }));
  }

  const result = model(transactions, {
    maxDiagramNodes: 6,
    individualNodeBudget: 4
  });
  const edgeTotals = result.edges.reduce((totals, edge) => {
    if (edge.direction === 'sent' || edge.direction === 'received') {
      totals[edge.direction].amount += edge.amount;
      totals[edge.direction].count += edge.count;
    }
    return totals;
  }, {
    sent: { amount: 0, count: 0 },
    received: { amount: 0, count: 0 }
  });

  assert(result.visibleCounterparties.some((row) => row.key === 'cohort:sent'));
  assert(result.visibleCounterparties.some((row) => row.key === 'cohort:received'));
  assert.equal(edgeTotals.sent.amount, result.totals.sent);
  assert.equal(edgeTotals.received.amount, result.totals.received);
  assert.equal(edgeTotals.sent.count, result.transfers.filter((row) => row.direction === 'sent').length);
  assert.equal(edgeTotals.received.count, result.transfers.filter((row) => row.direction === 'received').length);
}

function testZeroTotalRowsAreExcluded() {
  const valid = 'tz1OnlyValidCounterparty';
  const result = model([
    transfer({ id: 201, amount: 0, target: 'tz1Zero' }),
    transfer({ id: 202, amount: -10, target: 'tz1Negative' }),
    transfer({ id: 203, amount: 4 * MUTEZ, sender: ACCOUNT, target: ACCOUNT }),
    transfer({ id: 204, amount: 7 * MUTEZ, sender: 'tz1UnrelatedA', target: 'tz1UnrelatedB' }),
    transfer({ id: 205, amount: 9 * MUTEZ, target: valid })
  ]);

  assert.deepEqual(result.counterparties.map((row) => row.address), [valid]);
  assert(result.counterparties.every((row) => row.total > 0));
  assert(result.listCounterparties.every((row) => row.total > 0));
  assert.equal(result.transfers.length, 1);
  assert.equal(result.selfTransferRows, 1);
}

function assertColumnDoesNotOverlap(nodes, layout, nodeHeight, minimumGap) {
  const columns = new Map();
  for (const node of nodes) {
    const position = layout.positions.get(node.key);
    assert(position, `missing layout position for ${node.key}`);
    const column = node.side === 'right' ? 'right' : 'left';
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(position.y);
  }
  for (const ys of columns.values()) {
    ys.sort((left, right) => left - right);
    for (let index = 1; index < ys.length; index += 1) {
      assert(
        ys[index] - ys[index - 1] >= nodeHeight + minimumGap,
        `nodes overlap: ${ys[index - 1]} and ${ys[index]}`
      );
    }
  }
}

function testDynamicLayoutsDoNotOverlap() {
  const nodeHeight = 62;
  const minimumGap = 18;
  for (const count of [1, 2, 7, 8, 12, 20]) {
    const nodes = Array.from({ length: count }, (_, index) => ({
      key: `balanced:${count}:${index}`,
      side: index % 2 ? 'right' : 'left'
    }));
    const layout = layoutLedgerFlowNodes(nodes, { nodeHeight, minimumGap });
    assert.equal(layout.positions.size, nodes.length);
    assertColumnDoesNotOverlap(nodes, layout, nodeHeight, minimumGap);
    for (const { y } of layout.positions.values()) {
      assert(y - nodeHeight / 2 >= 0);
      assert(y + nodeHeight / 2 <= layout.viewHeight);
    }
    if (count === 20) assert(layout.viewHeight > 560, 'large layout did not grow vertically');
  }

  const skewed = [
    ...Array.from({ length: 19 }, (_, index) => ({ key: `left:${index}`, side: 'left' })),
    { key: 'right:only', side: 'right' }
  ];
  const layout = layoutLedgerFlowNodes(skewed, { nodeHeight, minimumGap });
  assertColumnDoesNotOverlap(skewed, layout, nodeHeight, minimumGap);
  assert.equal(layout.positions.get('right:only').y, layout.center.y);
}

testPerTransferThresholdHasNoOrphans();
testDirectionalCountsAndLatestTimestamps();
testDirectionalRollupsReconcileExactly();
testZeroTotalRowsAreExcluded();
testDynamicLayoutsDoNotOverlap();

console.log('ok - Ledger Flow model accounting, thresholds, rollups, and layout checked');
