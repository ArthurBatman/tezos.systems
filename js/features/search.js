/**
 * Hero Search / Command Bar
 * Turns the protocol header into a front door for native Tezos.Systems rooms.
 */

import { debounce, escapeHtml } from '../core/utils.js';
import { loadDataAsset } from '../core/data-assets.js';
import {
    findSiteMapEntry,
    navigateSiteMapEntry,
    searchSiteMap,
    searchSiteMapIntents,
    siteMapBrowseEntries,
    siteMapBrowseIntents,
    siteMapRoute,
    siteMapSearchScore,
    siteMapSearchChips,
    siteMapStarters
} from '../core/site-map.js';
import { getAvailableThemes, openThemePicker, setTheme } from '../ui/theme.js';
import { findBakersByName } from './leaderboard.js';
import { getTopHotSignal } from './daily-briefing.js';

const HERO_SEARCH_CSS_URL = '/css/hero-search.css?v=487';

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
    const fullLabel = `Live: ${label}`;
    const compactLabel = fullLabel.length <= 24
        ? fullLabel
        : `${fullLabel.slice(0, 23).replace(/\s+\S*$/, '').trim()}…`;
    return {
        label: compactLabel,
        route: signal.route
    };
}

const RUNTIME_COMMANDS = [
    { id: 'theme', title: '/theme', detail: 'Switch visual theme', action: 'theme-picker', aliases: ['theme', 'themes', 'switch theme'] },
    { id: 'explore', title: '/explore', detail: 'Open the Tezos Systems feature launcher', action: 'button', value: 'features-gear', aliases: ['explore', 'features', 'feature launcher', 'command center'] },
    { id: 'settings', title: '/settings', detail: 'Open theme, sharing, export, and help settings', action: 'button', value: 'settings-gear', aliases: ['settings', 'preferences'] },
    { id: 'ultra', title: '/ultra', detail: 'Toggle the high-intensity visual mode', action: 'button', value: 'ultra-toggle', aliases: ['ultra', 'ultra mode'] },
    { id: 'share', title: '/share', detail: 'Create a branded Tezos Systems snapshot', action: 'button', value: 'share-btn', aliases: ['share', 'share dashboard', 'snapshot image'] },
    { id: 'export', title: '/export', detail: 'Export the current dashboard data', action: 'button', value: 'export-btn', aliases: ['export', 'download data', 'export data'] },
    { id: 'about', title: '/about', detail: 'Open the quick Tezos explainer', action: 'button', value: 'about-tezos-btn', aliases: ['about', 'what is tezos', 'tezos explainer'] },
    { id: 'streak', title: '/streak', detail: 'Explain this browser\'s local visit streak', action: 'button', value: 'visit-streak-info-btn', aliases: ['streak', 'visit streak', 'daily streak'] },
    { id: 'shortcuts', title: '/shortcuts', detail: 'Open keyboard shortcuts and search help', action: 'button', value: 'shortcuts-btn', aliases: ['shortcuts', 'keyboard shortcuts', 'help'] },
    { id: 'changelog', title: '/changelog', detail: 'Read the latest Tezos Systems changes', action: 'button', value: 'changelog-btn', aliases: ['changelog', 'updates', 'what is new', "what's new"] },
    { id: 'site-map', title: '/site-map', detail: 'Jump to the complete canonical destination map', action: 'hash', value: '#site-map', aliases: ['site map', 'all pages', 'directory'] },
    { id: 'tzsafe', title: 'TzSafe Multisig Recovery', detail: 'Open the external legacy KT1 multisig migration tool', action: 'external', value: 'https://tzsafe.tez.page/', group: 'Recovery tools', badge: 'external', aliases: ['tzsafe', 'multisig recovery', 'kt1 safe', 'legacy multisig'] }
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
    if (searchSiteMapIntents(q).length || searchSiteMap(q).length) return false;
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
        protocolsPromise = loadDataAsset('protocolData')
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
        group: command.group || 'Commands',
        title: command.title,
        detail: command.detail,
        badge: command.badge || 'command',
        action: command.action || (command.id === 'theme' ? 'theme-picker' : 'hash'),
        value: command.value || command.hash,
        aliases: command.aliases
    };
}

function siteMapIntentResult(intent, { browse = false } = {}) {
    return {
        kind: 'page',
        group: browse ? intent.group : 'Feature views',
        title: intent.title,
        detail: intent.detail,
        badge: intent.parentTitle || intent.group || 'view',
        action: 'page',
        value: intent.href,
        parentId: intent.parentId,
        searchScore: intent.searchScore,
        aliases: intent.keywords
    };
}

