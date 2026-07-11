import {
    SITE_MAP,
    SITE_MAP_NAV_GROUPS,
    findCurrentSiteMapEntry,
    findSiteMapEntry,
    siteMapGroup,
    siteMapRelated,
    siteMapRoute
} from '../core/site-map.js';

const FALLBACK_RELATED_IDS = ['pulse', 'staking-chamber', 'maxis', 'health'];
const renderedFooters = new WeakSet();
let headingSequence = 0;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function normalizePath(pathname) {
    const path = String(pathname || '/').replace(/\/index\.html$/, '/');
    return path === '/' || path.endsWith('/') ? path : `${path}/`;
}

function entryRoute(entry) {
    return siteMapRoute(entry) || entry?.href || entry?.hash || '/';
}

function contextEntry(root = document.documentElement) {
    const contextId = root?.closest?.('[data-site-context]')?.getAttribute('data-site-context')
        || root?.getAttribute?.('data-site-context')
        || document.body?.getAttribute('data-site-context');
    if (contextId) {
        const explicit = findSiteMapEntry(contextId);
        if (explicit) return explicit;
    }
    return findCurrentSiteMapEntry() || findSiteMapEntry('home') || SITE_MAP[0] || null;
}

function isActive(entry, current = contextEntry()) {
    if (!entry) return false;
    if (current?.id === entry.id) return true;
    try {
        const href = new URL(entryRoute(entry), window.location.origin);
        return normalizePath(window.location.pathname) === normalizePath(href.pathname);
    } catch {
        return false;
    }
}

function navEntryHtml(entry, current) {
    const active = isActive(entry, current);
    return `<li><a href="${escapeHtml(entryRoute(entry))}"${active ? ' class="active" aria-current="page"' : ''}>${escapeHtml(entry.title.replace(/ Guide$/, ''))}</a></li>`;
}

function renderNav() {
    const nav = document.querySelector('[data-site-nav], .landing-nav');
    if (!nav) return;
    const current = contextEntry(nav);
    const ids = ['staking', 'governance-guide', 'bakers-guide', 'anthology', 'health', 'home'];
    nav.classList.add('landing-nav');
    nav.setAttribute('data-site-nav', 'true');
    nav.innerHTML = `
        <a href="/" class="landing-nav-logo">TEZOS SYSTEMS</a>
        <ul class="landing-nav-links">
            ${ids.map((id) => findSiteMapEntry(id)).filter(Boolean).map((entry) => navEntryHtml(entry, current)).join('')}
        </ul>
    `;
}

function normalizeEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map((entry) => typeof entry === 'string' ? findSiteMapEntry(entry) : entry)
        .filter(Boolean);
}

function relatedEntries(current, limit) {
    const related = current ? normalizeEntries(siteMapRelated(current.id, limit)) : [];
    if (related.length) return related.slice(0, limit);
    return FALLBACK_RELATED_IDS
        .map((id) => findSiteMapEntry(id))
        .filter((entry) => entry && entry.id !== current?.id)
        .slice(0, limit);
}

function relatedCardHtml(entry) {
    return `
        <a class="site-map-link site-wayfinder-card" href="${escapeHtml(entryRoute(entry))}">
            <span>${escapeHtml(entry.group || 'Tezos Systems')}</span>
            <strong>${escapeHtml(entry.title)}</strong>
            <small>${escapeHtml(entry.detail || '')}</small>
            <em>Open <span aria-hidden="true">→</span></em>
        </a>
    `;
}

