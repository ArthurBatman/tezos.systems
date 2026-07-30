/**
 * Pure Ledger Flow data model.
 *
 * Network requests and DOM rendering stay in ledger-flow.js so the accounting,
 * roll-up, and layout rules can be verified without a browser.
 */

const DEFAULT_MAX_LIST_ROWS = 12;
const DEFAULT_MAX_DIAGRAM_NODES = 12;
const DEFAULT_INDIVIDUAL_NODE_BUDGET = 10;

function transactionKey(tx) {
    return tx?.id
        || tx?.hash
        || `${tx?.level || ''}:${tx?.sender?.address || ''}:${tx?.target?.address || ''}:${tx?.amount || 0}`;
}

export function normalizeLedgerTransaction(tx, address) {
    const sender = tx?.sender || {};
    const target = tx?.target || {};
    const senderAddress = sender.address || '';
    const targetAddress = target.address || '';
    const amount = Number(tx?.amount || 0);
    if (!senderAddress || !targetAddress || !Number.isFinite(amount) || amount <= 0) return null;
    if (senderAddress === targetAddress) return null;

    let direction = '';
    if (senderAddress === address) direction = 'sent';
    else if (targetAddress === address) direction = 'received';
    if (!direction) return null;

    const counterparty = direction === 'sent' ? target : sender;
    return {
        id: transactionKey(tx),
        transactionId: tx?.id || null,
        hash: tx?.hash || '',
        level: Number(tx?.level || 0),
        timestamp: tx?.timestamp || '',
        amount,
        direction,
        sender,
        target,
        counterparty: {
            address: counterparty.address || '',
            alias: counterparty.alias || ''
        }
    };
}

