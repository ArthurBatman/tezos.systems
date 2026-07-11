/**
 * Hero Search / Command Bar
 * Turns the protocol header into a front door for native Tezos.Systems rooms.
 */

import { debounce, escapeHtml } from '../core/utils.js';
import {
    searchSiteMap,
    siteMapRoute,
    siteMapSearchChips,
    siteMapStarters
} from '../core/site-map.js';
import { getAvailableThemes, openThemePicker, setTheme } from '../ui/theme.js';
import { findBakersByName } from './leaderboard.js';
import { getTopHotSignal } from './daily-briefing.js';

const PROTOCOL_DATA_URL = '/data/protocol-data.json?v=2';
const HERO_SEARCH_CSS_URL = '/css/hero-search.css?v=419';

const ADDRESS_RE = /^(tz[1-4]|KT1)[0-9A-Za-z]{33}$/;
const TEZ_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+tez$/i;
const OPERATION_RE = /^o[0-9A-Za-z]{50}$/;
const BLOCK_HASH_RE = /^B[0-9A-Za-z]{50}$/;
const BLOCK_LEVEL_RE = /^\d{4,}$/;

const RUNTIME_QUICK_CHIPS = [
    { label: 'KT1', value: 'KT1' },
    { label: '/theme', value: '/theme' }
];

function livePulseChip() {
    const signal = getTopHotSignal();
    if (!signal?.route) return null;
    const label = String(signal.title || signal.routeLabel || 'Live pulse').replace(/\s+/g, ' ').trim();
    return {
        label: `Live: ${label}`.slice(0, 24),
        route: signal.route
    };
}

const RUNTIME_COMMANDS = [
    { id: 'theme', title: '/theme', detail: 'Switch visual theme', action: 'theme-picker', aliases: ['theme', 'themes', 'switch theme'] }
];

const SITE_MAP_BUTTON_TARGETS = new Map([
    ['my-tezos', 'my-tezos-btn'],
    ['snapshot', 'state-of-tezos-btn']
]);

const RUNTIME_STARTER_ROWS = [
    {
        kind: 'contract',
        group: 'Contracts & Operations',
        title: 'KT1 Contracts',
        detail: 'Paste a full KT1 address for a native contract lens',
        badge: 'contract',
        action: 'hash',
        value: '#section=ecosystem'
    },
    {
        kind: 'block',
        group: 'Contracts & Operations',
        title: 'Blocks & Operations',
        detail: 'Paste a level, block hash, or operation hash for a native receipt',
        badge: 'block',
        action: 'hash',
        value: '#health'
    }
];

let protocols = [];
let protocolsPromise = null;
const bakerSearchCache = new Map();
const bakerSearchInFlight = new Map();

const STARTER_QUERY_RESULTS = new Map([
    ['kt1', 'KT1 Contracts'],
    ['contract', 'KT1 Contracts'],
    ['contracts', 'KT1 Contracts'],
    ['operation', 'Blocks & Operations'],
    ['operations', 'Blocks & Operations'],
    ['op', 'Blocks & Operations'],
    ['ops', 'Blocks & Operations'],
    ['op hash', 'Blocks & Operations'],
    ['operation hash', 'Blocks & Operations'],
    ['block', 'Blocks & Operations'],
    ['blocks', 'Blocks & Operations'],
    ['block hash', 'Blocks & Operations'],
    ['block level', 'Blocks & Operations']
]);

function ensureHeroSearchStyles() {
    if (document.getElementById('hero-search-css')) return;
    const link = document.createElement('link');
    link.id = 'hero-search-css';
    link.rel = 'stylesheet';
    link.href = HERO_SEARCH_CSS_URL;
    document.head.appendChild(link);
}

function normalizeQuery(value) {
    return String(value || '').trim();
}

function searchText(result) {
    return [
        result.title,
        result.detail,
        result.group,
        result.kind,
        ...(result.aliases || [])
    ].join(' ').toLowerCase();
}

