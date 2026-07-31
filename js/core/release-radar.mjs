/**
 * Pure validation and presentation model for the server-generated Release
 * Radar forecast. The browser renders reviewed judgments from JSON; it never
 * turns merge volume into release confidence or Tezos X completion.
 */

export const RELEASE_RADAR_SCHEMA_VERSION = 1;
export const RELEASE_RADAR_CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'none']);
export const RELEASE_RADAR_GATE_STATUSES = Object.freeze([
    'not_started',
    'signal_detected',
    'active',
    'validating',
    'ready',
    'blocked',
    'complete'
]);
export const RELEASE_RADAR_TEZOS_X_GATES = Object.freeze([
    'runtime',
    'previewnet',
    'tooling',
    'proposal',
    'governance',
    'rollout'
]);

const RELEASE_RADAR_LIFECYCLES = new Set(['forecast', 'released', 'no_signal']);
const RELEASE_RADAR_KINDS = new Set([
    'tezos_x_launch',
    'octez_release',
    'evm_node_release',
    'previewnet_deployment',
    'l1_protocol_proposal'
]);
const RECENT_RELEASE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RECEIPT_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;

function requiredString(value, label, maxLength = 320) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`Release Radar ${label} is required`);
    return normalized.slice(0, maxLength);
}

function optionalString(value, maxLength = 320) {
    return String(value || '').trim().slice(0, maxLength);
}

function isoTimestamp(value, label, { optional = false } = {}) {
    if (optional && !value) return '';
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp)) throw new Error(`Release Radar ${label} must be an ISO timestamp`);
    return new Date(timestamp).toISOString();
}

