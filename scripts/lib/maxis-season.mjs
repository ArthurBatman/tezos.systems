import * as evaluatorV2 from './maxis-evaluator-v2.mjs';

const EVALUATORS = new Map([
  [evaluatorV2.SEASON_EVALUATOR_VERSION, evaluatorV2]
]);

// Updating this pointer opens a new protocol season under a new evaluator.
// Historical/settling seasons continue to dispatch by their frozen version.
export const CURRENT_MAXIS_EVALUATOR_VERSION = evaluatorV2.SEASON_EVALUATOR_VERSION;

export function getMaxisEvaluator(version) {
  const requested = String(version || '');
  const evaluator = EVALUATORS.get(requested);
  if (!evaluator) throw new Error(`Unsupported frozen Maxis evaluator version: ${version || '<missing>'}`);
  if (evaluator.SEASON_EVALUATOR_VERSION !== requested) {
    throw new Error(`Maxis evaluator registry mismatch: requested ${requested}, module declares ${evaluator.SEASON_EVALUATOR_VERSION || '<missing>'}`);
  }
  return evaluator;
}

export function registerMaxisEvaluator(version, evaluator) {
  const requested = String(version || '');
  if (!requested || evaluator?.SEASON_EVALUATOR_VERSION !== requested) {
    throw new Error(`Cannot register mismatched Maxis evaluator ${requested || '<missing>'}`);
  }
  if (EVALUATORS.has(requested)) throw new Error(`Maxis evaluator ${requested} is already registered`);
  EVALUATORS.set(requested, evaluator);
}

export function maxisEvaluatorVersions() {
  return [...EVALUATORS.keys()];
}

export * from './maxis-evaluator-v2.mjs';