function renderCirculation() {
    document.querySelectorAll('[data-site-circulation]').forEach((container) => {
        const current = contextEntry(container);
        const requestedLimit = Number.parseInt(container.getAttribute('data-site-related-limit') || '4', 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 2), 6) : 4;
        const entries = relatedEntries(current, limit);
        const headingId = `site-circulation-title-${++headingSequence}`;
        container.classList.add('site-map-related', 'site-wayfinder');
        container.setAttribute('aria-labelledby', headingId);
        container.innerHTML = `
            <div class="site-map-head site-wayfinder-head">
                <div>
                    <span class="site-map-kicker">Keep exploring</span>
                    <h2 id="${headingId}">${escapeHtml(current ? `Next from ${current.title}` : 'Choose your next Tezos path')}</h2>
                </div>
                <nav class="site-map-cta site-wayfinder-actions" aria-label="Tezos Systems discovery tools">
                    <a href="/#search">Search everything</a>
                    <a href="/#site-map">Full map</a>
                </nav>
            </div>
            <div class="site-map-related-grid site-wayfinder-grid">
                ${entries.map(relatedCardHtml).join('')}
            </div>
        `;
    });
}

function footerGroupHtml(label, current) {
    const entries = siteMapGroup(label);
    if (!entries.length) return '';
    return `
        <section class="site-map-group" aria-labelledby="site-map-group-${escapeHtml(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
            <h3 id="site-map-group-${escapeHtml(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(label)}</h3>
            <div class="site-map-links">
                ${entries.map((entry) => {
                    const active = isActive(entry, current);
                    return `<a class="site-map-link${active ? ' is-active' : ''}" href="${escapeHtml(entryRoute(entry))}"${active ? ' aria-current="page"' : ''}>${escapeHtml(entry.title)}</a>`;
                }).join('')}
            </div>
        </section>
    `;
}

function defaultAttributionHtml() {
    return `
        <span>Built by <a href="https://github.com/Primate411">Primate411</a>, a co-founding member of <a href="https://tez.capital">Tez Capital</a></span>
        <span>Data from TzKT, Teztale, OBJKT, and Supabase · RPC by <a href="https://tez.capital">Tez Capital</a></span>
    `;
}

function legalAttributionHtml() {
    return '<span><a href="/feed.xml">Governance RSS</a> · <a href="https://github.com/Primate411/tezos.systems">Source</a> · <a href="/LICENSE" rel="license">MPL-2.0</a></span>';
}

function originalAttributionHtml(footer) {
    const explicit = footer.querySelector('[data-site-footer-attribution]');
    if (explicit) return explicit.innerHTML.trim();
    const raw = footer.innerHTML.trim();
    return raw && !footer.querySelector('.site-map-footer-map') ? raw : '';
}

function renderFooter() {
    document.querySelectorAll('[data-site-footer], .landing-footer').forEach((footer) => {
        if (renderedFooters.has(footer)) return;
        renderedFooters.add(footer);
        const current = contextEntry(footer);
        const attribution = originalAttributionHtml(footer) || defaultAttributionHtml();
        footer.classList.add('site-map-shell', 'site-map-footer');
        footer.setAttribute('data-site-footer', 'true');
        footer.innerHTML = `
            <div class="site-map-head">
                <div>
                    <span class="site-map-kicker">Tezos Systems</span>
                    <h2>Pick another path</h2>
                </div>
                <nav class="site-map-cta" aria-label="Tezos Systems discovery tools">
                    <a href="/#search">Search everything</a>
                    <a href="/#site-map">Full map</a>
                </nav>
            </div>
            <nav class="site-map-grid" aria-label="Complete Tezos Systems map">
                ${SITE_MAP_NAV_GROUPS.map((label) => footerGroupHtml(label, current)).join('')}
            </nav>
            <div class="site-map-footer-base" data-site-footer-attribution>${attribution}${legalAttributionHtml()}</div>
        `;
    });
}

function renderRelatedMap() {
    document.querySelectorAll('[data-site-map-group]').forEach((container) => {
        const group = container.getAttribute('data-site-map-group') || '';
        const entries = SITE_MAP.filter((entry) => !group || entry.group === group);
        container.innerHTML = entries.map((entry) => `
            <a class="landing-map-link" href="${escapeHtml(entryRoute(entry))}">
                <strong>${escapeHtml(entry.title)}</strong>
                <span>${escapeHtml(entry.detail)}</span>
            </a>
        `).join('');
    });
}

export function initSiteNav() {
    if (!SITE_MAP.length) return;
    renderNav();
    renderCirculation();
    renderFooter();
    renderRelatedMap();
}

initSiteNav();
