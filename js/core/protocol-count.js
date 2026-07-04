const PARIS_C_PROTOCOL_NUMBER = 20;
const PARIS_C_NAMES = new Set(['paris c']);
const PARIS_C_HASH_PREFIXES = ['PsParisC', 'PsParisc'];

export const CANONICAL_UPGRADE_COUNT = 21;

function protocolName(protocol) {
    return String(protocol?.name || protocol?.alias || protocol?.extras?.alias || protocol?.metadata?.alias || '').trim();
}

function protocolHash(protocol) {
    return String(protocol?.hash || protocol?.protocol || '').trim();
}

function protocolCode(protocol) {
    const value = protocol?.code ?? protocol?.number;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isParisCFollowUp(protocol) {
    const name = protocolName(protocol).toLowerCase();
    const hash = protocolHash(protocol);
    return PARIS_C_NAMES.has(name) || PARIS_C_HASH_PREFIXES.some((prefix) => hash.startsWith(prefix));
}

function sameProtocol(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;

    const leftHash = protocolHash(left);
    const rightHash = protocolHash(right);
    if (leftHash && rightHash && (leftHash.startsWith(rightHash) || rightHash.startsWith(leftHash))) return true;

    const leftName = protocolName(left).toLowerCase();
    const rightName = protocolName(right).toLowerCase();
    if (leftName && rightName && leftName === rightName) return true;

    const leftCode = protocolCode(left);
    const rightCode = protocolCode(right);
    return leftCode !== null && rightCode !== null && leftCode === rightCode;
}

export function countsAsProtocolUpgrade(protocol) {
    if (!protocol) return false;
    if (protocol.countsAsUpgrade === false) return false;
    if (protocol.countsAsSelfAmendment === false) return false;
    if (isParisCFollowUp(protocol)) return false;

    const code = protocolCode(protocol);
    if (code !== null && code < 4) return false;

    if (Object.prototype.hasOwnProperty.call(protocol, 'firstLevel')) {
        const firstLevel = Number(protocol.firstLevel);
        if (Number.isFinite(firstLevel) && firstLevel <= 0) return false;
    }

    return true;
}

export function countProtocolUpgrades(protocols, fallback = CANONICAL_UPGRADE_COUNT) {
    if (!Array.isArray(protocols)) return fallback;
    const count = protocols.filter(countsAsProtocolUpgrade).length;
    return count || fallback;
}

export function getProtocolUpgradeOrdinal(protocol, protocols = []) {
    if (!countsAsProtocolUpgrade(protocol)) return null;

    if (Array.isArray(protocols) && protocols.length) {
        let count = 0;
        for (const candidate of protocols) {
            if (countsAsProtocolUpgrade(candidate)) count += 1;
            if (sameProtocol(candidate, protocol)) return countsAsProtocolUpgrade(candidate) ? count : null;
        }
    }

    const code = protocolCode(protocol);
    if (code === null || code < 4) return null;
    const parisCAdjustment = code > PARIS_C_PROTOCOL_NUMBER ? 1 : 0;
    return Math.max(1, code - 3 - parisCAdjustment);
}

export function formatProtocolUpgradeOrdinal(protocol, protocols = []) {
    const ordinal = getProtocolUpgradeOrdinal(protocol, protocols);
    return ordinal === null ? 'follow-up' : `#${ordinal}`;
}
