import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
const handlers = new Map();
const fetchCalls = [];
let fetchBehavior = async () => new Response('{}', { status: 200, headers: { ETag: '"receipt-v1"' } });

const self = {
  location: { origin: 'https://tezos.systems' },
  navigator: { onLine: true },
  addEventListener(type, handler) { handlers.set(type, handler); },
  skipWaiting() {},
  clients: { claim: async () => {}, matchAll: async () => [] }
};
const caches = {
  async keys() { return []; },
  async open() { throw new Error('generated receipts must not open Cache Storage'); },
  async match() { throw new Error('generated receipts must not read Cache Storage'); },
  async delete() { return true; }
};
const context = vm.createContext({
  AbortController,
  Request,
  Response,
  URL,
  caches,
  clearTimeout,
  console,
  fetch: async (request, init = {}) => {
    fetchCalls.push({ url: request.url, cache: init.cache });
    return fetchBehavior(request, init);
  },
  self,
  setTimeout
});
new vm.Script(source, { filename: 'sw.js' }).runInContext(context);

async function dispatchFetch(url) {
  let responsePromise = null;
  handlers.get('fetch')({
    request: new Request(url),
    respondWith(value) { responsePromise = Promise.resolve(value); },
    waitUntil() {}
  });
  assert.ok(responsePromise, `service worker should handle ${url}`);
  return responsePromise;
}

const summaryUrl = 'https://tezos.systems/data/ecosystem-entry-summary.json';
assert.equal((await dispatchFetch(summaryUrl)).status, 200);
assert.equal((await dispatchFetch(summaryUrl)).status, 200);
assert.deepEqual(
  fetchCalls.map((call) => call.cache),
  ['no-cache', 'no-cache'],
  'mutable generated receipts should reach the HTTP cache revalidation path on every online poll'
);

fetchBehavior = async () => { throw new Error('offline revalidation'); };
const unavailable = await dispatchFetch(summaryUrl);
assert.equal(unavailable.status, 503, 'a failed generated-receipt revalidation must fail closed');
assert.equal(unavailable.headers.get('X-Tezos-Systems-Cache'), 'miss');

const callsBeforeOffline = fetchCalls.length;
self.navigator.onLine = false;
assert.equal((await dispatchFetch(summaryUrl)).status, 503);
assert.equal(fetchCalls.length, callsBeforeOffline, 'explicitly offline generated receipts must not consult warmed HTTP bytes');

self.navigator.onLine = true;
fetchBehavior = async () => new Response('{}', { status: 200 });
assert.equal((await dispatchFetch('https://api.tzkt.io/v1/head')).status, 200);
assert.equal(fetchCalls.at(-1).cache, 'no-store', 'live external API reads must continue bypassing browser caches');

console.log('ok - service worker conditionally revalidates generated receipts and fails closed without Cache Storage replay');
