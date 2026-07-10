export async function fetchOffsetPages(fetchPage, {
  pageSize,
  maxPages,
  startOffset = 0
} = {}) {
  const size = Number(pageSize);
  const limit = Number(maxPages);
  const offset = Number(startOffset);
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (!Number.isInteger(size) || size < 1) throw new RangeError('pageSize must be a positive integer');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('maxPages must be a positive integer');
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('startOffset must be a non-negative integer');

  const rows = [];
  for (let page = 0; page < limit; page += 1) {
    const pageOffset = offset + page * size;
    const batch = await fetchPage({ page, limit: size, offset: pageOffset });
    if (!Array.isArray(batch)) throw new TypeError(`Page ${page} did not return an array`);
    if (batch.length > size) throw new RangeError(`Page ${page} returned ${batch.length} rows for limit ${size}`);
    rows.push(...batch);
    if (batch.length < size) {
      return { rows, pages: page + 1, truncated: false, nextOffset: pageOffset + batch.length };
    }
  }
  return { rows, pages: limit, truncated: true, nextOffset: offset + limit * size };
}

function bigintCursor(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^-?\d+$/.test(normalized)) throw new TypeError(`${label} must be an integer cursor`);
  return BigInt(normalized);
}

export async function fetchKeysetPages(fetchPage, {
  pageSize,
  maxPages,
  startAfter = '0',
  getCursor = (row) => row?.id
} = {}) {
  const size = Number(pageSize);
  const limit = Number(maxPages);
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (typeof getCursor !== 'function') throw new TypeError('getCursor must be a function');
  if (!Number.isInteger(size) || size < 1) throw new RangeError('pageSize must be a positive integer');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('maxPages must be a positive integer');

  let after = String(bigintCursor(startAfter, 'startAfter'));
  let previous = bigintCursor(startAfter, 'startAfter');
  let firstCursor = null;
  let lastCursor = null;
  const rows = [];
  for (let page = 0; page < limit; page += 1) {
    const batch = await fetchPage({ page, limit: size, after });
    if (!Array.isArray(batch)) throw new TypeError(`Page ${page} did not return an array`);
    if (batch.length > size) throw new RangeError(`Page ${page} returned ${batch.length} rows for limit ${size}`);
    for (let index = 0; index < batch.length; index += 1) {
      const rawCursor = getCursor(batch[index]);
      const cursor = bigintCursor(rawCursor, `Page ${page} row ${index} cursor`);
      if (cursor <= previous) {
        throw new Error(`Keyset pagination cursor must increase strictly: ${cursor} followed ${previous}`);
      }
      const textCursor = String(cursor);
      firstCursor ||= textCursor;
      lastCursor = textCursor;
      previous = cursor;
    }
    rows.push(...batch);
    if (batch.length) after = String(previous);
    if (batch.length < size) {
      return {
        rows,
        pages: page + 1,
        truncated: false,
        nextAfter: after,
        firstCursor,
        lastCursor,
        cursorOrderVerified: true
      };
    }
  }
  return {
    rows,
    pages: limit,
    truncated: true,
    nextAfter: after,
    firstCursor,
    lastCursor,
    cursorOrderVerified: true
  };
}