function matchesQuery(result, query) {
    const q = query.toLowerCase();
    if (!q) return true;
    const bare = q.replace(/^\//, '');
    return searchText(result).includes(q) || searchText(result).includes(bare);
}

function bakerSearchKey(query) {
    return normalizeQuery(query).toLowerCase().replace(/\s+/g, ' ');
}

function shouldSearchBakers(query) {
    const q = normalizeQuery(query);
    if (q.length < 2 || q.startsWith('/')) return false;
    if (ADDRESS_RE.test(q) || TEZ_DOMAIN_RE.test(q) || OPERATION_RE.test(q) || BLOCK_HASH_RE.test(q) || BLOCK_LEVEL_RE.test(q)) return false;
    if (specializedMaxisResults(q).length || searchSiteMap(q).length) return false;
    if (RUNTIME_COMMANDS.some((command) => matchesQuery(commandResult(command), q))) return false;
    if (protocols.some((protocol) => matchesQuery(protocolResult(protocol), q))) return false;
    return true;
}

function monthYear(date) {
    if (!date) return '';
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) return date;
    return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function loadProtocols() {
    if (protocols.length) return protocols;
    if (!protocolsPromise) {
        protocolsPromise = fetch(PROTOCOL_DATA_URL, { cache: 'no-store' })
            .then((resp) => resp.ok ? resp.json() : null)
            .then((data) => {
                protocols = Array.isArray(data?.protocols) ? data.protocols : [];
                return protocols;
            })
            .catch(() => {
                protocols = [];
                return protocols;
            });
    }
    return protocolsPromise;
}

function protocolResult(protocol) {
    const tags = [
        protocol.number ? `Protocol ${protocol.number}` : '',
        monthYear(protocol.date),
        protocol.blockTime ? `${protocol.blockTime}s blocks` : ''
    ].filter(Boolean).join(' · ');
    const change = Array.isArray(protocol.changes) ? protocol.changes[0] : '';
    return {
        kind: 'protocol',
        group: 'Protocol History',
        title: protocol.name,
        detail: [tags, protocol.headline || change].filter(Boolean).join(' — '),
        badge: protocol.history ? 'history' : 'protocol',
        action: 'protocol',
        value: protocol.name,
        aliases: [
            protocol.hash,
            protocol.headline,
            protocol.debate,
            ...(protocol.changes || []),
            protocol.history?.title,
            protocol.history?.subtitle
        ].filter(Boolean)
    };
}

function commandResult(command) {
    return {
        kind: 'command',
        group: 'Commands',
        title: command.title,
        detail: command.detail,
        badge: 'command',
        action: command.action || (command.id === 'theme' ? 'theme-picker' : 'hash'),
        value: command.value || command.hash,
        aliases: command.aliases
    };
}

function siteMapResult(entry, { starter = false } = {}) {
    const rootHashEntry = entry.hash && (entry.href === '/' || entry.href.startsWith('/#'));
    const buttonTarget = SITE_MAP_BUTTON_TARGETS.get(entry.id);
    const route = siteMapRoute(entry);
    return {
        kind: entry.group === 'Guides' ? 'guide' : entry.group === 'Story Rooms' ? 'story' : 'page',
        group: starter ? 'Start here' : 'Pages on tezos.systems',
        title: entry.title,
        detail: entry.detail,
        badge: entry.group,
        action: buttonTarget ? 'button' : rootHashEntry ? 'hash' : 'page',
        value: buttonTarget || (rootHashEntry ? entry.hash : route),
        aliases: entry.keywords
    };
}

function maxisViewResult(view) {
    const copy = {
        season: {
            title: 'Tezos Maxis Season',
            detail: 'Open the current protocol-season race, moving ranks, cut lines, and honors',
            badge: 'season'
        },
        passport: {
            title: 'Maxi Passport',
            detail: 'Open address-bound career stamps and current protocol-season progress',
            badge: 'passport'
        },
        champions: {
            title: 'Tezos Maxis Champions',
            detail: 'Open permanent finalized protocol-season winners and frozen receipts',
            badge: 'champions'
        }
    }[view];
    return {
        kind: 'page',
        group: 'Tezos Maxis',
        title: copy.title,
        detail: copy.detail,
        badge: copy.badge,
        action: 'page',
        value: `/maxis/?view=${view}`,
        aliases: ['tezos maxis', 'maxis', view]
    };
}

function specializedMaxisResults(query) {
    const q = normalizeQuery(query).toLowerCase().replace(/^\//, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (!q) return [];
    if (/\bpassport\b/.test(q)) return [maxisViewResult('passport')];
    if (/\bchampions?\b/.test(q)) return [maxisViewResult('champions')];
    if (/\bseason\b/.test(q)) return [maxisViewResult('season')];
    return [];
}

function maxiPassportEntityResult(target, group = 'Maxis & Identity') {
    return {
        kind: 'page',
        group,
        title: `Open ${target} in Maxi Passport`,
        detail: 'Resolve one address into career stamps, ongoing crowns, and current-season progress',
        badge: 'passport',
        action: 'page',
        value: `/maxis/?view=passport&address=${encodeURIComponent(target)}`
    };
}

function bakerResult(baker) {
    const stake = Number(baker.stake || 0);
    const stakeText = Number.isFinite(stake) && stake > 0
        ? `${stake.toLocaleString('en-US', { maximumFractionDigits: stake >= 1000 ? 0 : 1 })} XTZ staking power`
        : 'Active baker';
    const delegators = Number(baker.delegators || 0);
    const detail = [
        baker.address,
        stakeText,
        delegators ? `${delegators.toLocaleString('en-US')} delegators` : ''
    ].filter(Boolean).join(' · ');
    return {
        kind: 'baker',
        group: 'Bakers & Accounts',
        title: baker.name || baker.alias || baker.address,
        detail,
        badge: 'baker',
        action: 'hash',
        value: `#baker=${encodeURIComponent(baker.address)}`,
        aliases: [baker.alias, baker.address, baker.consensusAddress].filter(Boolean)
    };
}

function cachedBakerResults(query) {
    const key = bakerSearchKey(query);
    const matches = bakerSearchCache.get(key);
    if (!Array.isArray(matches) || !matches.length) return [];
    return matches.map(bakerResult);
}

function bakerLoadingResult(query) {
    return {
        kind: 'baker',
        group: 'Bakers & Accounts',
        title: `Searching bakers for "${query}"`,
        detail: 'Checking the active leaderboard by baker alias and address',
        badge: 'baker',
        action: 'hash',
        value: '#leaderboard',
        aliases: ['baker search', 'leaderboard', query]
    };
}

function entityResults(query) {
    const q = normalizeQuery(query);
    if (!q) return [];

    if (ADDRESS_RE.test(q)) {
        if (q.startsWith('KT1')) {
            return [
                {
                    kind: 'contract',
                    group: 'Contract actions',
                    title: 'Inspect KT1 contract',
                    detail: `${q} · native balance, activity, and account-flow view`,
                    badge: 'contract',
                    action: 'hash',
                    value: `#contract=${encodeURIComponent(q)}`
                },
                {
                    kind: 'chamber',
                    group: 'Contract actions',
                    title: 'Open in Ledger Flow',
                    detail: 'Map sent, received, and first-funding transfer paths',
                    badge: 'flow',
                    action: 'hash',
                    value: `#ledger-flow=${encodeURIComponent(q)}`
                }
            ];
        }
        return [
            {
                kind: 'account',
                group: 'Account actions',
                title: 'Inspect account',
                detail: `${q} · native balance, identity, and recent flow`,
                badge: 'account',
                action: 'hash',
                value: `#account=${encodeURIComponent(q)}`
            },
            {
                kind: 'account',
                group: 'Account actions',
                title: 'Track as My Tezos',
                detail: `${q} · save this as your My Tezos account`,
                badge: 'account',
                action: 'hash',
                value: `#my-baker=${encodeURIComponent(q)}`
            },
            maxiPassportEntityResult(q, 'Account actions'),
            {
                kind: 'chamber',
                group: 'Account actions',
                title: 'Open in Ledger Flow',
                detail: 'Map sent, received, and first-funding transfer paths',
                badge: 'flow',
                action: 'hash',
                value: `#ledger-flow=${encodeURIComponent(q)}`
            },
            {
                kind: 'baker',
                group: 'Account actions',
                title: 'Try as baker profile',
                detail: 'If this address bakes, open its operator drawer',
                badge: 'baker',
                action: 'hash',
                value: `#baker=${encodeURIComponent(q)}`
            }
        ];
    }

    if (TEZ_DOMAIN_RE.test(q)) {
        const domain = q.toLowerCase();
        return [
            {
                kind: 'chamber',
                group: 'Domain actions',
                title: `Check ${domain} in Tezos Domains`,
                detail: 'Lookup availability, owner, offers, auctions, and recent name activity',
                badge: '.tez',
                action: 'hash',
                value: `#domains=${encodeURIComponent(domain)}`
            },
            maxiPassportEntityResult(domain, 'Domain actions'),
            {
                kind: 'account',
                group: 'Domain actions',
                title: `Track ${domain} as My Tezos`,
                detail: 'Resolve Tezos Domains name and make it easy to change later',
                badge: '.tez',
                action: 'hash',
                value: `#my-baker=${encodeURIComponent(domain)}`
            },
            {
                kind: 'chamber',
                group: 'Domain actions',
                title: `Open ${domain} in Ledger Flow`,
                detail: 'Resolve this Tezos Domains name and map account transfers',
                badge: 'flow',
                action: 'hash',
                value: `#ledger-flow=${encodeURIComponent(domain)}`
            },
            {
                kind: 'baker',
                group: 'Domain actions',
                title: `Try ${domain} as baker`,
                detail: 'Resolve domain and open baker profile if active',
                badge: 'baker',
                action: 'hash',
                value: `#baker=${encodeURIComponent(domain)}`
            }
        ];
    }

    if (OPERATION_RE.test(q)) {
        return [{
            kind: 'operation',
            group: 'Operations & Blocks',
            title: q,
            detail: 'Open native operation contents and status',
            badge: 'operation',
            action: 'hash',
            value: `#operation=${encodeURIComponent(q)}`
        }];
    }

    if (BLOCK_HASH_RE.test(q)) {
        return [{
            kind: 'block',
            group: 'Operations & Blocks',
            title: q,
            detail: 'Open native block receipt and producer view',
            badge: 'block',
            action: 'hash',
            value: `#block=${encodeURIComponent(q)}`
        }];
    }

    if (BLOCK_LEVEL_RE.test(q)) {
        return [{
            kind: 'block',
            group: 'Operations & Blocks',
            title: `Block #${Number(q).toLocaleString('en-US')}`,
            detail: 'Open native block receipt and producer view',
            badge: 'block',
            action: 'hash',
            value: `#block=${encodeURIComponent(q)}`
        }];
    }

    return [];
}

function starterResults(query) {
    const key = normalizeQuery(query).toLowerCase().replace(/\s+/g, ' ');
    const title = STARTER_QUERY_RESULTS.get(key);
    if (!title) return [];
    const result = RUNTIME_STARTER_ROWS.find((row) => row.title === title);
    return result ? [result] : [];
}

function textFallbackResults(query) {
    const q = normalizeQuery(query);
    if (!q || q.startsWith('/') || q.length < 2) return [];
    if (ADDRESS_RE.test(q) || TEZ_DOMAIN_RE.test(q) || OPERATION_RE.test(q) || BLOCK_HASH_RE.test(q) || BLOCK_LEVEL_RE.test(q)) return [];
    return [{
        kind: 'baker',
        group: 'Bakers & Accounts',
        title: `Search bakers for "${q}"`,
        detail: 'Open the leaderboard, then choose a baker profile or paste its address back here',
        badge: 'baker',
        action: 'hash',
        value: '#leaderboard',
        aliases: ['baker search', 'leaderboard', q]
    }];
}

function themeResults(query) {
    const q = normalizeQuery(query).toLowerCase();
    if (!q.startsWith('/theme')) return [];
    const [, requested = ''] = q.split(/\s+/);
    if (!requested) {
        return [{
            kind: 'command',
            group: 'Commands',
            title: '/theme',
            detail: 'Open the theme selector',
            badge: 'command',
            action: 'theme-picker'
        }];
    }

    return getAvailableThemes()
        .filter((theme) => theme.startsWith(requested))
        .slice(0, 5)
        .map((theme) => ({
            kind: 'command',
            group: 'Commands',
            title: `/theme ${theme}`,
            detail: `Switch to ${theme}`,
            badge: 'command',
            action: 'theme',
            value: theme
        }));
}

function dedupeResults(results) {
    const seen = new Set();
    return results.filter((result) => {
        const key = `${result.action || result.kind}:${result.value || result.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildResults(query) {
    const q = normalizeQuery(query);
    const bakerMatches = cachedBakerResults(q);
    const bakerLoading = shouldSearchBakers(q) && !bakerSearchCache.has(bakerSearchKey(q)) && bakerSearchInFlight.has(bakerSearchKey(q))
        ? [bakerLoadingResult(q)]
        : [];
    const protocolMatches = (q.startsWith('/') ? [] : protocols)
        .slice()
        .reverse()
        .map(protocolResult)
        .filter((result) => matchesQuery(result, q));
    const commandMatches = RUNTIME_COMMANDS.map(commandResult).filter((result) => matchesQuery(result, q));
    const siteMapMatches = searchSiteMap(q).map(siteMapResult);
    const entityMatches = entityResults(q);
    const themeMatches = themeResults(q);
    const starterMatches = starterResults(q);
    const maxisMatches = specializedMaxisResults(q);

    if (!q) {
        return dedupeResults([
            ...siteMapStarters().map((entry) => siteMapResult(entry, { starter: true })),
            ...RUNTIME_STARTER_ROWS,
            commandResult(RUNTIME_COMMANDS.find((command) => command.id === 'theme'))
        ].filter(Boolean));
    }

    const directMatches = [
        ...entityMatches,
        ...themeMatches,
        ...starterMatches,
        ...maxisMatches,
        ...siteMapMatches.slice(0, 8),
        ...protocolMatches.slice(0, 5),
        ...commandMatches.slice(0, 4),
        ...bakerMatches,
        ...bakerLoading
    ];

    return dedupeResults([
        ...directMatches,
        ...(directMatches.length ? [] : textFallbackResults(q))
    ]);
}

function groupedResults(results) {
    const groups = [];
    for (const result of results) {
        let group = groups.find((item) => item.label === result.group);
        if (!group) {
            group = { label: result.group, results: [] };
            groups.push(group);
        }
        group.results.push(result);
    }
    return groups;
}

function groupOrderedResults(results) {
    return groupedResults(results).flatMap((group) => group.results);
}

function resultHtml(result, index, selectedIndex) {
    const isExternal = result.action === 'external';
    const selected = index === selectedIndex;
    return `
        <button
            class="hero-search-result ${selected ? 'is-selected' : ''}"
            id="hero-search-option-${index}"
            type="button"
            role="option"
            aria-selected="${selected ? 'true' : 'false'}"
            data-result-index="${index}"
        >
            <span class="hero-result-mark" data-kind="${escapeHtml(result.kind)}" aria-hidden="true"></span>
            <span class="hero-result-copy">
                <strong>${escapeHtml(result.title)}</strong>
                <span>${escapeHtml(result.detail || '')}</span>
            </span>
            <span class="hero-result-badge" data-kind="${escapeHtml(result.badge || result.kind)}">${escapeHtml(result.badge || result.kind)}</span>
            ${isExternal ? '<span class="hero-result-external" aria-hidden="true">↗</span>' : ''}
        </button>
    `;
}

function navigateHash(hash) {
    if (!hash) return;
    const next = hash.startsWith('#') ? hash : `#${hash}`;
    if (window.location.hash === next) {
        window.dispatchEvent(new Event('hashchange'));
    } else {
        window.location.hash = next;
    }
}

function openThemeSelector() {
    const button = document.getElementById('theme-toggle');
    if (button) {
        button.click();
        return;
    }
    openThemePicker();
}

function runResult(result) {
    if (!result) return false;
    if (result.action === 'external') {
        window.open(result.value, '_blank', 'noopener,noreferrer');
        return true;
    }
    if (result.action === 'hash') {
        navigateHash(result.value);
        return true;
    }
    if (result.action === 'page') {
        window.location.href = result.value;
        return true;
    }
    if (result.action === 'button') {
        const button = document.getElementById(result.value);
        if (!button) return false;
        button.click();
        return true;
    }
    if (result.action === 'protocol') {
        navigateHash(`#protocol=${encodeURIComponent(result.value)}`);
        return true;
    }
    if (result.action === 'theme') {
        setTheme(result.value);
        localStorage.setItem('tezos-systems-theme', result.value);
        return true;
    }
    if (result.action === 'theme-picker') {
        openThemeSelector();
        return true;
    }
    return false;
}

function runRoute(route) {
    if (!route) return false;
    if (route.startsWith('#')) {
        navigateHash(route);
        return true;
    }
    window.location.href = route;
    return true;
}

function isTextEntryTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
}

export function initHeroSearch() {
    const root = document.getElementById('hero-slot');
    const form = document.getElementById('hero-search-form');
    const input = document.getElementById('hero-search-input');
    const panel = document.getElementById('hero-search-panel');
    const chips = document.getElementById('hero-search-chips');
    if (!root || !form || !input || !panel || !chips) return;
    ensureHeroSearchStyles();

    let isOpen = false;
    let selectedIndex = -1;
    let results = [];

    const renderQuickChips = () => {
        const liveChip = livePulseChip();
        const chipList = [
            ...(liveChip ? [liveChip] : []),
            ...siteMapSearchChips(),
            ...RUNTIME_QUICK_CHIPS
        ];
        chips.innerHTML = chipList.map((chip) => {
            const attr = chip.route
                ? `data-hero-route="${escapeHtml(chip.route)}"`
                : `data-hero-query="${escapeHtml(chip.value)}"`;
            const entryAttr = chip.id ? ` data-hero-entry="${escapeHtml(chip.id)}"` : '';
            return `<button class="hero-search-chip" type="button" ${attr}${entryAttr}>${escapeHtml(chip.label)}</button>`;
        }).join('');
    };

    renderQuickChips();
    window.addEventListener('hot-signal-rendered', renderQuickChips);

    const setOpen = (next) => {
        isOpen = Boolean(next);
        root.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('hero-search-mode', isOpen);
        panel.hidden = !isOpen;
        input.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (!isOpen) {
            selectedIndex = -1;
            input.setAttribute('aria-activedescendant', '');
        }
    };

    const syncActiveDescendant = () => {
        if (selectedIndex >= 0) {
            input.setAttribute('aria-activedescendant', `hero-search-option-${selectedIndex}`);
        } else {
            input.setAttribute('aria-activedescendant', '');
        }
    };

    const queueBakerLookup = (value) => {
        const q = normalizeQuery(value);
        if (!shouldSearchBakers(q)) return;
        const key = bakerSearchKey(q);
        if (bakerSearchCache.has(key) || bakerSearchInFlight.has(key)) return;
        const promise = findBakersByName(q, { limit: 5 })
            .then((matches) => {
                bakerSearchCache.set(key, Array.isArray(matches) ? matches : []);
            })
            .catch(() => {
                bakerSearchCache.set(key, []);
            })
            .finally(() => {
                bakerSearchInFlight.delete(key);
                if (isOpen && bakerSearchKey(input.value) === key) render();
            });
        bakerSearchInFlight.set(key, promise);
    };

    const render = () => {
        queueBakerLookup(input.value);
        results = groupOrderedResults(buildResults(input.value));
        if (selectedIndex >= results.length) selectedIndex = results.length ? 0 : -1;
        if (selectedIndex < 0 && normalizeQuery(input.value) && results.length) selectedIndex = 0;

        if (!results.length) {
            panel.innerHTML = '<div class="hero-search-empty">No Tezos Systems room matched that yet. Try a wallet address, .tez name, baker, KT1 contract, operation hash, block, protocol, or slash command.</div>';
            syncActiveDescendant();
            return;
        }

        let index = 0;
        const guide = normalizeQuery(input.value)
            ? ''
            : '<div class="hero-search-guide"><strong>Search accepts:</strong> wallet addresses, .tez names, bakers, KT1 contracts, operation hashes, block levels, protocols, Chambers, and slash commands. Press / from anywhere.</div>';
        panel.innerHTML = guide + groupedResults(results).map((group) => {
            const rows = group.results.map((result) => resultHtml(result, index++, selectedIndex)).join('');
            return `
                <section class="hero-search-group" aria-label="${escapeHtml(group.label)}">
                    <div class="hero-search-group-label">${escapeHtml(group.label)}</div>
                    ${rows}
                </section>
            `;
        }).join('');
        syncActiveDescendant();
    };

    const debouncedRender = debounce(render, 80);

    const ensureProtocols = () => {
        loadProtocols().then(() => {
            if (isOpen) render();
        });
    };

    const applyQuery = (value) => {
        input.value = value || '';
        input.focus();
        setOpen(true);
        ensureProtocols();
        selectedIndex = -1;
        render();
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!isOpen) setOpen(true);
        if (!results.length) render();
        const result = results[selectedIndex >= 0 ? selectedIndex : 0];
        if (runResult(result)) setOpen(false);
    });

    form.addEventListener('click', (event) => {
        if (event.target.closest('.hero-search-submit')) return;
        if (document.activeElement !== input) input.focus();
        if (!isOpen) {
            setOpen(true);
            ensureProtocols();
            render();
        }
    });

    input.addEventListener('focus', () => {
        setOpen(true);
        ensureProtocols();
        render();
    });

    input.addEventListener('input', () => {
        if (!isOpen) setOpen(true);
        selectedIndex = -1;
        debouncedRender();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (isOpen) {
                event.preventDefault();
                setOpen(false);
            }
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!isOpen) setOpen(true);
            if (!results.length) render();
            const result = results[selectedIndex >= 0 ? selectedIndex : 0];
            if (runResult(result)) setOpen(false);
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        if (!isOpen) {
            setOpen(true);
            render();
        }
        if (!results.length) return;
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        selectedIndex = selectedIndex < 0
            ? (dir > 0 ? 0 : results.length - 1)
            : (selectedIndex + dir + results.length) % results.length;
        render();
    });

    panel.addEventListener('mousemove', (event) => {
        const option = event.target.closest('[data-result-index]');
        if (!option) return;
        const next = Number(option.dataset.resultIndex);
        if (!Number.isFinite(next) || next === selectedIndex) return;
        selectedIndex = next;
        render();
    });

    panel.addEventListener('click', (event) => {
        const option = event.target.closest('[data-result-index]');
        if (!option) return;
        const result = results[Number(option.dataset.resultIndex)];
        if (runResult(result)) setOpen(false);
    });

    chips.addEventListener('click', (event) => {
        const routeChip = event.target.closest('[data-hero-route]');
        if (routeChip) {
            const buttonTarget = SITE_MAP_BUTTON_TARGETS.get(routeChip.dataset.heroEntry || '');
            if (buttonTarget) document.getElementById(buttonTarget)?.click();
            else runRoute(routeChip.dataset.heroRoute || '');
            setOpen(false);
            return;
        }
        const chip = event.target.closest('[data-hero-query]');
        if (!chip) return;
        applyQuery(chip.dataset.heroQuery || '');
    });

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-hero-query]');
        if (trigger && !root.contains(trigger)) {
            event.preventDefault();
            applyQuery(trigger.dataset.heroQuery || '');
            return;
        }
        if (!isOpen || root.contains(event.target)) return;
        setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (isTextEntryTarget(event.target)) return;
        event.preventDefault();
        input.focus();
        input.select();
    });

    // Warm the protocol index after first paint, but keep the hero input cheap.
    window.setTimeout(ensureProtocols, 1200);
}
