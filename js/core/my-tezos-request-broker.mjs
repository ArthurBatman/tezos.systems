/**
 * Bounded, deduplicating request broker for My Tezos data sources.
 */

const DEFAULT_LIMITS = Object.freeze({
    tzkt: 2,
    objkt: 1,
    blockscout: 2,
    etherlinkRpc: 1,
    default: 2
});
const PRIORITY = Object.freeze({ interactive: 0, visible: 1, background: 2 });
const RETRYABLE = new Set([408, 429, 502, 503, 504]);

function stableBody(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (value instanceof URLSearchParams) return value.toString();
    try {
        return JSON.stringify(value, Object.keys(value).sort());
    } catch {
        return String(value);
    }
}

export function fingerprintMyTezosRequest({ method = 'GET', url = '', body = '', responseType = 'json' } = {}) {
    return `${String(method).toUpperCase()} ${String(url)} ${responseType} ${stableBody(body)}`;
}

function abortError(reason = 'Request aborted') {
    if (typeof DOMException === 'function') return new DOMException(String(reason), 'AbortError');
    const error = new Error(String(reason));
    error.name = 'AbortError';
    return error;
}

function wait(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abortError(signal.reason));
        }, { once: true });
    });
}

function callerRace(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError(signal.reason));
    return Promise.race([
        promise,
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError(signal.reason)), { once: true }))
    ]);
}

function retryDelay(response, attempt) {
    const retryAfter = Number(response?.headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(15_000, retryAfter * 1000);
    const base = Math.min(15_000, 1000 * (2 ** attempt));
    return Math.round(Math.random() * base);
}

async function parseResponse(response, responseType) {
    if (responseType === 'response') return response;
    if (responseType === 'text') return response.text();
    if (response.status === 204) return null;
    return response.json();
}

export class MyTezosRequestBroker {
    constructor({ limits = {}, fetchImpl = null } = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        this.fetchImpl = fetchImpl;
        this.queues = new Map();
        this.active = new Map();
        this.inFlight = new Map();
        this.sequence = 0;
        this.paused = false;
    }

    setPaused(paused) {
        this.paused = Boolean(paused);
        if (!this.paused) {
            for (const provider of this.queues.keys()) this.#drain(provider);
        }
    }

    request(url, {
        provider = 'default',
        priority = 'background',
        responseType = 'json',
        retries = 3,
        signal,
        key = '',
        ...init
    } = {}) {
        const requestKey = key || fingerprintMyTezosRequest({
            method: init.method || 'GET',
            url,
            body: init.body,
            responseType
        });
        const existing = this.inFlight.get(requestKey);
        if (existing) return callerRace(existing, signal);

        const shared = this.#enqueue({
            provider,
            priority: PRIORITY[priority] ?? PRIORITY.background,
            url,
            init,
            responseType,
            retries,
            sequence: this.sequence++
        }).finally(() => {
            if (this.inFlight.get(requestKey) === shared) this.inFlight.delete(requestKey);
        });
        this.inFlight.set(requestKey, shared);
        return callerRace(shared, signal);
    }

    #enqueue(job) {
        return new Promise((resolve, reject) => {
            const queue = this.queues.get(job.provider) || [];
            queue.push({ ...job, resolve, reject });
            queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
            this.queues.set(job.provider, queue);
            this.#drain(job.provider);
        });
    }

    #drain(provider) {
        if (this.paused) return;
        const limit = this.limits[provider] || this.limits.default;
        const active = this.active.get(provider) || 0;
        const queue = this.queues.get(provider) || [];
        if (active >= limit || !queue.length) return;
        const job = queue.shift();
        this.active.set(provider, active + 1);
        this.#perform(job).then(job.resolve, job.reject).finally(() => {
            this.active.set(provider, Math.max(0, (this.active.get(provider) || 1) - 1));
            this.#drain(provider);
        });
        this.#drain(provider);
    }

    async #perform(job) {
        const fetcher = this.fetchImpl || globalThis.fetch;
        if (typeof fetcher !== 'function') throw new Error('Fetch is unavailable');
        let lastError = null;
        for (let attempt = 0; attempt <= job.retries; attempt += 1) {
            try {
                const response = await fetcher(job.url, {
                    ...job.init,
                    __tezosSystemsPriority: job.priority === PRIORITY.interactive ? 'interactive' : 'background'
                });
                if (response.ok) return parseResponse(response, job.responseType);
                const error = new Error(`Request failed: ${response.status}`);
                error.status = response.status;
                lastError = error;
                if (!RETRYABLE.has(response.status) || attempt >= job.retries) throw error;
                await wait(retryDelay(response, attempt));
            } catch (error) {
                lastError = error;
                if (error?.name === 'AbortError' || attempt >= job.retries || (error?.status && !RETRYABLE.has(error.status))) throw error;
                await wait(Math.round(Math.random() * Math.min(15_000, 1000 * (2 ** attempt))));
            }
        }
        throw lastError || new Error('Request failed');
    }
}

export const myTezosRequestBroker = new MyTezosRequestBroker();

let visibilityBound = false;
export function initMyTezosRequestBrokerVisibility() {
    if (visibilityBound || typeof document === 'undefined') return;
    visibilityBound = true;
    myTezosRequestBroker.setPaused(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', () => {
        myTezosRequestBroker.setPaused(document.visibilityState !== 'visible');
    });
}