function latestTimestamp(current, candidate) {
    if (!candidate) return current || '';
    if (!current) return candidate;
    return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function addCounterparty(map, tx) {
    const address = tx.counterparty.address;
    if (!address) return;
    if (!map.has(address)) {
        map.set(address, {
            key: address,
            address,
            alias: tx.counterparty.alias || '',
            sent: 0,
            received: 0,
            sentCount: 0,
            receivedCount: 0,
            sentLatest: '',
            receivedLatest: '',
            total: 0,
            count: 0,
            side: 'left',
            isCohort: false,
            isContext: false,
            isFirstValue: false
        });
    }

    const item = map.get(address);
    if (tx.counterparty.alias && !item.alias) item.alias = tx.counterparty.alias;
    item[tx.direction] += tx.amount;
    item[`${tx.direction}Count`] += 1;
    item[`${tx.direction}Latest`] = latestTimestamp(item[`${tx.direction}Latest`], tx.timestamp);
    item.total = item.sent + item.received;
    item.count = item.sentCount + item.receivedCount;
}

function totalsFor(transfers) {
    return transfers.reduce((totals, tx) => {
        totals[tx.direction] += tx.amount;
        totals.count += 1;
        return totals;
    }, { sent: 0, received: 0, count: 0 });
}

function directionCohort(direction, members) {
    if (!members.length) return null;
    const amount = members.reduce((sum, item) => sum + item[direction], 0);
    const count = members.reduce((sum, item) => sum + item[`${direction}Count`], 0);
    const latest = members.reduce(
        (value, item) => latestTimestamp(value, item[`${direction}Latest`]),
        ''
    );
    if (!(amount > 0)) return null;
    const inbound = direction === 'received';
    return {
        key: `cohort:${direction}`,
        address: '',
        alias: inbound ? 'Other senders' : 'Other recipients',
        label: inbound ? 'Other senders' : 'Other recipients',
        sent: direction === 'sent' ? amount : 0,
        received: direction === 'received' ? amount : 0,
        sentCount: direction === 'sent' ? count : 0,
        receivedCount: direction === 'received' ? count : 0,
        sentLatest: direction === 'sent' ? latest : '',
        receivedLatest: direction === 'received' ? latest : '',
        total: amount,
        count,
        side: inbound ? 'left' : 'right',
        isCohort: true,
        isContext: false,
        isFirstValue: false,
        memberCount: members.length,
        members
    };
}

function contextNode(event) {
    const counterparty = event?.counterparty;
    if (!counterparty?.address) return null;
    return {
        key: `context:${counterparty.address}`,
        address: counterparty.address,
        alias: counterparty.alias || '',
        sent: 0,
        received: 0,
        sentCount: 0,
        receivedCount: 0,
        sentLatest: '',
        receivedLatest: '',
        total: 0,
        count: 0,
        side: 'left',
        isCohort: false,
        isContext: true,
        isFirstValue: true
    };
}

function edgeFor(item, direction, firstValueTransactionId, firstValueAddress = '') {
    const amount = Number(item?.[direction] || 0);
    if (!(amount > 0)) return null;
    return {
        id: `${item.key}:${direction}`,
        direction,
        counterparty: item,
        amount,
        count: Number(item?.[`${direction}Count`] || 0),
        latest: item?.[`${direction}Latest`] || '',
        isFirstValue: Boolean(
            firstValueTransactionId
            && !item.isCohort
            && item.address === firstValueAddress
            && direction === 'received'
        )
    };
}

function firstValueMatchesShownTransfer(event, transfers) {
    const transactionId = event?.transactionId;
    if (transactionId == null) return false;
    return transfers.some((tx) => String(tx.transactionId) === String(transactionId));
}

function selectedIndividuals(ranked, firstValueEvent, firstValueIsShown, options) {
    if (ranked.length <= options.maxDiagramNodes) return [...ranked];

    const selected = ranked.slice(0, options.individualNodeBudget);
    if (!firstValueIsShown) return selected;
    const address = firstValueEvent?.counterparty?.address || '';
    if (!address || selected.some((item) => item.address === address)) return selected;
    const pinned = ranked.find((item) => item.address === address);
    if (!pinned) return selected;
    selected[selected.length - 1] = pinned;
    return selected;
}

export function buildLedgerFlowModel(data, options = {}) {
    const threshold = Math.max(0, Number(options.thresholdMutez || 0));
    const settings = {
        maxListRows: Math.max(1, Number(options.maxListRows || DEFAULT_MAX_LIST_ROWS)),
        maxDiagramNodes: Math.max(2, Number(options.maxDiagramNodes || DEFAULT_MAX_DIAGRAM_NODES)),
        individualNodeBudget: Math.max(
            1,
            Number(options.individualNodeBudget || DEFAULT_INDIVIDUAL_NODE_BUDGET)
        )
    };
    const address = data?.address || '';
    const seenRows = new Set();
    const allTransfers = [];
    let selfTransferRows = 0;

    for (const raw of data?.transactions || []) {
        const rowKey = transactionKey(raw);
        if (seenRows.has(rowKey)) continue;
        seenRows.add(rowKey);
        const senderAddress = raw?.sender?.address || '';
        const targetAddress = raw?.target?.address || '';
        if (senderAddress === address
            && targetAddress === address
            && Number(raw?.amount || 0) > 0) {
            selfTransferRows += 1;
        }
        const tx = normalizeLedgerTransaction(raw, address);
        if (!tx) continue;
        allTransfers.push(tx);
    }

    const shownTransfers = allTransfers.filter((tx) => tx.amount >= threshold);
    const counterparties = new Map();
    shownTransfers.forEach((tx) => addCounterparty(counterparties, tx));

    const ranked = [...counterparties.values()]
        .map((item) => ({
            ...item,
            side: item.received >= item.sent ? 'left' : 'right'
        }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total || a.address.localeCompare(b.address));

    const firstValueEvent = data?.firstValueEvent || null;
    const firstValueIsShown = firstValueMatchesShownTransfer(firstValueEvent, shownTransfers);
    const individuals = selectedIndividuals(ranked, firstValueEvent, firstValueIsShown, settings);
    const individualAddresses = new Set(individuals.map((item) => item.address));
    const rolledUp = ranked.filter((item) => !individualAddresses.has(item.address));
    const receivedCohort = directionCohort(
        'received',
        rolledUp.filter((item) => item.received > 0)
    );
    const sentCohort = directionCohort(
        'sent',
        rolledUp.filter((item) => item.sent > 0)
    );
    const diagramNodes = [...individuals, receivedCohort, sentCohort].filter(Boolean);

    if (firstValueIsShown) {
        const firstAddress = firstValueEvent?.counterparty?.address || '';
        const node = diagramNodes.find((item) => !item.isCohort && item.address === firstAddress);
        if (node) node.isFirstValue = true;
    } else {
        const originNode = contextNode(firstValueEvent);
        if (originNode) diagramNodes.push(originNode);
    }

    const edges = [];
    const firstValueAddress = firstValueEvent?.counterparty?.address || '';
    for (const item of diagramNodes) {
        if (item.isContext) continue;
        const received = edgeFor(
            item,
            'received',
            firstValueIsShown ? firstValueEvent?.transactionId : null,
            firstValueAddress
        );
        const sent = edgeFor(item, 'sent', null);
        if (received) {
            edges.push(received);
        }
        if (sent) edges.push(sent);
    }
    if (!firstValueIsShown) {
        const node = diagramNodes.find((item) => item.isContext);
        if (node) {
            edges.push({
                id: `${node.key}:first`,
                direction: 'first',
                counterparty: node,
                amount: Number(firstValueEvent?.amountMutez || 0),
                count: 1,
                latest: firstValueEvent?.timestamp || '',
                isFirstValue: true,
                event: firstValueEvent
            });
        }
    }

    const listCounterparties = ranked.slice(0, settings.maxListRows);
    const listEdges = listCounterparties.map((item) => {
        const direction = item.received >= item.sent ? 'received' : 'sent';
        return edges.find((edge) => edge.counterparty.address === item.address && edge.direction === direction)
            || edgeFor(
                item,
                direction,
                firstValueIsShown ? firstValueEvent?.transactionId : null,
                firstValueAddress
            );
    }).filter(Boolean);

    const latest = allTransfers.reduce(
        (value, tx) => latestTimestamp(value, tx.timestamp),
        ''
    );

    return {
        address,
        label: data?.label || address,
        account: data?.account || null,
        resolution: data?.resolution || null,
        coverage: data?.coverage || null,
        updatedAt: data?.updatedAt || '',
        accountOrigin: data?.accountOrigin || null,
        firstInbound: data?.firstInboundEvent || null,
        firstValueEvent,
        allTransfers,
        transfers: shownTransfers,
        totals: totalsFor(shownTransfers),
        fullLoadedTotals: totalsFor(allTransfers),
        counterparties: ranked,
        listCounterparties,
        listEdges,
        visibleCounterparties: diagramNodes,
        edges,
        rolledUpCount: rolledUp.length,
        hiddenListCount: Math.max(0, ranked.length - settings.maxListRows),
        selfTransferRows,
        threshold,
        latest
    };
}

export function layoutLedgerFlowNodes(nodes, options = {}) {
    const nodeHeight = Math.max(1, Number(options.nodeHeight || 62));
    const minimumGap = Math.max(1, Number(options.minimumGap || 18));
    const topPadding = Math.max(0, Number(options.topPadding || 72));
    const bottomPadding = Math.max(0, Number(options.bottomPadding || 72));
    const minimumHeight = Math.max(1, Number(options.minimumHeight || 560));
    const left = nodes.filter((item) => item.side !== 'right');
    const right = nodes.filter((item) => item.side === 'right');
    const largestColumn = Math.max(left.length, right.length, 1);
    const requiredHeight = topPadding
        + bottomPadding
        + largestColumn * nodeHeight
        + Math.max(0, largestColumn - 1) * minimumGap;
    const viewHeight = Math.max(minimumHeight, requiredHeight);
    const positions = new Map();

    const place = (items, x) => {
        if (!items.length) return;
        const pitch = nodeHeight + minimumGap;
        const contentHeight = items.length * nodeHeight + Math.max(0, items.length - 1) * minimumGap;
        const firstCenter = (viewHeight - contentHeight) / 2 + nodeHeight / 2;
        items.forEach((item, index) => {
            positions.set(item.key, { x, y: firstCenter + index * pitch });
        });
    };

    place(left, 180);
    place(right, 820);
    return {
        positions,
        viewHeight,
        center: { x: 500, y: viewHeight / 2 },
        minimumGap
    };
}
