export const DEFAULT_GLOBAL_DELEGATION_LIMIT = 9;

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeBakerStakingLimit(value, globalLimit = DEFAULT_GLOBAL_DELEGATION_LIMIT) {
    const raw = finiteNumber(value, 0);
    const decoded = raw > 1000 ? raw / 1_000_000 : raw;
    return Math.max(0, Math.min(decoded, finiteNumber(globalLimit, DEFAULT_GLOBAL_DELEGATION_LIMIT)));
}

export function normalizeBakerRewardEdge(value) {
    const raw = finiteNumber(value, 0);
    const decoded = raw > 1 ? raw / 1_000_000_000 : raw;
    return Math.max(0, Math.min(decoded, 1));
}

export function buildBakerCapacitySnapshot(baker, globalLimit = DEFAULT_GLOBAL_DELEGATION_LIMIT) {
    const activeGlobalLimit = finiteNumber(globalLimit, DEFAULT_GLOBAL_DELEGATION_LIMIT) > 0
        ? finiteNumber(globalLimit, DEFAULT_GLOBAL_DELEGATION_LIMIT)
        : DEFAULT_GLOBAL_DELEGATION_LIMIT;
    const ownStake = Math.max(0, finiteNumber(baker?.stakedBalance) / 1_000_000);
    const externalDelegated = Math.max(0, finiteNumber(baker?.externalDelegatedBalance) / 1_000_000);
    const externalStaked = Math.max(0, finiteNumber(baker?.externalStakedBalance) / 1_000_000);
    const stakingLimit = normalizeBakerStakingLimit(baker?.limitOfStakingOverBaking, activeGlobalLimit);
    const maxDelegation = ownStake * activeGlobalLimit;
    const maxExternalStake = ownStake * stakingLimit;
    const freeDelegationCapacity = maxDelegation - externalDelegated;
    const freeStakingCapacity = maxExternalStake - externalStaked;

    return {
        active: baker?.active !== false,
        ownStake,
        externalDelegated,
        externalStaked,
        globalDelegationLimit: activeGlobalLimit,
        stakingLimit,
        rewardEdge: normalizeBakerRewardEdge(baker?.edgeOfBakingOverStaking),
        maxDelegation,
        maxExternalStake,
        freeDelegationCapacity,
        freeStakingCapacity,
        delegationUsage: maxDelegation > 0 ? (externalDelegated / maxDelegation) * 100 : 0,
        stakingUsage: maxExternalStake > 0 ? (externalStaked / maxExternalStake) * 100 : 0,
        acceptsExternalStake: baker?.active !== false && stakingLimit > 0 && freeStakingCapacity > 0,
        pendingStakingParameters: baker?.pendingStakingParameters || null
    };
}
