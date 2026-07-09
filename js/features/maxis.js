/**
 * Tezos Maxis Chamber
 * One inspectable on-chain leader per declared activity lane.
 */

import { escapeHtml } from '../core/utils.js';

const MAXIS_DATA_URL = '/data/maxis-leaders.json';
const MAXIS_CSS_URL = '/css/maxis.css?v=396';
const CATEGORY_ORDER = ['transaction', 'collector', 'artist', 'minter', 'defi', 'gaming', 'governance', 'staking', 'unicorn'];
const CATEGORY_ICONS = {
    transaction: '↻',
    collector: '◈',
    artist: '✦',
    minter: '◆',
    defi: '⇄',
    gaming: '▲',
    governance: '✓',
    staking: '⬡',
    unicorn: '✺'
};

let snapshotPromise = null;
let lastSnapshot = null;
let savedBodyOverflow = null;
let savedHtmlOverflow = null;
let focusedBeforeOpen = null;

function ensureMaxisStyles() {
    if (document.getElementById('maxis-css')) return;
    const link = document.createElement('link');
    link.id = 'maxis-css';
    link.rel = 'stylesheet';
    link.href = MAXIS_CSS_URL;
    document.head.appendChild(link);
}

function validDate(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? date : null;
}

function freshness(snapshot) {
    const generatedAt = validDate(snapshot?.generatedAt);
    const staleAfterMs = Number(snapshot?.staleAfterHours || 48) * 60 * 60 * 1000;
    const stale = !generatedAt || Date.now() - generatedAt.getTime() > staleAfterMs;
    const label = generatedAt
        ? generatedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'unknown';
    return { stale, label, generatedAt };
}

