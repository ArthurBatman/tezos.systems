#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  TEMPORARY_FAILURE_EXIT_CODE,
  isRetryableSupabaseStatus,
  postSupabaseJson,
  retryAfterMilliseconds
} = require('../.github/scripts/supabase-write.js');

const endpoint = 'https://example.supabase.co/rest/v1/history';
const payload = { timestamp: '2026-08-14T09:08:06.515Z', value: 1 };
const response = (status, body = '', headers = {}) => new Response(body, { status, headers });

assert.equal(TEMPORARY_FAILURE_EXIT_CODE, 75);
assert.equal(isRetryableSupabaseStatus(503), true);
assert.equal(isRetryableSupabaseStatus(429), true);
assert.equal(isRetryableSupabaseStatus(401), false);
assert.equal(retryAfterMilliseconds('3', 0), 3000);

{
  const calls = [];
  const delays = [];
  const result = await postSupabaseJson({
    endpoint,
    supabaseKey: 'test-key',
    payload,
    label: 'history',
    attempts: 3,
    retryBaseMs: 7,
    retryCapMs: 10,
    warn: () => {},
    wait: async milliseconds => delays.push(milliseconds),
    fetchImpl: async (_url, options) => {
      calls.push(options.method);
      if (calls.length === 1) return response(503, 'temporary upstream outage');
      if (options.method === 'GET') return response(200, '[]', { 'content-type': 'application/json' });
      return response(201);
    }
  });
  assert.deepEqual(calls, ['POST', 'GET', 'POST']);
  assert.deepEqual(delays, [7]);
  assert.deepEqual(result, { attempts: 2, recovered: true, alreadyStored: false });
}

{
  let postCalls = 0;
  const result = await postSupabaseJson({
    endpoint,
    supabaseKey: 'test-key',
    payload,
    label: 'history',
    attempts: 3,
    retryBaseMs: 1,
    warn: () => {},
    wait: async () => {},
    fetchImpl: async (_url, options) => {
      if (options.method === 'POST') {
        postCalls += 1;
        return response(503, 'response lost after write');
      }
      return response(200, JSON.stringify([{ timestamp: payload.timestamp }]), { 'content-type': 'application/json' });
    }
  });
  assert.equal(postCalls, 1, 'retry confirmation must prevent an ambiguous write from becoming a duplicate row');
  assert.equal(result.alreadyStored, true);
}

{
  let calls = 0;
  await assert.rejects(
    postSupabaseJson({
      endpoint,
      supabaseKey: 'test-key',
      payload,
      label: 'history',
      attempts: 4,
      warn: () => {},
      wait: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return response(401, 'bad credentials');
      }
    }),
    error => error.status === 401 && error.retriable === false
  );
  assert.equal(calls, 1, 'auth and schema-class errors must fail without retry');
}

{
  await assert.rejects(
    postSupabaseJson({
      endpoint,
      supabaseKey: 'test-key',
      payload,
      label: 'history',
      attempts: 2,
      retryBaseMs: 1,
      warn: () => {},
      wait: async () => {},
      fetchImpl: async () => { throw new TypeError('fetch failed'); }
    }),
    error => error.retriable === true && /fetch failed/.test(error.message)
  );
}

console.log('ok - Supabase writes retry transient failures, confirm ambiguous writes, and fail hard errors immediately');
