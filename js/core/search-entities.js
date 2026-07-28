const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const TEZOS_ADDRESS_RE = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;
const OPERATION_HASH_RE = /^o[1-9A-HJ-NP-Za-km-z]{50}$/;
const BLOCK_HASH_RE = /^B[1-9A-HJ-NP-Za-km-z]{50}$/;
const BLOCK_LEVEL_RE = /^\d{4,}$/;
const TEZ_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+tez$/i;
const ETHERLINK_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ETHERLINK_TX_RE = /^0x[a-fA-F0-9]{64}$/;
const TEZOS_PREFIX_RE = /^(tz[1-4]|kt1)/i;
const ALLOWED_EXPLORER_HOSTS = new Set([
    'tzkt.io',
    'better-call.dev',
    'objkt.com',
    'tzstats.com',
    'explorer.etherlink.com'
]);

function normalizeTezosPrefix(value) {
    return String(value || '').replace(TEZOS_PREFIX_RE, (prefix) => (
        prefix.toLowerCase() === 'kt1' ? 'KT1' : prefix.toLowerCase()
    ));
}

function explorerCandidate(value) {
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
        if (!ALLOWED_EXPLORER_HOSTS.has(hostname)) return '';
        return decodeURIComponent(`${url.pathname}/${url.hash}`)
            .split(/[/#?=&]+/)
            .find((part) => (
                TEZOS_ADDRESS_RE.test(normalizeTezosPrefix(part))
                || OPERATION_HASH_RE.test(part)
                || BLOCK_HASH_RE.test(part)
                || BLOCK_LEVEL_RE.test(part)
                || ETHERLINK_ADDRESS_RE.test(part)
                || ETHERLINK_TX_RE.test(part)
            )) || '';
    } catch {
        return '';
    }
}

export function parseSearchEntity(rawValue) {
    const original = String(rawValue || '').trim();
    const extracted = /^https?:\/\//i.test(original) ? explorerCandidate(original) : original;
    const value = normalizeTezosPrefix(extracted);
    if (!value) return null;
    if (TEZOS_ADDRESS_RE.test(value)) {
        return {
            original,
            value,
            kind: value.startsWith('KT1') ? 'contract' : 'account',
            requiresChecksum: true
        };
    }
    if (OPERATION_HASH_RE.test(value)) return { original, value, kind: 'operation', requiresChecksum: true };
    if (BLOCK_HASH_RE.test(value)) return { original, value, kind: 'block', requiresChecksum: true };
    if (BLOCK_LEVEL_RE.test(value)) return { original, value, kind: 'block', requiresChecksum: false };
    if (TEZ_DOMAIN_RE.test(value)) return { original, value: value.toLowerCase(), kind: 'domain', requiresChecksum: false };
    if (ETHERLINK_ADDRESS_RE.test(value)) return { original, value, kind: 'etherlink-address', requiresChecksum: false };
    if (ETHERLINK_TX_RE.test(value)) return { original, value, kind: 'etherlink-transaction', requiresChecksum: false };
    if (/^(?:tz[1-4]|kt1)/i.test(extracted) && extracted.length < 36) {
        return { original, value, kind: 'partial-address', requiresChecksum: false };
    }
    if (/^(?:tz[1-4]|kt1)/i.test(extracted)) {
        return { original, value, kind: 'invalid-address', requiresChecksum: false };
    }
    return null;
}

function decodeBase58(value) {
    let decoded = 0n;
    for (const character of value) {
        const index = BASE58_INDEX.get(character);
        if (index === undefined) return null;
        decoded = decoded * 58n + BigInt(index);
    }
    const bytes = [];
    while (decoded > 0n) {
        bytes.unshift(Number(decoded & 255n));
        decoded >>= 8n;
    }
    for (const character of value) {
        if (character !== '1') break;
        bytes.unshift(0);
    }
    return new Uint8Array(bytes);
}

async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function validateBase58Check(value) {
    const decoded = decodeBase58(String(value || ''));
    if (!decoded || decoded.length < 5) return false;
    const payload = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    const first = await sha256(payload);
    const second = await sha256(first);
    return checksum.every((byte, index) => byte === second[index]);
}

export function explorerUrlForEntity(entity) {
    if (!entity) return '';
    if (entity.kind === 'etherlink-address') return `https://explorer.etherlink.com/address/${entity.value}`;
    if (entity.kind === 'etherlink-transaction') return `https://explorer.etherlink.com/tx/${entity.value}`;
    return '';
}
