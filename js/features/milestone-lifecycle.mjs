export const MILESTONE_STORE_SCHEMA = 2;
export const MILESTONE_MOMENT_TTL_MS = 72 * 60 * 60 * 1000;

export function claimMilestoneArrival(seen, identity) {
  if (!(seen instanceof Set) || !identity || seen.has(identity)) return false;
  seen.add(identity);
  return true;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function targetKey(value) {
  const number = finitePositive(value);
  return number == null ? '' : String(number);
}

function emptyTrackState() {
  return {
    lastValue: null,
    lastObservedAt: null,
    celebratedTargets: {},
    activeMoments: {}
  };
}

function normalizeCelebratedTargets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  Object.entries(value).forEach(([key, entry]) => {
    const target = finitePositive(key);
    if (target == null) return;
    const firstObservedAt = finiteTimestamp(entry?.firstObservedAt || entry?.crossedAt);
    normalized[targetKey(target)] = {
      ...(firstObservedAt ? { firstObservedAt } : {}),
      baseline: entry?.baseline === true
    };
  });
  return normalized;
}

function normalizeActiveMoments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  Object.values(value).forEach((entry) => {
    const target = finitePositive(entry?.target);
    const createdAt = finiteTimestamp(entry?.createdAt);
    const expiresAt = finiteTimestamp(entry?.expiresAt);
    if (target == null || createdAt == null || expiresAt == null || expiresAt <= createdAt) return;
    normalized[targetKey(target)] = {
      target,
      createdAt,
      expiresAt,
      crossedValue: finitePositive(entry?.crossedValue) ?? target
    };
  });
  return normalized;
}

function normalizeTrackState(value) {
  const track = emptyTrackState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return track;
  track.lastValue = finitePositive(value.lastValue);
  track.lastObservedAt = finiteTimestamp(value.lastObservedAt);
  track.celebratedTargets = normalizeCelebratedTargets(value.celebratedTargets);
  track.activeMoments = normalizeActiveMoments(value.activeMoments);
  Object.values(track.activeMoments).forEach((moment) => {
    const key = targetKey(moment.target);
    if (!track.celebratedTargets[key]) {
      track.celebratedTargets[key] = { firstObservedAt: moment.createdAt, baseline: false };
    }
  });
  return track;
}

export function normalizeMilestoneStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== MILESTONE_STORE_SCHEMA) {
    return { schema: MILESTONE_STORE_SCHEMA, tracks: {}, migrated: true };
  }
  const tracks = {};
  if (value.tracks && typeof value.tracks === 'object' && !Array.isArray(value.tracks)) {
    Object.entries(value.tracks).forEach(([id, track]) => {
      if (!id) return;
      tracks[id] = normalizeTrackState(track);
    });
  }
  return { schema: MILESTONE_STORE_SCHEMA, tracks, migrated: false };
}

function sortedThresholds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(finitePositive)
    .filter(value => value != null))]
    .sort((a, b) => a - b);
}

function normalizedMoment(entry, now) {
  const target = finitePositive(entry?.target);
  const createdAt = finiteTimestamp(entry?.createdAt || entry?.crossedAt);
  const expiresAt = finiteTimestamp(entry?.expiresAt);
  if (target == null || createdAt == null || expiresAt == null || createdAt > now || expiresAt <= now) return null;
  return {
    target,
    createdAt,
    expiresAt,
    crossedValue: finitePositive(entry?.crossedValue) ?? target
  };
}

