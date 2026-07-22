import {
    SITE_MAP,
    SITE_MAP_NAV_GROUPS,
    findSiteMapEntry,
    siteMapDirectoryChildren,
    siteMapGroup,
    siteMapRelated,
    siteMapRoute
} from './site-map.js';

export const SITE_HANDOFF_STEPS = Object.freeze([
    { id: 'now', label: 'Now', entryId: 'pulse' },
    { id: 'you', label: 'You', entryId: 'my-tezos' },
    { id: 'flow', label: 'Flow', entryId: 'ledger-flow' },
    { id: 'power', label: 'Power', entryId: 'staking-chamber' },
    { id: 'memory', label: 'Memory', entryId: 'anthology' },
    { id: 'people', label: 'People', entryId: 'maxis' }
]);

const HANDOFF_PHASES = Object.freeze({
    now: ['home', 'chambers', 'pulse', 'health', 'liquidity-baking', 'tezosx', 'tz4', 'price', 'whales', 'hot-today', 'snapshot', 'live-compare'],
    you: ['my-tezos', 'domains', 'ctez'],
    flow: ['ledger-flow'],
    power: ['staking-chamber', 'chamber', 'l2-governance', 'staking', 'governance-guide', 'bakers-guide', 'calculator', 'leaderboard'],
    memory: ['anthology', 'history', 'compare'],
    people: ['maxis', 'hen', 'feed', 'widgets']
});

let handoffSequence = 0;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function entryRoute(entry) {
    return siteMapRoute(entry) || entry?.href || entry?.hash || '/';
}

function handoffEntries() {
    return SITE_HANDOFF_STEPS
        .map((step) => ({ ...step, entry: findSiteMapEntry(step.entryId) }))
        .filter((step) => step.entry);
}

function phaseIndexForEntry(entry) {
    if (!entry) return 0;
    const phaseId = Object.entries(HANDOFF_PHASES)
        .find(([, entryIds]) => entryIds.includes(entry.id))?.[0];
    const index = SITE_HANDOFF_STEPS.findIndex((step) => step.id === phaseId);
    return index >= 0 ? index : 0;
}

function relatedEntries(current, limit = 6) {
    return (current ? siteMapRelated(current.id, limit) : [])
        .map((entry) => typeof entry === 'string' ? findSiteMapEntry(entry) : entry)
        .filter(Boolean);
}

function recommendedEntry(current, steps) {
    if (!current || current.id === 'home') return findSiteMapEntry('pulse') || steps[0]?.entry || null;
    const exactIndex = steps.findIndex((step) => step.entry.id === current.id);
    if (exactIndex >= 0) return steps[(exactIndex + 1) % steps.length]?.entry || null;
    return relatedEntries(current, 6)[0]
        || steps[(phaseIndexForEntry(current) + 1) % steps.length]?.entry
        || steps[0]?.entry
        || null;
}

function supportingEntries(current, primary) {
    const personal = primary?.id === 'my-tezos' || current?.id === 'my-tezos'
        ? findSiteMapEntry('pulse')
        : findSiteMapEntry('my-tezos');
    const candidates = [
        ...relatedEntries(current, 8),
        ...handoffEntries().map((step) => step.entry)
    ].filter((entry, index, entries) => (
        entry
        && entry.id !== current?.id
        && entry.id !== primary?.id
        && entry.id !== personal?.id
        && entries.findIndex((candidate) => candidate?.id === entry.id) === index
    ));
    return {
        personal,
        distress: candidates[0] || findSiteMapEntry('maxis') || findSiteMapEntry('health')
    };
}

function lifelineHtml(current, primary, steps) {
    const currentPhaseIndex = phaseIndexForEntry(current);
    return steps.map((step, index) => {
        const classes = [
            'site-handoff-step',
            index === currentPhaseIndex ? 'is-current-phase' : '',
            step.entry.id === primary?.id ? 'is-next' : ''
        ].filter(Boolean).join(' ');
        const currentPage = step.entry.id === current?.id;
        return `
            <a class="${classes}" href="${escapeHtml(entryRoute(step.entry))}" data-site-map-entry="${escapeHtml(step.entry.id)}"${currentPage ? ' aria-current="page"' : ''}>
                <span class="site-handoff-node" aria-hidden="true"></span>
                <strong>${escapeHtml(step.label)}</strong>
                <small>${escapeHtml(step.entry.title)}</small>
            </a>
        `;
    }).join('');
}

function directoryLinkHtml(entry, current, className = 'site-map-link') {
    const currentPage = entry?.id === current?.id;
    const type = String(entry?.href || '').endsWith('.xml') ? ' type="application/rss+xml"' : '';
    return `
        <a class="${className}${currentPage ? ' is-active' : ''}" href="${escapeHtml(entryRoute(entry))}" data-site-map-entry="${escapeHtml(entry?.id || '')}"${currentPage ? ' aria-current="page"' : ''}${type}>
            <span>${escapeHtml(entry?.title || '')}</span>
            ${entry?.fresh ? '<small>New</small>' : ''}
        </a>
    `;
}

