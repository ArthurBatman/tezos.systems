const DEFAULT_LIMITS = Object.freeze({
  transactionStateBytes: 16 * 1024 * 1024,
  passportShardBytes: 1024 * 1024,
  seasonArtifactBytes: 64 * 1024 * 1024
});

export function prettyJsonBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
}

export function compactJsonBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`);
}

function shardEntries(payloads) {
  if (payloads instanceof Map) return [...payloads.entries()];
  return Object.entries(payloads || {});
}

export function measureSeasonArtifactBudget({
  rules,
  summary,
  transactionState,
  shardPayloads,
  limits = DEFAULT_LIMITS
}) {
  const resolvedLimits = {
    transactionStateBytes: Number(limits.transactionStateBytes),
    passportShardBytes: Number(limits.passportShardBytes),
    seasonArtifactBytes: Number(limits.seasonArtifactBytes)
  };
  const rulesBytes = prettyJsonBytes(rules);
  const summaryBytes = prettyJsonBytes(summary);
  const transactionStateBytes = prettyJsonBytes(transactionState);
  const shards = shardEntries(shardPayloads).map(([shard, payload]) => ({
    shard,
    bytes: compactJsonBytes(payload)
  }));
  const passportShardsBytes = shards.reduce((sum, shard) => sum + shard.bytes, 0);
  const maxShard = shards.reduce((largest, shard) => (
    !largest
    || shard.bytes > largest.bytes
    || (shard.bytes === largest.bytes && String(shard.shard) < String(largest.shard))
      ? shard
      : largest
  ), null);
  const totalBytes = rulesBytes + summaryBytes + transactionStateBytes + passportShardsBytes;
  const violations = [];
  if (transactionState?.status !== 'complete') violations.push('transaction state is not complete');
  if (transactionStateBytes > resolvedLimits.transactionStateBytes) {
    violations.push(`transaction state ${transactionStateBytes} exceeds ${resolvedLimits.transactionStateBytes} bytes`);
  }
  if ((maxShard?.bytes || 0) > resolvedLimits.passportShardBytes) {
    violations.push(`Passport shard ${maxShard.shard} is ${maxShard.bytes} bytes, above ${resolvedLimits.passportShardBytes}`);
  }
  if (totalBytes > resolvedLimits.seasonArtifactBytes) {
    violations.push(`season artifacts total ${totalBytes} bytes, above ${resolvedLimits.seasonArtifactBytes}`);
  }
  return {
    schema: 1,
    measurement: 'utf8-pretty-core-compact-shards-v1',
    rulesBytes,
    summaryBytes,
    transactionStateBytes,
    passportShardsBytes,
    totalBytes,
    shardCount: shards.length,
    maxShard: maxShard || { shard: null, bytes: 0 },
    limits: resolvedLimits,
    withinBudget: violations.length === 0,
    violations
  };
}

export function artifactBudgetErrors(receipt) {
  const errors = [];
  if (Number(receipt?.schema) !== 1 || receipt?.measurement !== 'utf8-pretty-core-compact-shards-v1') {
    errors.push('artifact budget receipt metadata is invalid');
  }
  if (receipt?.withinBudget !== true || receipt?.violations?.length) {
    errors.push(...(receipt?.violations?.length ? receipt.violations : ['artifact budget receipt is not within budget']));
  }
  return errors;
}