function shortAddress(address) {
    const value = String(address || '');
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function leaderName(leader) {
    return leader?.alias || shortAddress(leader?.address) || 'No qualifier';
}

function sortedLeaders(snapshot) {
    const order = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
    return [...(snapshot?.leaders || [])].sort((left, right) => (
        (order.get(left.category) ?? 99) - (order.get(right.category) ?? 99)
    ));
}

async function loadSnapshot({ force = false } = {}) {
    if (lastSnapshot && !force) return lastSnapshot;
    if (snapshotPromise && !force) return snapshotPromise;
    snapshotPromise = fetch(MAXIS_DATA_URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
        .then((response) => {
            if (!response.ok) throw new Error(`Maxis snapshot returned HTTP ${response.status}`);
            return response.json();
        })
        .then((snapshot) => {
            if (Number(snapshot?.schema) !== 1 || !Array.isArray(snapshot?.leaders)) {
                throw new Error('Maxis snapshot schema is not supported');
            }
            lastSnapshot = snapshot;
            updateEntryCard(snapshot);
            return snapshot;
        })
        .finally(() => { snapshotPromise = null; });
    return snapshotPromise;
}

function leaderActions(leader) {
    if (!leader?.address) return '';
    const address = encodeURIComponent(leader.address);
    return `
        <div class="maxis-card-actions">
            <a class="maxis-action maxis-ledger-action" href="/#ledger-flow=${address}" aria-label="Trace ${escapeHtml(leaderName(leader))} in Ledger Flow">Trace in Ledger Flow</a>
            <a class="maxis-action" href="/#my-baker=${address}" aria-label="Open ${escapeHtml(leaderName(leader))} in My Tezos">My Tezos</a>
            ${leader.sourceUrl ? `<a class="maxis-source-action" href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
        </div>
    `;
}

function renderLeaderCard(leader, { featured = false } = {}) {
    const ready = leader?.status === 'ready' && leader.address;
    const icon = CATEGORY_ICONS[leader?.category] || '•';
    if (!ready) {
        return `
            <article class="maxis-card maxis-card-empty" data-maxi-category="${escapeHtml(leader?.category || '')}">
                <div class="maxis-card-top"><span class="maxis-card-icon" aria-hidden="true">${icon}</span><span class="maxis-card-kicker">${escapeHtml(leader?.title || 'Maxi')}</span></div>
                <h3>No qualifying leader</h3>
                <p>${escapeHtml(leader?.method || 'No trustworthy result was available for this snapshot.')}</p>
            </article>
        `;
    }

    return `
        <article class="maxis-card${featured ? ' maxis-card-featured' : ''}" data-maxi-category="${escapeHtml(leader.category)}">
            <div class="maxis-card-top">
                <span class="maxis-card-icon" aria-hidden="true">${icon}</span>
                <span class="maxis-card-kicker">${escapeHtml(leader.title)}</span>
                <span class="maxis-card-window">${escapeHtml(windowLabel(leader.windowKind))}</span>
            </div>
            <div class="maxis-card-identity">
                <h3>${escapeHtml(leaderName(leader))}</h3>
                <code title="${escapeHtml(leader.address)}">${escapeHtml(shortAddress(leader.address))}</code>
            </div>
            <strong class="maxis-card-score">${escapeHtml(leader.scoreLabel || 'Leader')}</strong>
            <div class="maxis-card-context">
                ${(leader.context || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
            ${leaderActions(leader)}
            <p class="maxis-card-method">${escapeHtml(leader.method || '')}</p>
        </article>
    `;
}

function windowLabel(kind) {
    const labels = {
        'rolling-30d': '30d',
        'all-time': 'all time',
        'all-time-active': 'all time · active',
        live: 'live',
        mixed: 'cross-lane'
    };
    return labels[kind] || 'snapshot';
}

function renderMethodology(snapshot) {
    const coverage = snapshot.coverage || {};
    const defi = coverage.byCategory?.defi || {};
    const gaming = coverage.byCategory?.gaming || {};
    return `
        <details class="maxis-methodology">
            <summary>How “maxi” is measured</summary>
            <div class="maxis-methodology-body">
                <p>Each card has its own declared metric. Recent activity uses the rolling ${escapeHtml(String(snapshot.window?.days || 30))}-day window; governance counters are all-time among active bakers; staking is live. Ties resolve by the secondary score, recent activity, then address.</p>
                <p>${escapeHtml(coverage.caveat || '')}</p>
                <div class="maxis-methodology-facts">
                    <span><strong>${escapeHtml(String(coverage.recognizedApps || 0))}</strong> recognized apps</span>
                    <span><strong>${escapeHtml(String(coverage.recognizedContracts || 0))}</strong> active contracts</span>
                    <span><strong>${escapeHtml(String(defi.contracts || 0))}</strong> DeFi contracts</span>
                    <span><strong>${escapeHtml(String(gaming.contracts || 0))}</strong> gaming contracts</span>
                </div>
                <p class="maxis-methodology-note">This is an activity board, not a reputation or endorsement system. Service accounts and automated users can win objective activity metrics.</p>
            </div>
        </details>
    `;
}

function renderChamber(snapshot) {
    const leaders = sortedLeaders(snapshot);
    const unicorn = leaders.find((leader) => leader.category === 'unicorn');
    const rest = leaders.filter((leader) => leader.category !== 'unicorn');
    const state = freshness(snapshot);
    const readyCount = leaders.filter((leader) => leader.status === 'ready').length;
    return `
        <header class="maxis-hero chamber-anim-fade">
            <div class="maxis-system-strip"><span>TEZOS.SYSTEMS</span><span>SPOT THE MAXIS</span><span>TZKT + OBJKT SNAPSHOT</span></div>
            <div class="chamber-title-row">
                <h2 id="maxis-title" class="chamber-title">Tezos Maxis</h2>
                <span class="chamber-badge maxis-freshness-badge ${state.stale ? 'stale' : 'live'}">${state.stale ? 'stale snapshot' : 'fresh snapshot'}</span>
            </div>
            <p class="maxis-hero-lead">Art, DeFi, gaming, transactions, governance, staking—and the rare wallet crossing lanes. Every crown comes with a metric and a trail.</p>
            <div class="maxis-hero-meta" aria-label="Maxis snapshot status">
                <span><strong>${readyCount}</strong> category leaders</span>
                <span><strong>${escapeHtml(String(snapshot.window?.days || 30))}d</strong> activity window</span>
                <span><strong>${escapeHtml(String(snapshot.coverage?.recognizedApps || 0))}</strong> recognized apps</span>
                <span><strong>${escapeHtml(state.label)}</strong> generated</span>
            </div>
        </header>

        <section class="maxis-unicorn chamber-anim-fade" aria-label="Featured Tezos Unicorn">
            ${renderLeaderCard(unicorn || { category: 'unicorn', title: 'Tezos Unicorn', status: 'empty' }, { featured: true })}
        </section>

        <section class="maxis-grid chamber-anim-fade" aria-label="Tezos maxi category leaders">
            ${rest.map((leader) => renderLeaderCard(leader)).join('')}
        </section>

        ${renderMethodology(snapshot)}

        <footer class="chamber-footer maxis-footer">
            <span>Sources: TzKT + OBJKT API v3</span>
            <span class="chamber-footer-sep">·</span>
            <span>${escapeHtml(state.stale ? 'Previous valid snapshot shown' : 'Generated snapshot')}</span>
            <span class="chamber-footer-sep">·</span>
            <a class="panel-direct-link" href="/maxis/">Direct: /maxis/</a>
        </footer>
    `;
}

function entryLeaderCell(leader) {
    const ready = leader?.status === 'ready';
    return `
        <div class="maxis-entry-leader" data-maxi-category="${escapeHtml(leader?.category || '')}">
            <span class="maxis-entry-icon" aria-hidden="true">${CATEGORY_ICONS[leader?.category] || '•'}</span>
            <span class="maxis-entry-lane">${escapeHtml((leader?.title || 'Maxi').replace(' Maxi', ''))}</span>
            <strong title="${ready ? escapeHtml(leaderName(leader)) : 'No qualifier'}">${ready ? escapeHtml(leaderName(leader)) : 'No qualifier'}</strong>
            <small>${ready ? escapeHtml(leader.scoreLabel || '') : escapeHtml(windowLabel(leader?.windowKind))}</small>
        </div>
    `;
}

function renderEntryContents(snapshot) {
    const leaders = sortedLeaders(snapshot);
    const unicorn = leaders.find((leader) => leader.category === 'unicorn');
    return `
        <div class="maxis-entry-head">
            <div>
                <h2 class="stat-label">Tezos Maxis</h2>
                <div class="maxis-entry-value">Spot the maxis</div>
                <p class="stat-description">One inspectable leader per Tezos activity lane.</p>
            </div>
            <div class="maxis-entry-unicorn">
                <span>Current unicorn</span>
                <strong>${escapeHtml(leaderName(unicorn))}</strong>
                <small>${escapeHtml(unicorn?.scoreLabel || 'No three-lane qualifier')}</small>
            </div>
        </div>
        <div class="maxis-entry-grid" aria-label="Current Tezos maxi leaders">
            ${leaders.map(entryLeaderCell).join('')}
        </div>
    `;
}

function updateEntryCard(snapshot) {
    const card = document.getElementById('maxis-entry-card');
    if (!card) return;
    const front = card.querySelector('.maxis-entry-front');
    if (front) front.innerHTML = renderEntryContents(snapshot);
    const state = freshness(snapshot);
    card.dataset.updatedLabel = `${state.stale ? 'Stale' : 'Maxis'} snapshot · ${state.label}`;
    card.classList.toggle('chamber-data-stale', state.stale);
    window.syncChamberEntryFooters?.(card);
}

function ensureEntryCard() {
    const grid = document.getElementById('chambers-grid');
    if (!grid) return null;
    let card = document.getElementById('maxis-entry-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'maxis-entry-card';
        card.className = 'stat-card chamber-entry-card chamber-entry-wide maxis-entry-card chamber-entry-adoption';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open Tezos Maxis Chamber');
        card.dataset.updatedLabel = 'Loading maxis snapshot';
        card.innerHTML = `
            <button class="card-copy-link" type="button" data-copy-hash="#maxis" aria-label="Copy Tezos Maxis direct link" title="Copy Tezos Maxis link">🔗</button>
            <div class="card-inner">
                <div class="card-front maxis-entry-front">
                    <h2 class="stat-label">Tezos Maxis</h2>
                    <div class="maxis-entry-loading">Scanning the lanes…</div>
                </div>
                <div class="card-back" aria-hidden="true">
                    <h2 class="stat-label">Tezos Maxis</h2>
                    <div class="stat-value">9 lanes</div>
                    <p class="stat-description">Open the activity leaderboard.</p>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }

    if (!card.dataset.maxisWired) {
        const open = (event) => {
            if (event?.target?.closest?.('button, a, .card-tooltip')) return;
            openMaxisChamber();
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open(event);
        });
        card.dataset.maxisWired = '1';
    }
    return card;
}

function getFocusable(root) {
    return [...root.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0);
}

function handleKeydown(event) {
    const overlay = document.getElementById('maxis-modal');
    if (!overlay?.classList.contains('active')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeMaxisChamber();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(overlay);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    }
}

function renderError(body, error) {
    body.innerHTML = `
        <div class="chamber-error maxis-error">
            <div class="chamber-error-icon">✺</div>
            <h3>The maxis snapshot is off-chain</h3>
            <p>${escapeHtml(error?.message || 'The generated ranking file did not answer.')}</p>
            <button class="chamber-retry-btn" id="maxis-retry" type="button">Retry</button>
        </div>
    `;
    body.querySelector('#maxis-retry')?.addEventListener('click', () => refreshChamber({ force: true }));
}

async function refreshChamber({ force = false } = {}) {
    const overlay = document.getElementById('maxis-modal');
    const body = overlay?.querySelector('.maxis-body');
    if (!overlay?.classList.contains('active') || !body) return;
    body.innerHTML = `
        <div class="chamber-loading">
            <div class="chamber-loading-text">Spotting the maxis…</div>
            <div class="chamber-loading-bar"><div class="chamber-loading-fill"></div></div>
            <div class="chamber-loading-subtext">Reading the last valid TzKT + OBJKT ranking snapshot.</div>
        </div>
    `;
    try {
        const snapshot = await loadSnapshot({ force });
        body.innerHTML = renderChamber(snapshot);
        overlay.querySelector('.maxis-content')?.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
        console.warn('Tezos Maxis chamber refresh failed', error);
        renderError(body, error);
    }
}

export async function openMaxisChamber() {
    ensureMaxisStyles();
    let overlay = document.getElementById('maxis-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'maxis-modal';
        overlay.className = 'modal-overlay chamber-overlay maxis-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="modal-content modal-large chamber-content maxis-content" role="dialog" aria-modal="true" aria-labelledby="maxis-title" tabindex="-1">
                <button class="modal-close chamber-close" type="button" aria-label="Close Tezos Maxis Chamber">&times;</button>
                <div class="chamber-body maxis-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.chamber-close')?.addEventListener('click', closeMaxisChamber);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeMaxisChamber();
        });
    }

    if (overlay.classList.contains('active')) return;
    focusedBeforeOpen = document.activeElement;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', handleKeydown, true);
    requestAnimationFrame(() => overlay.querySelector('.chamber-close')?.focus({ preventScroll: true }));
    await refreshChamber({ force: true });
}

export function closeMaxisChamber() {
    document.removeEventListener('keydown', handleKeydown, true);
    const overlay = document.getElementById('maxis-modal');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = savedBodyOverflow || '';
    document.documentElement.style.overflow = savedHtmlOverflow || '';
    if (focusedBeforeOpen && document.contains(focusedBeforeOpen)) {
        const target = focusedBeforeOpen;
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
    focusedBeforeOpen = null;
}

export function initMaxisChamber() {
    ensureMaxisStyles();
    ensureEntryCard();
    window.openMaxisChamber = openMaxisChamber;
    loadSnapshot().catch((error) => {
        console.debug('Tezos Maxis entry snapshot unavailable', error);
        const card = document.getElementById('maxis-entry-card');
        if (card) {
            card.dataset.updatedLabel = 'Maxis snapshot unavailable';
            card.classList.add('chamber-data-stale');
            window.syncChamberEntryFooters?.(card);
        }
    });
}
