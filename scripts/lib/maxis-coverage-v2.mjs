import { compareCodePoint } from './maxis-evaluator-v2-primitives.mjs';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function compileContractCoverage(contracts = [], apps = [], fromIso = null) {
  const from = Date.parse(fromIso || '') || 0;
  const coverage = [];
  const seen = new Set();
  for (const contract of contracts) {
    if (!contract?.address || !contract?.alias) continue;
    if (from && (Date.parse(contract.lastActivityTime || '') || 0) < from) continue;
    const matches = apps.filter((app) => (app.aliasPatterns || []).some((pattern) => new RegExp(pattern, 'i').test(contract.alias)));
    for (const app of matches) {
      const key = `${app.category}:${contract.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({
        address: contract.address,
        alias: contract.alias,
        kind: contract.kind || null,
        lastActivityTime: isoTime(contract.lastActivityTime),
        app: { id: app.id, label: app.label, category: app.category }
      });
    }
  }
  return coverage.sort((left, right) => compareCodePoint(left.address, right.address));
}

export function validateMaxisConfig(config) {
  const errors = [];
  if (number(config?.schema) !== 1) errors.push('schema must be 1');
  if (number(config?.windowDays) < 1) errors.push('windowDays must be positive');
  if (!Number.isInteger(Number(config?.contractCatalogLimit)) || Number(config.contractCatalogLimit) < 1) errors.push('contractCatalogLimit must be a positive integer');
  const ids = new Set();
  for (const app of config?.apps || []) {
    if (!app?.id || !app?.label || !['defi', 'gaming'].includes(app?.category)) {
      errors.push(`invalid app entry ${app?.id || '<missing id>'}`);
      continue;
    }
    if (ids.has(app.id)) errors.push(`duplicate app id ${app.id}`);
    ids.add(app.id);
    if (!Array.isArray(app.aliasPatterns) || !app.aliasPatterns.length) errors.push(`missing alias patterns for ${app.id}`);
    for (const pattern of app.aliasPatterns || []) {
      try { new RegExp(pattern, 'i'); } catch { errors.push(`invalid alias pattern for ${app.id}: ${pattern}`); }
    }
    if (app.liquidityEntrypoints != null) {
      if (!Array.isArray(app.liquidityEntrypoints)) errors.push(`liquidity entrypoints for ${app.id} must be an array`);
      else {
        const entrypoints = new Set();
        for (const entrypoint of app.liquidityEntrypoints) {
          if (!String(entrypoint || '').trim()) errors.push(`invalid liquidity entrypoint for ${app.id}`);
          if (entrypoints.has(entrypoint)) errors.push(`duplicate liquidity entrypoint for ${app.id}: ${entrypoint}`);
          entrypoints.add(entrypoint);
        }
      }
    }
  }
  return errors;
}
