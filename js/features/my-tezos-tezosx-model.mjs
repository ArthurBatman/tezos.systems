import {
    ETHERLINK_CHAIN_ID,
    MAX_LINKED_ETHERLINK_ACCOUNTS,
    isEtherlinkAddress,
    normalizeEtherlinkAddress,
    normalizeLinkedL2Accounts
} from '../core/my-tezos-models.mjs';

export {
    ETHERLINK_CHAIN_ID,
    MAX_LINKED_ETHERLINK_ACCOUNTS,
    isEtherlinkAddress,
    normalizeEtherlinkAddress,
    normalizeLinkedL2Accounts
};

export function upsertLinkedEtherlinkAccount(current, raw, { activeL1Address = '', now = Date.now() } = {}) {
    const address = normalizeEtherlinkAddress(raw?.address);
    if (!address) throw new Error('Enter a valid Etherlink 0x address.');
    const normalized = normalizeLinkedL2Accounts(current, { now });
    const index = normalized.findIndex((entry) => entry.address === address);
    const linkedL1Addresses = Array.from(new Set([
        ...(Array.isArray(raw?.linkedL1Addresses) ? raw.linkedL1Addresses : []),
        ...(activeL1Address ? [activeL1Address] : [])
    ]));
    const next = {
        chainId: ETHERLINK_CHAIN_ID,
        address,
        label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : null,
        linkedL1Addresses,
        included: raw?.included !== false,
        addedAt: index >= 0 ? normalized[index].addedAt : now
    };
    if (index >= 0) {
        const existing = normalized[index];
        normalized[index] = {
            ...existing,
            ...next,
            label: next.label || existing.label,
            linkedL1Addresses: Array.from(new Set([...existing.linkedL1Addresses, ...linkedL1Addresses]))
        };
        return { entries: normalizeLinkedL2Accounts(normalized, { now }), existed: true };
    }
    if (normalized.length >= MAX_LINKED_ETHERLINK_ACCOUNTS) {
        throw new Error(`My Tezos can keep up to ${MAX_LINKED_ETHERLINK_ACCOUNTS} linked Etherlink accounts.`);
    }
    return { entries: normalizeLinkedL2Accounts([next, ...normalized], { now }), existed: false };
}

export function weiToXtz(value) {
    let raw;
    try { raw = BigInt(value || 0); } catch { raw = 0n; }
    const whole = raw / 1_000_000_000_000_000_000n;
    const fraction = raw % 1_000_000_000_000_000_000n;
    return Number(whole) + Number(fraction) / 1e18;
}

export function hexWeiToXtz(value) {
    try { return weiToXtz(BigInt(String(value || '0x0'))); } catch { return 0; }
}

export function aggregateEtherlinkAccounts(rows) {
    const unique = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const address = normalizeEtherlinkAddress(row?.address);
        if (!address || unique.has(address)) continue;
        unique.set(address, row);
    }
    const values = [...unique.values()];
    return {
        accounts: values.length,
        nativeXtz: values.reduce((sum, row) => sum + Number(row.nativeXtz || 0), 0),
        erc20Assets: values.reduce((sum, row) => sum + Number(row.erc20Assets || 0), 0),
        nftAssets: values.reduce((sum, row) => sum + Number(row.nftAssets || 0), 0),
        transactions: values.reduce((sum, row) => sum + Number(row.transactions || 0), 0),
        lastActivity: values.reduce((latest, row) => {
            const timestamp = Date.parse(row.lastActivity || '') || 0;
            return timestamp > latest ? timestamp : latest;
        }, 0)
    };
}

export function friendlyEtherlinkMethod(method, contractName = '') {
    const value = String(method || '').trim();
    const labels = {
        transfer: 'Token transfer',
        transferfrom: 'Token transfer',
        approve: 'Token approval',
        multicall: 'Batch call'
    };
    const normalized = value.toLowerCase();
    return labels[normalized]
        || (contractName ? `Contract call · ${contractName}` : value ? `Contract call · ${value}` : 'Contract call');
}

export function isClassifiedEtherlinkMethod(method) {
    return ['transfer', 'transferfrom', 'approve', 'multicall'].includes(String(method || '').toLowerCase());
}