function directoryGroupHtml(label, current, sequence) {
    const entries = siteMapGroup(label);
    if (!entries.length) return '';
    const headingId = `site-map-group-${sequence}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return `
        <section class="site-map-group" aria-labelledby="${escapeHtml(headingId)}">
            <h3 id="${escapeHtml(headingId)}">${escapeHtml(label)}</h3>
            <div class="site-map-links">
                ${entries.map((entry) => {
                    const children = siteMapDirectoryChildren(entry);
                    return `
                        <div class="site-map-link-cluster${children.length ? ' has-children' : ''}">
                            ${directoryLinkHtml(entry, current)}
                            ${children.length ? `<div class="site-map-sublinks">${children.map((child) => directoryLinkHtml(child, current, 'site-map-sublink')).join('')}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function destinationCount() {
    return SITE_MAP.reduce(
        (count, entry) => count + 1 + siteMapDirectoryChildren(entry).length,
        0
    );
}

export function renderSiteHandoff(container, {
    currentEntry = null
} = {}) {
    if (!container) return;
    const sequence = ++handoffSequence;
    const current = currentEntry || findSiteMapEntry('home') || SITE_MAP[0] || null;
    const steps = handoffEntries();
    const primary = recommendedEntry(current, steps);
    const supporting = supportingEntries(current, primary);
    const totalDestinations = destinationCount();
    const titleId = sequence === 1 ? 'site-handoff-title' : `site-handoff-title-${sequence}`;
    const mapId = sequence === 1 ? 'site-map' : `site-map-${sequence}`;
    const currentTitle = current?.title || 'this page';

    container.classList.add('site-map-shell', 'site-map-footer', 'site-handoff-shell');
    container.setAttribute('data-site-handoff', 'true');
    container.setAttribute('aria-labelledby', titleId);
    container.innerHTML = `
        <div class="site-handoff-main">
            <header class="site-handoff-head">
                <span class="site-map-kicker">The Handoff</span>
                <h2 id="${titleId}">The system continues from here.</h2>
                <p>You reached the end of ${escapeHtml(currentTitle)}. Follow one line deeper, or open the complete system map.</p>
            </header>
            <nav class="site-handoff-lifeline" aria-label="Tezos Systems lifeline">
                ${lifelineHtml(current, primary, steps)}
            </nav>
            ${primary ? `
                <section class="site-handoff-recommendation" aria-labelledby="site-handoff-next-${sequence}">
                    <div class="site-handoff-recommendation-copy">
                        <span>Next signal</span>
                        <h3 id="site-handoff-next-${sequence}">${escapeHtml(primary.title)}</h3>
                        <p>${escapeHtml(primary.detail || `Continue from ${currentTitle} into the next Tezos Systems destination.`)}</p>
                    </div>
                    <a class="site-handoff-primary" href="${escapeHtml(entryRoute(primary))}" data-site-map-entry="${escapeHtml(primary.id)}">
                        Continue <span aria-hidden="true">→</span>
                    </a>
                    <nav class="site-handoff-side-actions" aria-label="Other ways forward">
                        ${supporting.personal ? `
                            <a href="${escapeHtml(entryRoute(supporting.personal))}" data-site-map-entry="${escapeHtml(supporting.personal.id)}">
                                <span>${supporting.personal.id === 'my-tezos' ? 'Follow my wallet' : 'See the network now'}</span>
                                <small>${escapeHtml(supporting.personal.title)}</small>
                            </a>
                        ` : ''}
                        ${supporting.distress ? `
                            <a href="${escapeHtml(entryRoute(supporting.distress))}" data-site-map-entry="${escapeHtml(supporting.distress.id)}" aria-label="Choose for me: ${escapeHtml(supporting.distress.title)}">
                                <span>Choose for me</span>
                                <small>${escapeHtml(supporting.distress.title)}</small>
                            </a>
                        ` : ''}
                    </nav>
                </section>
            ` : ''}
        </div>
        <details class="site-map-disclosure" id="${mapId}">
            <summary>
                <span class="site-map-disclosure-label">Open the complete map · ${totalDestinations} destinations</span>
                <span class="site-map-disclosure-hint">Every destination, one system.</span>
            </summary>
            <nav class="site-map-grid" aria-label="Complete Tezos Systems map">
                ${SITE_MAP_NAV_GROUPS.map((label) => directoryGroupHtml(label, current, sequence)).join('')}
            </nav>
        </details>
    `;
}
