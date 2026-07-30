const TEZOS_DOMAINS_ENDPOINT = 'https://api.tezos.domains/graphql';
const TEZOS_DOMAINS_TIMEOUT_MS = 10_000;
const TEZ_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+tez$/i;
const TEZOS_ADDRESS_RE = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

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
    if (signal?.aborted) throw callerAbortError(signal);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEZOS_DOMAINS_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
        const response = await fetch(TEZOS_DOMAINS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'query ResolveDomain($name: String!) { domain(name: $name) { address owner } }',
                variables: { name }
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Tezos Domains returned HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (Array.isArray(payload?.errors) && payload.errors.length) {
            throw new Error('Tezos Domains could not complete the lookup');
        }

        const domain = payload?.data?.domain;
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
    } catch (error) {
        if (signal?.aborted) throw callerAbortError(signal);
        if (controller.signal.aborted) throw new Error('Tezos Domains lookup timed out');
        throw error;
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}

export async function resolveTezDomainAddress(value, options = {}) {
    const record = await resolveTezDomainRecord(value, options);
    return record?.resolvedAddress || null;
}
