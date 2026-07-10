const TEZOS_DOMAINS_ENDPOINT = 'https://api.tezos.domains/graphql';
const TEZOS_DOMAINS_TIMEOUT_MS = 10_000;
const TEZ_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+tez$/i;
const TEZOS_ADDRESS_RE = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

function isTezosAddress(value) {
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

export async function resolveTezDomainAddress(value) {
    const name = normalizeTezDomainName(value);
    if (!name) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEZOS_DOMAINS_TIMEOUT_MS);
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

        const domain = payload?.data?.domain || {};
        return [domain.address, domain.owner].find(isTezosAddress) || null;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('Tezos Domains lookup timed out');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}
