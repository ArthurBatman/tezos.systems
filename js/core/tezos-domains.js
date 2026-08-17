const TEZOS_DOMAINS_ENDPOINT = 'https://api.tezos.domains/graphql';
const TEZOS_DOMAINS_TIMEOUT_MS = 10_000;
const TEZOS_DOMAINS_REVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TEZ_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+tez$/i;
const TEZOS_ADDRESS_RE = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;
const reverseNameCache = new Map();

export function isTezosAddress(value) {
    return TEZOS_ADDRESS_RE.test(String(value || '').trim());
}

export function isTezDomainName(value) {
    const name = String(value || '').trim();
    return name.length <= 253 && TEZ_DOMAIN_RE.test(name);
}

export function normalizeTezDomainName(value) {
    const name = String(value || '').trim().toLowerCase();
    return isTezDomainName(name) ? name : '';
}

function callerAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

async function fetchTezosDomainsGraphql(query, variables, { signal } = {}) {
    if (signal?.aborted) throw callerAbortError(signal);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEZOS_DOMAINS_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
        const response = await fetch(TEZOS_DOMAINS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Tezos Domains returned HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (Array.isArray(payload?.errors) && payload.errors.length) {
            throw new Error('Tezos Domains could not complete the lookup');
        }
        return payload?.data || {};
    } catch (error) {
        if (signal?.aborted) throw callerAbortError(signal);
        if (controller.signal.aborted) throw new Error('Tezos Domains lookup timed out');
        throw error;
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}

/**
 * Resolve a Tezos Domains record without losing whether the selected account
 * came from the forward address or the domain owner fallback.
 *
 * @param {string} value
 * @param {{ signal?: AbortSignal }} options
 * @returns {Promise<{
 *   name: string,
 *   address: string|null,
 *   owner: string|null,
 *   resolvedAddress: string|null,
 *   source: 'address'|'owner'|null
 * }|null>}
 */
export async function resolveTezDomainRecord(value, { signal } = {}) {
    const name = normalizeTezDomainName(value);
    if (!name) return null;
    const data = await fetchTezosDomainsGraphql(
        'query ResolveDomain($name: String!) { domain(name: $name) { address owner } }',
        { name },
        { signal }
    );
    const domain = data?.domain;
    if (!domain) return null;
    const address = isTezosAddress(domain.address) ? domain.address : null;
    const owner = isTezosAddress(domain.owner) ? domain.owner : null;
    const resolvedAddress = [domain.address, domain.owner].find(isTezosAddress) || null;
    return {
        name,
        address,
        owner,
        resolvedAddress,
        source: address ? 'address' : owner ? 'owner' : null
    };
}

export async function resolveTezDomainAddress(value, options = {}) {
    const record = await resolveTezDomainRecord(value, options);
    return record?.resolvedAddress || null;
}

/**
 * Resolve reverse .tez names for several addresses in one GraphQL request.
 * Null results are cached too so compact live lists do not repeatedly ask for
 * names that do not exist.
 */
export async function resolveTezReverseNames(values, { signal } = {}) {
    const addresses = [...new Set((Array.isArray(values) ? values : [values])
        .map((value) => String(value || '').trim())
        .filter(isTezosAddress))];
    const names = new Map();
    const missing = [];
    const now = Date.now();

    addresses.forEach((address) => {
        const cached = reverseNameCache.get(address);
        if (cached && now - cached.timestamp < TEZOS_DOMAINS_REVERSE_CACHE_TTL_MS) {
            names.set(address, cached.name);
        } else {
            missing.push(address);
        }
    });
    if (!missing.length) return names;

    const declarations = [];
    const fields = [];
    const variables = {};
    missing.forEach((address, index) => {
        declarations.push(`$address${index}: String!`);
        fields.push(`record${index}: reverseRecord(address: $address${index}) { domain { name } }`);
        variables[`address${index}`] = address;
    });
    const data = await fetchTezosDomainsGraphql(
        `query ReverseLookupBatch(${declarations.join(', ')}) { ${fields.join(' ')} }`,
        variables,
        { signal }
    );

    missing.forEach((address, index) => {
        const candidate = String(data?.[`record${index}`]?.domain?.name || '').trim().toLowerCase();
        const name = isTezDomainName(candidate) ? candidate : null;
        reverseNameCache.set(address, { name, timestamp: now });
        names.set(address, name);
    });
    return names;
}

export async function resolveTezReverseName(value, options = {}) {
    const address = String(value || '').trim();
    if (!isTezosAddress(address)) return null;
    const names = await resolveTezReverseNames([address], options);
    return names.get(address) || null;
}
