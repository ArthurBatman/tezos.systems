import * as sourceV2 from './maxis-source-v2.mjs';

const SOURCES = new Map([
  ['maxis-evaluator-v2', sourceV2]
]);

export function getMaxisSource(version) {
  const requested = String(version || '');
  const source = SOURCES.get(requested);
  if (!source) throw new Error(`Unsupported Maxis source adapter: ${version}`);
  if (source.EVALUATOR_VERSION !== requested) {
    throw new Error(`Maxis source registry mismatch: requested ${requested}, module declares ${source.EVALUATOR_VERSION || '<missing>'}`);
  }
  return source;
}

export function registerMaxisSource(version, source) {
  const requested = String(version || '');
  if (!requested || source?.EVALUATOR_VERSION !== requested) {
    throw new Error(`Cannot register mismatched Maxis source ${requested || '<missing>'}`);
  }
  if (SOURCES.has(requested)) throw new Error(`Maxis source ${requested} is already registered`);
  SOURCES.set(requested, source);
}

export function maxisSourceVersions() {
  return [...SOURCES.keys()];
}
