/**
 * Pure saved-entry schema for the watch-only My Tezos wallet layer.
 * Kept free of browser globals so migrations and import rules are testable.
 */

export const MY_TEZOS_PORTFOLIO_NETWORK = 'tezos-l1';
export const MAX_SAVED_MY_TEZOS_ADDRESSES = 10;

export function isSavedMyTezosAddress(address) {
    return /^(tz[1-4]|KT1)[a-zA-Z0-9]{33}$/.test(String(address || '').trim());
}

export function cleanSavedMyTezosLabel(label) {
    const value = typeof label === 'string' ? label.trim() : '';
    return value ? value.slice(0, 80) : null;
}

export function normalizeSavedMyTezosEntries(entries, { now = Date.now() } = {}) {
    if (!Array.isArray(entries)) return [];
    const normalized = [];
    const seen = new Set();
    for (const item of entries) {
        const address = String(item?.address || '').trim();
        const network = item?.network || MY_TEZOS_PORTFOLIO_NETWORK;
        if (network !== MY_TEZOS_PORTFOLIO_NETWORK || !isSavedMyTezosAddress(address)) continue;
        const key = `${network}:${address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({
            network,
            address,
            label: cleanSavedMyTezosLabel(item?.label),
            included: item?.included !== false,
            addedAt: Number.isFinite(Number(item?.addedAt)) && Number(item.addedAt) > 0
                ? Number(item.addedAt)
                : now
        });
        if (normalized.length >= MAX_SAVED_MY_TEZOS_ADDRESSES) break;
    }
    return normalized;
}
