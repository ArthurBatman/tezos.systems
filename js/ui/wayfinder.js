import { findSiteMapEntry, siteMapRelated, siteMapRoute } from '../core/site-map.js';

const OVERLAY_ENTRY_IDS = Object.freeze({
    'chamber-modal': 'chamber',
    'protocol-history-chamber-modal': 'anthology',
    'network-pulse-modal': 'pulse',
    'staking-chamber-modal': 'staking-chamber',
    'maxis-modal': 'maxis',
    'network-health-modal': 'health',
    'tezlink-modal': 'tezosx',
    'etherlink-governance-modal': 'l2-governance',
    'tz4-adoption-modal': 'tz4',
    'liquidity-baking-modal': 'liquidity-baking',
    'ledger-flow-modal': 'ledger-flow',
    'tezos-domains-modal': 'domains',
    'ctez-modal': 'ctez'
});

const BUILT_IN_WAYFINDER_SELECTOR = [
    '.network-pulse-category-rooms',
    '.staking-other-rooms',
    '[data-site-wayfinder-native]'
].join(', ');

let wayfinderObserver = null;
let scanQueued = false;
const pendingOverlays = new Set();

function relatedEntry(value) {
    if (typeof value === 'string') return findSiteMapEntry(value);
    if (!value || typeof value !== 'object') return null;
    return findSiteMapEntry(value.id) || value;
}

function fullInternalRoute(entry) {
    if (!entry) return '';

    const mappedRoute = String(siteMapRoute(entry) || '').trim();
    const prettyRoute = String(entry.href || '').trim();
    let route = mappedRoute;

    // Chamber switching should navigate through the full internal path. A hash
    // route can otherwise open a second modal before the first one releases its
    // focus trap and page-scroll lock.
    if (!route || route.startsWith('#')) route = prettyRoute || route;
    if (!route) return '';
    if (route.startsWith('#')) return `/${route}`;
    if (route.startsWith('/')) return route;

    try {
        const url = new URL(route, window.location.origin);
        if (url.origin !== window.location.origin && url.hostname !== 'tezos.systems') return '';
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return '';
    }
}

function semanticLinks(currentId) {
    const seen = new Set([currentId]);
    const values = siteMapRelated(currentId, 6);
    const related = Array.isArray(values) ? values : [];

    return related
        .map(relatedEntry)
        .filter((entry) => {
            if (!entry?.id || seen.has(entry.id) || !fullInternalRoute(entry)) return false;
            seen.add(entry.id);
            return true;
        })
        .slice(0, 3);
}

function createSemanticLink(entry) {
    const item = document.createElement('li');
    item.className = 'site-wayfinder-item';

    const link = document.createElement('a');
    link.className = 'site-wayfinder-link';
    link.href = fullInternalRoute(entry);
    link.dataset.siteWayfinderEntry = entry.id;

    const title = document.createElement('span');
    title.className = 'site-wayfinder-link-title';
    title.textContent = entry.title;
    link.appendChild(title);

    const detail = document.createElement('span');
    detail.className = 'site-wayfinder-link-detail';
    detail.textContent = entry.detail || entry.group || 'Open on Tezos Systems';
    link.appendChild(detail);

    item.appendChild(link);
    return item;
}

function createUtilityLink(href, label) {
    const link = document.createElement('a');
    link.className = 'site-wayfinder-action';
    link.href = href;
    link.textContent = label;
    return link;
}

function buildWayfinder(overlay, currentId, entries) {
    const nav = document.createElement('nav');
    const labelId = `site-wayfinder-label-${overlay.id}`;
    nav.className = 'site-wayfinder';
    nav.dataset.siteWayfinder = currentId;
    nav.setAttribute('aria-labelledby', labelId);

    const head = document.createElement('div');
    head.className = 'site-wayfinder-head';

    const label = document.createElement('span');
    label.id = labelId;
    label.className = 'site-wayfinder-label';
    label.textContent = 'Continue exploring';
    head.appendChild(label);
    nav.appendChild(head);

    const list = document.createElement('ul');
    list.className = 'site-wayfinder-links';
    entries.forEach((entry) => list.appendChild(createSemanticLink(entry)));
    nav.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'site-wayfinder-actions';
    actions.appendChild(createUtilityLink('/#site-map', 'View site map'));
    actions.appendChild(createUtilityLink('/#search', 'Search Tezos Systems'));
    nav.appendChild(actions);

    return nav;
}

function placementFor(overlay) {
    const footers = Array.from(overlay.querySelectorAll('.chamber-footer'));
    const footer = footers[footers.length - 1] || null;
    if (footer?.parentElement) return { footer, host: footer.parentElement };

    const host = overlay.querySelector('.chamber-body')
        || overlay.querySelector('.modal-content')
        || overlay;
    return { footer: null, host };
}

function placeWayfinder(wayfinder, placement) {
    if (placement.footer) {
        if (wayfinder.previousElementSibling !== placement.footer) {
            placement.footer.insertAdjacentElement('afterend', wayfinder);
        }
        return;
    }
    if (wayfinder.parentElement !== placement.host || wayfinder !== placement.host.lastElementChild) {
        placement.host.appendChild(wayfinder);
    }
}

function mountWayfinder(overlay) {
    if (!(overlay instanceof Element) || !overlay.classList.contains('chamber-overlay')) return;

    const currentId = OVERLAY_ENTRY_IDS[overlay.id];
    if (!currentId) return;

    const existing = overlay.querySelector('[data-site-wayfinder]');
    if (overlay.querySelector(BUILT_IN_WAYFINDER_SELECTOR)) {
        existing?.remove();
        return;
    }

    const entries = semanticLinks(currentId);
    if (!entries.length) {
        existing?.remove();
        return;
    }

    const placement = placementFor(overlay);
    if (existing?.dataset.siteWayfinder === currentId) {
        placeWayfinder(existing, placement);
        return;
    }

    existing?.remove();
    placeWayfinder(buildWayfinder(overlay, currentId, entries), placement);
}

function queueOverlay(overlay) {
    if (!overlay) return;
    pendingOverlays.add(overlay);
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
        scanQueued = false;
        const overlays = Array.from(pendingOverlays);
        pendingOverlays.clear();
        overlays.forEach((item) => {
            if (item.isConnected) mountWayfinder(item);
        });
    });
}

function queueNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('.chamber-overlay')) queueOverlay(node);
    node.querySelectorAll('.chamber-overlay').forEach(queueOverlay);
}

function observeMutation(mutation) {
    const owningOverlay = mutation.target instanceof Element
        ? mutation.target.closest('.chamber-overlay')
        : null;
    if (owningOverlay) queueOverlay(owningOverlay);
    mutation.addedNodes.forEach(queueNode);
}

function scanExistingWayfinders() {
    document.querySelectorAll('.chamber-overlay').forEach(queueOverlay);
}

export function initSiteWayfinder() {
    if (typeof document === 'undefined') return () => {};
    if (wayfinderObserver) {
        scanExistingWayfinders();
        return () => {};
    }

    const start = () => {
        scanExistingWayfinders();
        if (typeof MutationObserver === 'undefined' || !document.body) return;
        wayfinderObserver = new MutationObserver((mutations) => mutations.forEach(observeMutation));
        wayfinderObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'id']
        });
    };

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    return destroySiteWayfinder;
}

export function destroySiteWayfinder() {
    wayfinderObserver?.disconnect();
    wayfinderObserver = null;
    pendingOverlays.clear();
    scanQueued = false;
}
