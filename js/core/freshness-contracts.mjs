const HOUR_MS = 60 * 60 * 1000;

/**
 * Historical ledgers arrive through GitHub-hosted collectors whose observed
 * delivery can lag their cron schedule. Keep the observation time visible, but
 * reserve the stale alarm for a genuinely missed delivery.
 */
export const HISTORY_FRESHNESS_LIMITS = Object.freeze({
    tezos_history: 5 * HOUR_MS,
    market_history: 5 * HOUR_MS,
    network_health_history: 5 * HOUR_MS,
    governance_period_history: 5 * HOUR_MS,
    tezosx_history: 5 * HOUR_MS
});

/**
 * Generated proofbooks are rebuilt by Refresh Generated Surfaces.
 * This describes the intended schedule, not a guarantee of delivery time.
 */
export const GENERATED_PROOFBOOK_SCHEDULE_LABEL = '6h schedule';