export function deriveMilestoneMoments({
  currentValue,
  thresholds,
  now = Date.now(),
  ttlMs = MILESTONE_MOMENT_TTL_MS,
  anchorValue,
  anchorObservedAt,
  receipts = []
} = {}) {
  const observedAt = finiteTimestamp(now);
  const lifetime = finitePositive(ttlMs);
  if (observedAt == null || lifetime == null) return [];

  const moments = new Map();
  (Array.isArray(receipts) ? receipts : []).forEach((entry) => {
    const moment = normalizedMoment(entry, observedAt);
    if (moment) moments.set(targetKey(moment.target), moment);
  });

  const current = finitePositive(currentValue);
  const anchor = finitePositive(anchorValue);
  const anchorAt = finiteTimestamp(anchorObservedAt);
  if (current != null && anchor != null && anchorAt != null && current > anchor && observedAt > anchorAt) {
    sortedThresholds(thresholds)
      .filter(target => anchor < target && target <= current)
      .forEach((target) => {
        const key = targetKey(target);
        if (moments.has(key)) return;
        const progress = (target - anchor) / (current - anchor);
        const createdAt = Math.round(anchorAt + ((observedAt - anchorAt) * progress));
        const expiresAt = createdAt + lifetime;
        if (createdAt > observedAt || expiresAt <= observedAt) return;
        moments.set(key, { target, createdAt, expiresAt, crossedValue: current });
      });
  }

  return [...moments.values()].sort((a, b) => b.createdAt - a.createdAt || b.target - a.target);
}

export function qualifyMilestoneNearState({
  currentValue,
  thresholds,
  nearWindow,
  dailyRate,
  maxLeadDays = 14,
  absoluteMaxDays = 30
}) {
  const current = finitePositive(currentValue);
  const rate = finitePositive(dailyRate);
  if (current == null || rate == null) return null;

  const next = sortedThresholds(thresholds).find(target => current < target) || null;
  if (next == null) return null;

  const gap = next - current;
  const window = finitePositive(nearWindow) ?? (next * 0.025);
  const hardCap = Math.min(finitePositive(absoluteMaxDays) ?? 30, 30);
  const requestedLead = finitePositive(maxLeadDays) ?? 14;
  const leadDays = Math.min(requestedLead, hardCap);
  const etaDays = gap / rate;
  if (gap > window || etaDays > leadDays || etaDays > hardCap) return null;

  return {
    status: 'near',
    target: next,
    gap,
    current,
    dailyRate: rate,
    etaDays,
    leadDays
  };
}

function activeMoments(track, now) {
  return Object.values(track.activeMoments)
    .filter(moment => moment.expiresAt > now)
    .sort((a, b) => b.target - a.target);
}

export function advanceMilestoneTrack(store, {
  trackId,
  currentValue,
  thresholds,
  now = Date.now(),
  ttlMs
}) {
  if (!store || store.schema !== MILESTONE_STORE_SCHEMA || !store.tracks || !trackId) {
    throw new Error('advanceMilestoneTrack requires a normalized milestone store and track id');
  }

  const current = finitePositive(currentValue);
  const orderedThresholds = sortedThresholds(thresholds);
  const lifetime = finitePositive(ttlMs);
  const track = normalizeTrackState(store.tracks[trackId]);
  store.tracks[trackId] = track;
  let changed = false;

  Object.entries(track.activeMoments).forEach(([key, moment]) => {
    if (moment.expiresAt <= now) {
      delete track.activeMoments[key];
      changed = true;
    }
  });

  if (current == null) {
    return { activeMoments: activeMoments(track, now), newlyCrossed: [], baseline: false, changed };
  }

  const previous = finitePositive(track.lastValue);
  const baseline = previous == null;
  const newlyCrossed = [];

  if (baseline) {
    orderedThresholds.filter(target => target <= current).forEach((target) => {
      const key = targetKey(target);
      if (track.celebratedTargets[key]) return;
      track.celebratedTargets[key] = { firstObservedAt: now, baseline: true };
      changed = true;
    });
  } else if (current > previous && lifetime != null) {
    orderedThresholds
      .filter(target => previous < target && target <= current)
      .forEach((target) => {
        const key = targetKey(target);
        if (track.celebratedTargets[key]) return;
        const moment = {
          target,
          createdAt: now,
          expiresAt: now + lifetime,
          crossedValue: current
        };
        track.celebratedTargets[key] = { firstObservedAt: now, baseline: false };
        track.activeMoments[key] = moment;
        newlyCrossed.push(moment);
        changed = true;
      });
  }

  if (track.lastValue !== current || track.lastObservedAt == null) {
    track.lastValue = current;
    track.lastObservedAt = now;
    changed = true;
  }

  return {
    activeMoments: activeMoments(track, now),
    newlyCrossed,
    baseline,
    changed
  };
}