function httpsUrl(value, label) {
    const url = requiredString(value, label, 1000);
    if (!/^https:\/\//i.test(url)) throw new Error(`Release Radar ${label} must use HTTPS`);
    return url;
}

function safeRoute(value, label) {
    const route = optionalString(value, 1000);
    if (!route) return '';
    if (/^https:\/\//i.test(route) || /^\/(?!\/)/.test(route)) return route;
    throw new Error(`Release Radar ${label} must be root-relative or use HTTPS`);
}

function normalizeEvidence(row, candidateId, index) {
    return {
        label: requiredString(row?.label, `${candidateId} evidence ${index + 1} label`, 120),
        url: httpsUrl(row?.url, `${candidateId} evidence ${index + 1} URL`),
        observedAt: isoTimestamp(row?.observedAt, `${candidateId} evidence ${index + 1} observedAt`),
        note: optionalString(row?.note, 240)
    };
}

function normalizeHistory(row, candidateId, index) {
    const confidence = optionalString(row?.confidence, 12).toLowerCase();
    const previousConfidence = optionalString(row?.previousConfidence, 12).toLowerCase();
    if (confidence && !RELEASE_RADAR_CONFIDENCE.includes(confidence)) {
        throw new Error(`Release Radar ${candidateId} history ${index + 1} has invalid confidence`);
    }
    if (previousConfidence && !RELEASE_RADAR_CONFIDENCE.includes(previousConfidence)) {
        throw new Error(`Release Radar ${candidateId} history ${index + 1} has invalid previous confidence`);
    }
    return {
        observedAt: isoTimestamp(row?.observedAt, `${candidateId} history ${index + 1} observedAt`),
        confidence,
        previousConfidence,
        reason: requiredString(row?.reason, `${candidateId} history ${index + 1} reason`, 280)
    };
}

function normalizeGate(gate, candidateId, index) {
    const id = requiredString(gate?.id, `${candidateId} gate ${index + 1} id`, 40);
    const status = requiredString(gate?.status, `${candidateId} gate ${id} status`, 32).toLowerCase();
    if (!RELEASE_RADAR_GATE_STATUSES.includes(status)) {
        throw new Error(`Release Radar ${candidateId} gate ${id} has invalid status`);
    }
    return {
        id,
        label: requiredString(gate?.label, `${candidateId} gate ${id} label`, 80),
        status,
        detail: requiredString(gate?.detail, `${candidateId} gate ${id} detail`, 240)
    };
}

function normalizeRecentRelease(release, candidateId) {
    if (!release) return null;
    return {
        label: requiredString(release.label, `${candidateId} recent release label`, 100),
        releasedAt: isoTimestamp(release.releasedAt, `${candidateId} recent release releasedAt`),
        url: httpsUrl(release.url, `${candidateId} recent release URL`),
        summary: requiredString(release.summary, `${candidateId} recent release summary`, 220)
    };
}

function normalizeCandidate(candidate, index) {
    const id = requiredString(candidate?.id, `candidate ${index + 1} id`, 64);
    const kind = requiredString(candidate?.kind, `${id} kind`, 48);
    const confidence = requiredString(candidate?.confidence, `${id} confidence`, 12).toLowerCase();
    const lifecycle = requiredString(candidate?.lifecycle, `${id} lifecycle`, 20).toLowerCase();
    if (!RELEASE_RADAR_KINDS.has(kind)) {
        throw new Error(`Release Radar ${id} has invalid kind`);
    }
    if (!RELEASE_RADAR_CONFIDENCE.includes(confidence)) {
        throw new Error(`Release Radar ${id} has invalid confidence`);
    }
    if (!RELEASE_RADAR_LIFECYCLES.has(lifecycle)) {
        throw new Error(`Release Radar ${id} has invalid lifecycle`);
    }
    const horizon = optionalString(candidate?.horizon, 48);
    if (confidence === 'none' && horizon) {
        throw new Error(`Release Radar ${id} cannot publish a horizon without confidence`);
    }
    if (lifecycle === 'no_signal' && confidence !== 'none') {
        throw new Error(`Release Radar ${id} no-signal candidates require none confidence`);
    }
    if (lifecycle === 'forecast' && confidence === 'none') {
        throw new Error(`Release Radar ${id} forecasts require supported confidence`);
    }
    if (lifecycle === 'released' && confidence !== 'high') {
        throw new Error(`Release Radar ${id} released candidates require high confidence`);
    }
    const gates = Array.isArray(candidate?.gates)
        ? candidate.gates.map((gate, gateIndex) => normalizeGate(gate, id, gateIndex))
        : [];
    if (kind === 'tezos_x_launch') {
        const gateIds = gates.map((gate) => gate.id);
        if (gateIds.length !== RELEASE_RADAR_TEZOS_X_GATES.length
            || RELEASE_RADAR_TEZOS_X_GATES.some((gateId, gateIndex) => gateIds[gateIndex] !== gateId)) {
            throw new Error(`Release Radar ${id} must keep all six Tezos X gates separate`);
        }
    }
    const evidence = Array.isArray(candidate?.evidence)
        ? candidate.evidence.map((row, evidenceIndex) => normalizeEvidence(row, id, evidenceIndex))
        : [];
    if (!evidence.length) throw new Error(`Release Radar ${id} requires evidence`);
    const history = Array.isArray(candidate?.history)
        ? candidate.history.map((row, historyIndex) => normalizeHistory(row, id, historyIndex))
        : [];
    if (!history.length) throw new Error(`Release Radar ${id} requires candidate history`);
    const releasedAt = isoTimestamp(candidate?.releasedAt, `${id} releasedAt`, { optional: true });
    if (lifecycle === 'released' && !releasedAt) {
        throw new Error(`Release Radar ${id} released candidates require releasedAt`);
    }
    if (lifecycle !== 'released' && releasedAt) {
        throw new Error(`Release Radar ${id} non-released candidates cannot carry releasedAt`);
    }
    return {
        id,
        label: requiredString(candidate?.label, `${id} label`, 100),
        kind,
        lifecycle,
        confidence,
        horizon,
        summary: requiredString(candidate?.summary, `${id} summary`, 300),
        nextSignal: requiredString(candidate?.nextSignal, `${id} nextSignal`, 220),
        route: safeRoute(candidate?.route, `${id} route`),
        stage: optionalString(candidate?.stage, 80),
        highlight: optionalString(candidate?.highlight, 260),
        excitement: ['high', 'medium'].includes(candidate?.excitement) ? candidate.excitement : '',
        releasedAt,
        gates,
        evidence,
        history,
        recentRelease: normalizeRecentRelease(candidate?.recentRelease, id)
    };
}

export function normalizeReleaseRadarSnapshot(raw, { now = Date.now() } = {}) {
    if (!raw || typeof raw !== 'object') throw new Error('Release Radar snapshot must be an object');
    if (Number(raw.schemaVersion) !== RELEASE_RADAR_SCHEMA_VERSION) {
        throw new Error(`Release Radar schema must be ${RELEASE_RADAR_SCHEMA_VERSION}`);
    }
    const updatedAt = isoTimestamp(raw.updatedAt, 'updatedAt');
    const expiresAt = isoTimestamp(raw.expiresAt, 'expiresAt');
    const updatedAtMs = Date.parse(updatedAt);
    const expiresAtMs = Date.parse(expiresAt);
    if (updatedAtMs > now + 10 * 60 * 1000) throw new Error('Release Radar updatedAt is implausibly in the future');
    if (expiresAtMs <= updatedAtMs) throw new Error('Release Radar expiresAt must follow updatedAt');
    if (expiresAtMs - updatedAtMs > MAX_RECEIPT_LIFETIME_MS) {
        throw new Error('Release Radar receipt lifetime cannot exceed 31 days');
    }
    const staleAfterHours = Number(raw.staleAfterHours);
    if (!Number.isFinite(staleAfterHours) || staleAfterHours < 1 || staleAfterHours > 168) {
        throw new Error('Release Radar staleAfterHours must be between 1 and 168');
    }
    const candidates = Array.isArray(raw.candidates)
        ? raw.candidates.map(normalizeCandidate)
        : [];
    if (!candidates.length) throw new Error('Release Radar requires candidates');
    const ids = candidates.map((candidate) => candidate.id);
    if (new Set(ids).size !== ids.length) throw new Error('Release Radar candidate ids must be unique');
    for (const requiredKind of ['tezos_x_launch', 'octez_release', 'evm_node_release']) {
        if (!candidates.some((candidate) => candidate.kind === requiredKind)) {
            throw new Error(`Release Radar requires a separate ${requiredKind} lane`);
        }
    }
    for (const candidate of candidates) {
        const receiptTimes = [
            ...candidate.evidence.map((row) => Date.parse(row.observedAt)),
            ...candidate.history.map((row) => Date.parse(row.observedAt)),
            ...(candidate.releasedAt ? [Date.parse(candidate.releasedAt)] : []),
            ...(candidate.recentRelease ? [Date.parse(candidate.recentRelease.releasedAt)] : [])
        ];
        if (receiptTimes.some((timestamp) => timestamp > updatedAtMs + 10 * 60 * 1000)) {
            throw new Error(`Release Radar ${candidate.id} contains evidence newer than the receipt`);
        }
    }
    const methodology = Array.isArray(raw.methodology)
        ? raw.methodology.map((line, index) => requiredString(line, `methodology ${index + 1}`, 320))
        : [];
    if (!methodology.length) throw new Error('Release Radar requires methodology');
    return {
        schemaVersion: RELEASE_RADAR_SCHEMA_VERSION,
        kind: requiredString(raw.kind, 'kind', 64),
        updatedAt,
        updatedAtMs,
        expiresAt,
        expiresAtMs,
        staleAfterHours,
        staleAtMs: updatedAtMs + (staleAfterHours * 60 * 60 * 1000),
        sourceRun: {
            label: requiredString(raw.sourceRun?.label, 'sourceRun label', 100),
            cadence: requiredString(raw.sourceRun?.cadence, 'sourceRun cadence', 80),
            method: requiredString(raw.sourceRun?.method, 'sourceRun method', 140)
        },
        candidates,
        methodology
    };
}

export function buildReleaseRadarSignal(snapshot, { now = Date.now(), sourceState = 'fresh' } = {}) {
    if (!snapshot || snapshot.expiresAtMs <= now) return null;
    const main = snapshot.candidates.find((candidate) => candidate.kind === 'tezos_x_launch')
        || snapshot.candidates[0];
    const recent = snapshot.candidates
        .filter((candidate) => candidate.lifecycle === 'released')
        .filter((candidate) => now - Date.parse(candidate.releasedAt) <= RECENT_RELEASE_WINDOW_MS)
        .sort((left, right) => Date.parse(right.releasedAt) - Date.parse(left.releasedAt));
    const forecast = snapshot.candidates.find((candidate) => candidate.kind === 'octez_release' && candidate.lifecycle === 'forecast');
    const exciting = recent.find((candidate) => candidate.excitement === 'high') || null;
    const noCredibleSignal = !snapshot.candidates.some((candidate) => (
        candidate.lifecycle !== 'no_signal' && candidate.confidence !== 'none'
    ));
    const stale = sourceState !== 'fresh' || snapshot.staleAtMs <= now;
    const releaseDetail = exciting ? `${exciting.label} shipped` : forecast?.horizon ? `${forecast.label} ${forecast.horizon}` : '';
    const detail = [main.horizon ? `${main.label} ${main.horizon}` : main.label, releaseDetail]
        .filter(Boolean)
        .join(' · ');
    return {
        id: 'release-radar',
        category: 'release',
        kind: 'state',
        score: exciting ? 176 : 166,
        title: 'Release Radar',
        shortLabel: 'Release Radar',
        icon: '◉',
        detail,
        text: main.summary,
        context: `Exact blocker: ${main.nextSignal}`,
        tone: 'release',
        visual: 'release',
        spectacle: exciting ? 'peacock' : 'headliner',
        route: main.route || '/tezosx/',
        breaking: false,
        createdAt: snapshot.updatedAtMs,
        observedAt: snapshot.updatedAtMs,
        expiresAt: snapshot.expiresAtMs,
        live: true,
        releaseRadar: {
            ...snapshot,
            stale,
            sourceState,
            noCredibleSignal,
            mainCandidateId: main.id,
            recentCandidateIds: recent.map((candidate) => candidate.id),
            excitingCandidateId: exciting?.id || ''
        }
    };
}
