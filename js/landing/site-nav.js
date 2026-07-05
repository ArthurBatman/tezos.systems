import { SITE_MAP, SITE_MAP_NAV_GROUPS, findSiteMapEntry, siteMapGroup } from '../core/site-map.js';

function currentPath() {
    const path = window.location.pathname.replace(/\/index\.html$/, '/');
    return path.endsWith('/') ? path : `${path}/`;
}

function isActive(entry) {
    const href = new URL(entry.href, window.location.origin);
    return currentPath() === href.pathname;
}

function navEntryHtml(entry) {
    return `<li><a href="${entry.href}"${isActive(entry) ? ' class="active"' : ''}>${entry.title.replace(/ Guide$/, '')}</a></li>`;
}

function renderNav() {
    const nav = document.querySelector('[data-site-nav], .landing-nav');
    if (!nav) return;
    const ids = ['staking', 'governance-guide', 'bakers-guide', 'anthology', 'health', 'home'];
    nav.className = 'landing-nav';
    nav.setAttribute('data-site-nav', 'true');
    nav.innerHTML = `
        <a href="/" class="landing-nav-logo">TEZOS SYSTEMS</a>
        <ul class="landing-nav-links">
            ${ids.map((id) => findSiteMapEntry(id)).filter(Boolean).map(navEntryHtml).join('')}
        </ul>
    `;
}

function footerGroupHtml(label) {
    const entries = siteMapGroup(label).slice(0, label === 'Live Rooms' ? 4 : 5);
    if (!entries.length) return '';
    return `
        <div class="landing-footer-group">
            <strong>${label}</strong>
            <span>${entries.map((entry) => `<a href="${entry.href}">${entry.title}</a>`).join('')}</span>
        </div>
    `;
}

function renderFooter() {
    const footer = document.querySelector('[data-site-footer], .landing-footer');
    if (!footer) return;
    footer.className = 'landing-footer';
    footer.setAttribute('data-site-footer', 'true');
    footer.innerHTML = `
        <div class="landing-footer-map">
            ${SITE_MAP_NAV_GROUPS.map(footerGroupHtml).join('')}
        </div>
        <div class="landing-footer-base">
            <a href="https://tez.capital">Powered by Tez Capital</a>
            <span>Data from TzKT, Octez RPC, Teztale, OBJKT, and Supabase</span>
            <a href="/feed.xml">Governance RSS</a>
        </div>
    `;
}

function renderRelatedMap() {
    document.querySelectorAll('[data-site-map-group]').forEach((container) => {
        const group = container.getAttribute('data-site-map-group') || '';
        const entries = SITE_MAP.filter((entry) => !group || entry.group === group);
        container.innerHTML = entries.map((entry) => `
            <a class="landing-map-link" href="${entry.href}">
                <strong>${entry.title}</strong>
                <span>${entry.detail}</span>
            </a>
        `).join('');
    });
}

export function initSiteNav() {
    if (!SITE_MAP.length) return;
    renderNav();
    renderFooter();
    renderRelatedMap();
}

initSiteNav();