function siteMapResult(entry, { starter = false, browse = false } = {}) {
    const rootHashEntry = entry.hash && (entry.href === '/' || entry.href.startsWith('/#'));
    const buttonTarget = SITE_MAP_BUTTON_TARGETS.get(entry.id);
    const route = siteMapRoute(entry);
    return {
        kind: entry.group === 'Guides' ? 'guide' : entry.group === 'Story Rooms' ? 'story' : 'page',
        group: starter ? 'Start here' : browse ? entry.group : 'Pages on tezos.systems',
        title: entry.title,
        detail: entry.detail,
        badge: entry.fresh ? 'new' : entry.group,
        action: buttonTarget ? 'button' : entry.hash ? 'site-map' : rootHashEntry ? 'hash' : 'page',
        value: buttonTarget || (entry.hash ? entry.id : rootHashEntry ? entry.hash : route),
        aliases: entry.keywords
    };
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

function buildResults(query, { browseAll = false } = {}) {
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
    const siteMapIntents = searchSiteMapIntents(q);
    const siteMapEntries = searchSiteMap(q);
    const siteMapIntentMatches = siteMapIntents.map(siteMapIntentResult);
    const siteMapMatches = siteMapEntries.map(siteMapResult);
    const entityMatches = entityResults(q);
    const themeMatches = themeResults(q);
    const starterMatches = starterResults(q);

    if (!q) {
        if (browseAll) {
            return dedupeResults([
                ...siteMapBrowseEntries().map((entry) => siteMapResult(entry, { browse: true })),
                ...siteMapBrowseIntents().map((intent) => siteMapIntentResult(intent, { browse: true }))
            ]);
        }
        return dedupeResults([
            ...siteMapStarters().map((entry) => siteMapResult(entry, { starter: true })),
            ...RUNTIME_STARTER_ROWS
        ].filter(Boolean));
    }

    const intentMatches = siteMapIntentMatches.slice(0, 6);
    const canonicalMatches = siteMapMatches.slice(0, 8);
    const topIntent = intentMatches[0];
    const topCanonicalEntry = siteMapEntries[0];
    const topCanonicalScore = topCanonicalEntry ? siteMapSearchScore(topCanonicalEntry, q) : 0;
    const preferIntent = Boolean(topIntent) && (
        topIntent.parentId === topCanonicalEntry?.id
        || Number(topIntent.searchScore || 0) > topCanonicalScore
    );
    const manifestMatches = !intentMatches.length
        ? canonicalMatches
        : preferIntent
            ? [...intentMatches, ...canonicalMatches]
            : [canonicalMatches[0], ...intentMatches, ...canonicalMatches.slice(1)].filter(Boolean);

    const directMatches = [
        ...entityMatches,
        ...themeMatches,
        ...starterMatches,
        ...manifestMatches,
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
            tabindex="-1"
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
    if (result.action === 'site-map') {
        return navigateSiteMapEntry(result.value);
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

function runRoute(route, entryId = '') {
    if (!route) return false;
    const entry = entryId ? findSiteMapEntry(entryId) : null;
    if (entry) return navigateSiteMapEntry(entry);
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
    const closeButton = document.getElementById('hero-search-close');
    if (!root || !form || !input || !panel || !chips || !closeButton) return;
    ensureHeroSearchStyles();

    let isOpen = false;
    let isBrowsingAll = false;
    let selectedIndex = -1;
    let results = [];

    const renderQuickChips = () => {
        const liveChip = livePulseChip();
        const chipList = [
            ...(liveChip ? [liveChip] : []),
            { label: `All ${siteMapBrowseEntries().length + siteMapBrowseIntents().length}`, browseAll: true },
            ...siteMapSearchChips(),
            ...RUNTIME_QUICK_CHIPS
        ];
        chips.innerHTML = chipList.map((chip) => {
            const attr = chip.browseAll
                ? 'data-hero-browse-all="true"'
                : chip.route
                ? `data-hero-route="${escapeHtml(chip.route)}"`
                : `data-hero-query="${escapeHtml(chip.value)}"`;
            const entryAttr = chip.id ? ` data-hero-entry="${escapeHtml(chip.id)}"` : '';
            return `<button class="hero-search-chip" type="button" ${attr}${entryAttr}>${escapeHtml(chip.label)}</button>`;
        }).join('');
    };

    renderQuickChips();
    window.addEventListener('hot-signal-rendered', renderQuickChips);

    const setOpen = (next) => {
        const wasOpen = isOpen;
        isOpen = Boolean(next);
        root.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('hero-search-mode', isOpen);
        panel.hidden = !isOpen;
        input.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen && !wasOpen) window.dispatchEvent(new Event('hero-search-opened'));
        if (!isOpen) {
            isBrowsingAll = false;
            selectedIndex = -1;
            root.classList.remove('has-query');
            root.classList.remove('is-browsing-all');
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
        if (!isOpen) return;
        queueBakerLookup(input.value);
        root.classList.toggle('has-query', Boolean(normalizeQuery(input.value)));
        root.classList.toggle('is-browsing-all', isBrowsingAll);
        results = groupOrderedResults(buildResults(input.value, { browseAll: isBrowsingAll }));
        if (selectedIndex >= results.length) selectedIndex = results.length ? 0 : -1;
        if (selectedIndex < 0 && normalizeQuery(input.value) && results.length) selectedIndex = 0;

        if (!results.length) {
            panel.innerHTML = '<div class="hero-search-empty">No Tezos Systems room matched that yet. Try a wallet address, .tez name, baker, KT1 contract, operation hash, block, protocol, or slash command.</div>';
            syncActiveDescendant();
            return;
        }

        let index = 0;
        const destinationCount = siteMapBrowseEntries().length + siteMapBrowseIntents().length;
        const guide = normalizeQuery(input.value)
            ? ''
            : isBrowsingAll
                ? `<div class="hero-search-guide"><strong>All ${destinationCount} destinations.</strong><span>The complete Tezos Systems directory. Start typing to narrow it, or choose any room, guide, tool, view, widget, or feed.</span></div>`
                : `<div class="hero-search-guide"><strong>Start from anything.</strong><span>Choose a useful starting point below, paste a wallet, .tez name, baker, contract, operation, block, or protocol, or open All ${destinationCount} for the complete directory. Press / from anywhere.</span></div>`;
        panel.innerHTML = guide + groupedResults(results).map((group) => {
            const rows = group.results.map((result) => resultHtml(result, index++, selectedIndex)).join('');
            return `
                <section class="hero-search-group" role="group" aria-label="${escapeHtml(group.label)}">
                    <div class="hero-search-group-label">${escapeHtml(group.label)}</div>
                    ${rows}
                </section>
            `;
        }).join('');
        syncActiveDescendant();
        if (selectedIndex >= 0) {
            const option = panel.querySelector(`#hero-search-option-${selectedIndex}`);
            if (option) {
                const panelRect = panel.getBoundingClientRect();
                const optionRect = option.getBoundingClientRect();
                if (optionRect.top < panelRect.top) panel.scrollTop -= panelRect.top - optionRect.top + 8;
                else if (optionRect.bottom > panelRect.bottom) panel.scrollTop += optionRect.bottom - panelRect.bottom + 8;
            }
        }
    };

    const debouncedRender = debounce(render, 80);

    const ensureProtocols = () => {
        loadProtocols().then(() => {
            if (isOpen) render();
        });
    };

    const applyQuery = (value) => {
        isBrowsingAll = false;
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
        render();
        const result = results[selectedIndex >= 0 ? selectedIndex : 0];
        if (runResult(result)) setOpen(false);
    });

    closeButton.addEventListener('click', () => {
        setOpen(false);
        input.blur();
    });

    form.addEventListener('click', (event) => {
        if (event.target.closest('.hero-search-submit, .hero-search-close')) return;
        if (document.activeElement !== input) input.focus();
        if (!isOpen) {
            setOpen(true);
            if (input.value) input.select();
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
        isBrowsingAll = false;
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
            render();
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
        const browseAllChip = event.target.closest('[data-hero-browse-all]');
        if (browseAllChip) {
            input.value = '';
            input.focus();
            setOpen(true);
            ensureProtocols();
            isBrowsingAll = true;
            selectedIndex = -1;
            render();
            return;
        }
        const routeChip = event.target.closest('[data-hero-route]');
        if (routeChip) {
            const buttonTarget = SITE_MAP_BUTTON_TARGETS.get(routeChip.dataset.heroEntry || '');
            if (buttonTarget) document.getElementById(buttonTarget)?.click();
            else runRoute(routeChip.dataset.heroRoute || '', routeChip.dataset.heroEntry || '');
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
