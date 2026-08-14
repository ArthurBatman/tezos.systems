const TEMPORARY_FAILURE_EXIT_CODE = 75;
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 5000;
const DEFAULT_RETRY_CAP_MS = 30000;

class SupabaseWriteError extends Error {
  constructor(message, { status = null, body = '', retriable = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'SupabaseWriteError';
    this.status = status;
    this.body = body;
    this.retriable = retriable;
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function isRetryableSupabaseStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function responseError(label, response, body) {
  const status = Number(response.status) || null;
  return new SupabaseWriteError(`${label} insert failed: HTTP ${status || 'unknown'}${body ? ` - ${body}` : ''}`, {
    status,
    body,
    retriable: status !== null && isRetryableSupabaseStatus(status),
    retryAfterMs: retryAfterMilliseconds(response.headers?.get?.('retry-after'))
  });
}

function transportError(label, error) {
  if (error instanceof SupabaseWriteError) return error;
  return new SupabaseWriteError(`${label} insert failed: ${error?.message || error}`, {
    retriable: true
  });
}

function retryDelay(error, attempt, baseMs, capMs) {
  if (error.retryAfterMs > 0) return Math.min(capMs, error.retryAfterMs);
  return Math.min(capMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

async function confirmTimestampStored({ endpoint, headers, timestamp, fetchImpl, label }) {
  const query = new URLSearchParams({
    select: 'timestamp',
    timestamp: `eq.${timestamp}`,
    limit: '1'
  });
  let response;
  try {
    response = await fetchImpl(`${endpoint}?${query}`, {
      method: 'GET',
      headers: {
        ...headers,
        Accept: 'application/json'
      }
    });
  } catch (error) {
    throw transportError(label, error);
  }
  if (!response.ok) throw responseError(label, response, await responseText(response));
  try {
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    throw new SupabaseWriteError(`${label} retry confirmation returned invalid JSON: ${error.message}`, {
      retriable: false
    });
  }
}

async function postSupabaseJson({
  endpoint,
  supabaseKey,
  payload,
  label,
  onConflict = '',
  attempts = DEFAULT_ATTEMPTS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryCapMs = DEFAULT_RETRY_CAP_MS,
  fetchImpl = fetch,
  wait = sleep,
  warn = console.warn
}) {
  if (!endpoint || !supabaseKey) throw new Error('Supabase write endpoint and key are required');
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('Supabase write attempts must be a positive integer');
  const writeLabel = label || 'Supabase';
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    Prefer: onConflict ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal'
  };
  const writeUrl = onConflict
    ? `${endpoint}?on_conflict=${encodeURIComponent(onConflict)}`
    : endpoint;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && payload?.timestamp) {
      try {
        if (await confirmTimestampStored({ endpoint, headers, timestamp: payload.timestamp, fetchImpl, label: writeLabel })) {
          warn(`${writeLabel} write was already stored before retry ${attempt}; skipping a duplicate insert`);
          return { attempts: attempt - 1, recovered: true, alreadyStored: true };
        }
      } catch (error) {
        lastError = transportError(writeLabel, error);
        if (!lastError.retriable || attempt === attempts) throw lastError;
        const delay = retryDelay(lastError, attempt, retryBaseMs, retryCapMs);
        warn(`${writeLabel} retry confirmation failed temporarily; retrying in ${delay}ms (${attempt}/${attempts})`);
        await wait(delay);
        continue;
      }
    }

    try {
      const response = await fetchImpl(writeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (response.ok) return { attempts: attempt, recovered: attempt > 1, alreadyStored: false };
      lastError = responseError(writeLabel, response, await responseText(response));
    } catch (error) {
      lastError = transportError(writeLabel, error);
    }

    if (!lastError.retriable || attempt === attempts) throw lastError;
    const delay = retryDelay(lastError, attempt, retryBaseMs, retryCapMs);
    warn(`${writeLabel} write failed temporarily; retrying in ${delay}ms (${attempt}/${attempts})`);
    await wait(delay);
  }

  throw lastError || new SupabaseWriteError(`${writeLabel} insert failed`, { retriable: true });
}

module.exports = {
  DEFAULT_ATTEMPTS,
  SupabaseWriteError,
  TEMPORARY_FAILURE_EXIT_CODE,
  isRetryableSupabaseStatus,
  postSupabaseJson,
  retryAfterMilliseconds
};
