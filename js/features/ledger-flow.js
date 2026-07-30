/**
 * Ledger Flow Chamber
 * Account-level diagram for bounded tez transfers and all-time account context.
 */

import { API_URLS } from '../core/config.js';
import { fetchWithRetry } from '../core/api.js';
import { quietlyMutate, quietlySyncHtml } from '../core/quiet-refresh.js';
import {
    isTezDomainName,
    isTezosAddress,
    normalizeTezDomainName,
    resolveTezDomainRecord
} from '../core/tezos-domains.js';
import { escapeHtml } from '../core/utils.js';
import { activateChamberDialog, deactivateChamberDialog, wireChamberLauncher } from '../ui/chamber-accessibility.js';
import { getWhaleWatchArtifact } from './whale-chamber.js';
import { buildLedgerFlowModel, layoutLedgerFlowNodes } from './ledger-flow-model.mjs';

const TZKT = API_URLS.tzkt;
const STORAGE_KEY = 'tezos-systems-my-baker-address';
const LAST_TARGET_KEY = 'tezos-systems-ledger-flow-target';
const WINDOW_KEY = 'tezos-systems-ledger-flow-window';
const THRESHOLD_KEY = 'tezos-systems-ledger-flow-threshold-index';
const LEDGER_FLOW_CSS_URL = '/css/ledger-flow.css?v=534';
const DEFAULT_WINDOW = '30d';
const TRANSFER_PAGE_LIMIT = 10000;
const EXACT_ROW_LIMIT = 20000;
const SAMPLE_ROW_LIMIT = 10000;
const LOAD_TIMEOUT_MS = 20000;
const TRANSFER_FIELDS = 'id,hash,level,timestamp,amount,sender,target';
const NODE_MIN_WIDTH = 188;
const NODE_MAX_WIDTH = 252;
const NODE_HEIGHT = 62;
const NODE_TEXT_PAD = 30;
const NODE_MIN_GAP = 18;

const WINDOW_OPTIONS = [
    { key: '24h', label: '24H', ms: 24 * 60 * 60 * 1000 },
    { key: '7d', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
    { key: '30d', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
    { key: '1y', label: '1Y', ms: 365 * 24 * 60 * 60 * 1000 },
    { key: 'all', label: 'All', ms: null }
];

const THRESHOLDS = [
    { label: '0 XTZ', mutez: 0 },
    { label: '1 XTZ', mutez: 1e6 },
    { label: '10 XTZ', mutez: 10e6 },
    { label: '100 XTZ', mutez: 100e6 },
    { label: '1K XTZ', mutez: 1000e6 },
    { label: '10K XTZ', mutez: 10000e6 },
    { label: '100K XTZ', mutez: 100000e6 }
];

let savedBodyOverflow = null;
let savedHtmlOverflow = null;
let activeWindow = loadStoredWindow();
let thresholdIndex = loadStoredThresholdIndex();
let activeTarget = '';
let activeLabel = '';
let activeData = null;
let renderSeq = 0;
let activeLoad = null;
let thresholdReloadTimer = null;
let whaleSeed = null;
let selectedEdgeId = '';
let chamberOpenGeneration = 0;

function ensureLedgerFlowStyles() {
    if (document.getElementById('ledger-flow-css')) return;
    const link = document.createElement('link');
    link.id = 'ledger-flow-css';
    link.rel = 'stylesheet';
    link.href = LEDGER_FLOW_CSS_URL;
    document.head.appendChild(link);
}

function readStorage(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, String(value));
        return true;
    } catch {
        return false;
    }
}

function loadStoredWindow() {
    const stored = readStorage(WINDOW_KEY);
    return WINDOW_OPTIONS.some((item) => item.key === stored) ? stored : DEFAULT_WINDOW;
}

function loadStoredThresholdIndex() {
    const stored = Number(readStorage(THRESHOLD_KEY));
    return Number.isFinite(stored) && stored >= 0 && stored < THRESHOLDS.length ? stored : 0;
}

function isTezosAccount(value) {
    return isTezosAddress(String(value || '').trim());
}

function shortAddress(address) {
    const value = String(address || '');
    if (value.length <= 14) return value || 'unknown';
    return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function accountHref(address) {
    return `#my-baker=${encodeURIComponent(address)}`;
}

function tzktAccountHref(address) {
    return `https://tzkt.io/${encodeURIComponent(address)}`;
}

function formatCompactXTZ(mutez, options = {}) {
    const xtz = Number(mutez || 0) / 1e6;
    if (!Number.isFinite(xtz)) return '0 XTZ';
    if (xtz === 0) return '0 XTZ';
    const suffix = options.withUnit === false ? '' : ' XTZ';
    if (Math.abs(xtz) >= 1000000) return `${(xtz / 1000000).toFixed(2)}M${suffix}`;
    if (Math.abs(xtz) >= 1000) return `${(xtz / 1000).toFixed(1)}K${suffix}`;
    if (Math.abs(xtz) >= 10) return `${xtz.toFixed(1)}${suffix}`;
    if (Math.abs(xtz) >= 1) return `${xtz.toFixed(2)}${suffix}`;
    return `<0.01${suffix}`;
}

function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function formatDate(value) {
    if (!value) return 'unknown';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'unknown';
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

function formatAge(value) {
    if (!value) return 'time unknown';
    const diff = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(diff) || diff < 0) return 'just now';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 365) return `${days}d ago`;
    return `${Math.floor(days / 365)}y ago`;
}

function transactionUrl(params) {
    const url = new URL(`${TZKT}/operations/transactions`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function transactionCountUrl(params) {
    const url = new URL(`${TZKT}/operations/transactions/count`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function originationUrl(params) {
    const url = new URL(`${TZKT}/operations/originations`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return url.toString();
}

async function fetchJson(url, signal) {
    return fetchWithRetry(url, {
        signal,
        memoryCache: false,
        cache: 'no-store',
        timeoutMs: 12000
    }, 2);
}

async function resolveLedgerTarget(rawTarget, signal) {
    const target = String(rawTarget || '').trim();
    if (!target) return { address: '', label: '', resolution: null };
    if (isTezosAccount(target)) {
        return {
            address: target,
            label: target,
            resolution: { name: '', address: target, source: 'address' }
        };
    }
    if (isTezDomainName(target)) {
        const domain = normalizeTezDomainName(target);
        const record = await resolveTezDomainRecord(domain, { signal });
        return {
            address: record?.resolvedAddress || record?.address || '',
            label: domain,
            resolution: record
        };
    }
    return { address: '', label: target, resolution: null };
}

function windowTimestamp(windowKey, until = new Date().toISOString()) {
    const option = WINDOW_OPTIONS.find((item) => item.key === windowKey) || WINDOW_OPTIONS[2];
    if (!option.ms) return null;
    return new Date(new Date(until).getTime() - option.ms).toISOString();
}

function transferScope(address, boundary, thresholdMutez) {
    const params = {
        status: 'applied',
        'anyof.sender.target': address,
        'timestamp.lt': boundary.until
    };
    if (Number(thresholdMutez || 0) > 0) params['amount.ge'] = Number(thresholdMutez);
    else params['amount.gt'] = 0;
    if (boundary.since) params['timestamp.gt'] = boundary.since;
    return params;
}

async function fetchTransferCount(address, boundary, thresholdMutez, signal) {
    const value = await fetchJson(
        transactionCountUrl(transferScope(address, boundary, thresholdMutez)),
        signal
    );
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('TzKT transfer count returned an invalid value');
    }
    return count;
}

async function fetchTransfers(address, boundary, thresholdMutez, coverage, signal) {
    const rows = [];
    let cursor = '';
    const rowLimit = coverage.mode === 'sample' ? SAMPLE_ROW_LIMIT : coverage.totalRows;
    const maxRequests = coverage.mode === 'sample' ? 1 : Math.ceil(EXACT_ROW_LIMIT / TRANSFER_PAGE_LIMIT);
    let requestCount = 0;

    while (rows.length < rowLimit && requestCount < maxRequests) {
        const remaining = rowLimit - rows.length;
        const params = {
            ...transferScope(address, boundary, thresholdMutez),
            select: TRANSFER_FIELDS,
            limit: Math.min(TRANSFER_PAGE_LIMIT, remaining)
        };
        if (coverage.mode === 'sample') {
            params['sort.desc'] = 'amount';
        } else {
            params['sort.desc'] = 'id';
            if (cursor) params['id.lt'] = cursor;
        }

        requestCount += 1;
        const page = await fetchJson(transactionUrl(params), signal);
        if (!Array.isArray(page)) throw new Error('TzKT transfer history returned a non-array response');
        rows.push(...page);
        if (coverage.mode === 'sample' || page.length < Number(params.limit)) break;

        const nextCursor = String(page.at(-1)?.id || '');
        if (!/^\d+$/.test(nextCursor) || nextCursor === cursor) {
            throw new Error('TzKT transfer history pagination did not advance');
        }
        cursor = nextCursor;
    }

    if (rows.length < Math.min(rowLimit, coverage.totalRows)) {
        throw new Error('TzKT transfer history ended before its observed count');
    }
    return rows;
}

async function fetchFirstInbound(address, signal) {
    const rows = await fetchJson(transactionUrl({
        target: address,
        'sender.ne': address,
        status: 'applied',
        'amount.gt': 0,
        'sort.asc': 'id',
        select: TRANSFER_FIELDS,
        limit: 1
    }), signal);
    return Array.isArray(rows) ? rows[0] || null : null;
}

async function fetchOrigination(address, signal) {
    const rows = await fetchJson(originationUrl({
        originatedContract: address,
        status: 'applied',
        'sort.asc': 'id',
        select: 'id,level,timestamp,sender,originatedContract,contractBalance',
        limit: 1
    }), signal);
    return Array.isArray(rows) ? rows[0] || null : null;
}

async function fetchAccount(address, signal) {
    try {
        return await fetchJson(`${TZKT}/accounts/${encodeURIComponent(address)}`, signal);
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (/^HTTP 404\b/.test(String(error?.message || ''))) {
            throw new Error('TzKT does not recognize this account.');
        }
        return null;
    }
}

function edgeWidth(amount, maxAmount) {
    const max = Math.max(Number(maxAmount || 0), 1);
    const value = Math.max(Number(amount || 0), 1);
    const ratio = Math.log10(value + 1) / Math.log10(max + 1);
    return 1.1 + Math.max(0, Math.min(1, ratio)) * 6.4;
}

function edgeOpacity(amount, maxAmount) {
    const max = Math.max(Number(maxAmount || 0), 1);
    const value = Math.max(Number(amount || 0), 1);
    const ratio = Math.log10(value + 1) / Math.log10(max + 1);
    return 0.22 + Math.max(0, Math.min(1, ratio)) * 0.68;
}

function nodeLabel(item) {
    return item.label || item.alias || shortAddress(item.address);
}

function nodeSubLabel(item) {
    const sample = item.sample ? ' sample' : '';
    if (item.isCohort) {
        return `${formatCount(item.memberCount)} counterparties · ${formatCompactXTZ(item.total)}${sample}`;
    }
    if (item.isContext) return 'all-time first value';
    if (item.isFirstValue) return `first value · ${formatCompactXTZ(item.total)}${sample}`;
    return `${formatCompactXTZ(item.total)}${sample}`;
}

function truncate(value, max = 22) {
    const text = String(value || '');
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function fittedText(value, width, charWidth) {
    const maxChars = Math.max(4, Math.floor((width - NODE_TEXT_PAD) / charWidth));
    return truncate(value, maxChars);
}

function nodeGeometry(item) {
    const title = nodeLabel(item);
    const sub = nodeSubLabel(item);
    const desired = Math.max(title.length * 8.5, sub.length * 6.2) + 42;
    return {
        width: clamp(Math.ceil(desired), NODE_MIN_WIDTH, NODE_MAX_WIDTH),
        height: NODE_HEIGHT
    };
}

function accountLinksMarkup(account, options = {}) {
    const address = account?.address || '';
    if (!address) return '';
    const label = options.label || nodeLabel(account);
    const nameClass = options.nameClass ? ` ${options.nameClass}` : '';
    const wrapClass = options.wrapClass ? ` ${options.wrapClass}` : '';
    return `
        <span class="ledger-flow-account-actions${wrapClass}" title="${escapeHtml(address)}">
            <a class="ledger-flow-account-link ledger-flow-my-tezos-link${nameClass}" href="${accountHref(address)}" title="Open in My Tezos">${escapeHtml(label)}</a>
            <a class="lb-baker-source-link ledger-flow-tzkt-pill" href="${tzktAccountHref(address)}" target="_blank" rel="noopener" title="View on TzKT">TzKT</a>
        </span>
    `;
}

function addressLinkMarkup(address, options = {}) {
    if (!address) return '';
    const text = options.text || shortAddress(address);
    const className = options.className ? ` ${options.className}` : '';
    return `<a class="ledger-flow-address-link ledger-flow-my-tezos-link${className}" href="${accountHref(address)}" title="Open ${escapeHtml(address)} in My Tezos">${escapeHtml(text)}</a>`;
}

function renderEdge(edge, layout, maxAmount, index) {
    const center = layout.center;
    const pos = layout.positions.get(edge.counterparty.key);
    if (!pos) return '';
    const from = edge.direction === 'sent' ? center : pos;
    const to = edge.direction === 'sent' ? pos : center;
    const leftToRight = to.x > from.x;
    const curve = edge.direction === 'first' ? 58 : (edge.direction === 'sent' ? 92 : -92);
    const c1x = from.x + (leftToRight ? 150 : -150);
    const c2x = to.x + (leftToRight ? -150 : 150);
    const c1y = from.y + curve;
    const c2y = to.y + curve;
    const width = edge.direction === 'first'
        ? '2.40'
        : edgeWidth(edge.amount, maxAmount).toFixed(2);
    const opacity = edge.direction === 'first'
        ? '0.82'
        : edgeOpacity(edge.amount, maxAmount).toFixed(2);
    const marker = edge.direction === 'sent'
        ? 'sent'
        : edge.direction === 'first' || edge.isFirstValue ? 'first' : 'received';
    const firstLabel = edge.event?.kind === 'origination' ? 'Funded at origination by' : 'First inbound from';
    const amountLabel = edge.amount > 0 ? ` ${formatCompactXTZ(edge.amount)}` : '';
    const label = edge.direction === 'first'
        ? `${firstLabel}${amountLabel} ${nodeLabel(edge.counterparty)}`
        : `${edge.direction === 'sent' ? 'Sent' : 'Received'} ${formatCompactXTZ(edge.amount)} ${edge.direction === 'sent' ? 'to' : 'from'} ${nodeLabel(edge.counterparty)}`;
    const classes = [
        'ledger-flow-edge',
        `ledger-flow-edge-${edge.direction}`,
        edge.isFirstValue ? 'ledger-flow-edge-first ledger-flow-edge-first-value is-first-value' : ''
    ].filter(Boolean).join(' ');
    const path = `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
    return `
        <path class="${classes}" data-ledger-edge="${escapeHtml(edge.id)}" d="${path}" stroke-width="${width}" opacity="${opacity}" marker-end="url(#ledger-arrow-${marker})">
            <title>${escapeHtml(label)}</title>
        </path>
        ${edge.isFirstValue ? `<circle class="ledger-flow-first-pulse" cx="${from.x}" cy="${from.y}" r="${14 + (index % 2) * 3}"></circle>` : ''}
    `;
}

function renderNode(item, layout) {
    const pos = layout.positions.get(item.key);
    if (!pos) return '';
    const classes = ['ledger-flow-node'];
    if (item.isFirstValue || item.isContext) classes.push('is-first');
    if (item.isCohort) classes.push('is-cohort');
    const geometry = nodeGeometry(item);
    const x = pos.x - geometry.width / 2;
    const y = pos.y - geometry.height / 2;
    const label = fittedText(nodeLabel(item), geometry.width, 8.5);
    const sub = fittedText(nodeSubLabel(item), geometry.width, 6.2);
    return `
        <g class="${classes.join(' ')}" transform="translate(${x} ${y})">
            <rect width="${geometry.width}" height="${geometry.height}" rx="9"></rect>
            <text class="ledger-flow-node-title" x="${geometry.width / 2}" y="25" text-anchor="middle">${escapeHtml(label)}</text>
            <text class="ledger-flow-node-sub" x="${geometry.width / 2}" y="43" text-anchor="middle">${escapeHtml(sub)}</text>
        </g>
    `;
}

function renderFlowRow(edge, model, options = {}) {
    const counterparty = edge.counterparty;
    const selected = selectedEdgeId === edge.id;
    const direction = edge.direction === 'sent'
        ? 'Out to'
        : edge.direction === 'first'
            ? 'All-time first value from'
            : 'In from';
    const amount = edge.amount > 0 ? formatCompactXTZ(edge.amount) : 'origin receipt';
    const scope = model.coverage?.mode === 'sample' ? ' · sample' : '';
    const links = !counterparty.isCohort && counterparty.address
        ? accountLinksMarkup(counterparty, { wrapClass: 'ledger-flow-row-links' })
        : '';
    return `
        <article class="ledger-flow-flow-row${selected ? ' is-selected' : ''}" data-quiet-key="${escapeHtml(edge.id)}">
            <button type="button" class="ledger-flow-path-button" data-ledger-edge="${escapeHtml(edge.id)}" aria-pressed="${selected ? 'true' : 'false'}" aria-controls="${escapeHtml(options.controls || 'ledger-flow-detail-panel')}">
                <span class="ledger-flow-path-direction">${escapeHtml(direction)}</span>
                <strong>${escapeHtml(nodeLabel(counterparty))}</strong>
                <small>${escapeHtml(amount)}${scope} · ${escapeHtml(formatCount(edge.count))} ${edge.count === 1 ? 'row' : 'rows'}</small>
            </button>
            ${links}
        </article>
    `;
}

function renderMobileDiagram(model) {
    const inbound = model.edges.filter((edge) => edge.direction !== 'sent');
    const outbound = model.edges.filter((edge) => edge.direction === 'sent');
    const selected = model.edges.find((edge) => edge.id === selectedEdgeId) || model.edges[0] || null;
    return `
        <div class="ledger-flow-mobile-map" aria-label="Ledger Flow paths">
            <section class="ledger-flow-mobile-direction" aria-labelledby="ledger-flow-mobile-inbound">
                <h3 id="ledger-flow-mobile-inbound">Into account</h3>
                <div class="ledger-flow-mobile-rows">
                    ${inbound.length
                        ? inbound.map((edge) => renderFlowRow(edge, model, { controls: 'ledger-flow-mobile-detail' })).join('')
                        : '<p class="ledger-flow-muted">No inbound tez transfers match this view.</p>'}
                </div>
            </section>
            <div class="ledger-flow-mobile-account">
                <span>Selected account</span>
                <strong>${escapeHtml(model.account?.alias || activeLabel || shortAddress(model.address))}</strong>
                <small>${escapeHtml(shortAddress(model.address))}</small>
            </div>
            <div class="ledger-flow-mobile-inline-detail" id="ledger-flow-mobile-detail" aria-live="polite">
                ${edgeDetail(selected, model)}
            </div>
            <section class="ledger-flow-mobile-direction" aria-labelledby="ledger-flow-mobile-outbound">
                <h3 id="ledger-flow-mobile-outbound">Out of account</h3>
                <div class="ledger-flow-mobile-rows">
                    ${outbound.length
                        ? outbound.map((edge) => renderFlowRow(edge, model, { controls: 'ledger-flow-mobile-detail' })).join('')
                        : '<p class="ledger-flow-muted">No outbound tez transfers match this view.</p>'}
                </div>
            </section>
        </div>
    `;
}

function renderDiagram(model) {
    if (!model.visibleCounterparties.length || !model.edges.length) {
        return `
            <div class="ledger-flow-empty-graph">
                <strong>No visible transfers</strong>
                <span>Lower the minimum amount or widen the time window.</span>
            </div>
        `;
    }
    const layout = layoutLedgerFlowNodes(model.visibleCounterparties, {
        nodeHeight: NODE_HEIGHT,
        minimumGap: NODE_MIN_GAP
    });
    const maxAmount = Math.max(...model.edges.map((edge) => edge.amount), 1);
    const centerY = layout.center.y;
    return `
        ${renderMobileDiagram(model)}
        <svg class="ledger-flow-svg" viewBox="0 0 1000 ${layout.viewHeight}" aria-hidden="true" focusable="false">
            <defs>
                <marker id="ledger-arrow-sent" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" class="ledger-flow-arrow-sent"></path>
                </marker>
                <marker id="ledger-arrow-received" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" class="ledger-flow-arrow-received"></path>
                </marker>
                <marker id="ledger-arrow-first" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" class="ledger-flow-arrow-first"></path>
                </marker>
            </defs>
            <g class="ledger-flow-grid-lines" aria-hidden="true">
                <line x1="500" x2="500" y1="36" y2="${layout.viewHeight - 36}"></line>
                <line x1="100" x2="900" y1="${centerY}" y2="${centerY}"></line>
            </g>
            <g class="ledger-flow-edges">
                ${model.edges.map((edge, index) => renderEdge(edge, layout, maxAmount, index)).join('')}
            </g>
            <g class="ledger-flow-center-node" transform="translate(390 ${centerY - 60})">
                <rect width="220" height="120" rx="16"></rect>
                <text class="ledger-flow-center-kicker" x="110" y="34" text-anchor="middle">selected account</text>
                <text class="ledger-flow-center-title" x="110" y="62" text-anchor="middle">${escapeHtml(truncate(model.account?.alias || activeLabel || shortAddress(model.address), 20))}</text>
                <text class="ledger-flow-center-address" x="110" y="86" text-anchor="middle">${escapeHtml(shortAddress(model.address))}</text>
            </g>
            <g class="ledger-flow-nodes">
                ${model.visibleCounterparties.map((item) => renderNode(item, layout)).join('')}
            </g>
        </svg>
    `;
}

function edgeDetail(edge, model) {
    if (!edge) {
        const selectedAccount = {
            address: model.address,
            alias: model.account?.alias || activeLabel || shortAddress(model.address)
        };
        return `
            <div class="ledger-flow-detail-empty">
                ${accountLinksMarkup(selectedAccount, { nameClass: 'ledger-flow-detail-name', wrapClass: 'ledger-flow-detail-account' })}
                ${addressLinkMarkup(model.address, { text: model.address, className: 'ledger-flow-detail-address' })}
                <p>Select a path to inspect its direction, amount, row count, and latest matching receipt.</p>
            </div>
        `;
    }
    const counterparty = edge.counterparty;
    const verb = edge.direction === 'sent'
        ? 'Sent to'
        : edge.direction === 'first'
            ? edge.event?.kind === 'origination' ? 'Funded at origination by' : 'First inbound from'
            : edge.isFirstValue ? 'First inbound from' : 'Received from';
    const links = counterparty.isCohort
        ? `<strong class="ledger-flow-detail-name">${escapeHtml(nodeLabel(counterparty))}</strong>`
        : `
            ${accountLinksMarkup(counterparty, { nameClass: 'ledger-flow-detail-name', wrapClass: 'ledger-flow-detail-account' })}
            ${addressLinkMarkup(counterparty.address, { text: counterparty.address, className: 'ledger-flow-detail-address' })}
        `;
    const when = edge.event?.timestamp || edge.latest || '';
    const amount = edge.amount > 0 ? formatCompactXTZ(edge.amount) : 'n/a';
    const scope = model.coverage?.mode === 'sample' ? 'Largest-row sample' : 'Exact observed window';
    return `
        <div class="ledger-flow-detail-card" data-direction="${escapeHtml(edge.direction)}">
            <span class="ledger-flow-detail-kicker">${escapeHtml(verb)}</span>
            ${links}
            <div class="ledger-flow-detail-metrics">
                <span><small>${model.coverage?.mode === 'sample' ? 'Sample amount' : 'Amount'}</small><b>${escapeHtml(amount)}</b></span>
                <span><small>Rows</small><b>${escapeHtml(formatCount(edge.count))}</b></span>
                <span><small>Latest</small><b>${escapeHtml(when ? formatAge(when) : 'n/a')}</b></span>
            </div>
            <small class="ledger-flow-detail-scope">${escapeHtml(scope)}${counterparty.isCohort ? ` · ${formatCount(counterparty.memberCount)} counterparties` : ''}</small>
        </div>
    `;
}

function renderOriginContext(model) {
    const origin = model.accountOrigin;
    const inbound = model.firstInbound;
    if (!origin && !inbound) {
        return '<div class="ledger-flow-origin-empty">No origination or first inbound receipt was found.</div>';
    }
    const eventMarkup = (event, label) => {
        if (!event) return '';
        const counterparty = event.counterparty;
        const amount = Number(event.amountMutez || 0);
        return `
            <div class="ledger-flow-origin-row">
                <span>${escapeHtml(label)}</span>
                <strong>${counterparty?.address ? accountLinksMarkup(counterparty) : 'unknown'}</strong>
                <small>${escapeHtml(formatDate(event.timestamp))}${amount > 0 ? ` · ${escapeHtml(formatCompactXTZ(amount))}` : event.kind === 'origination' ? ' · zero initial balance' : ''}</small>
            </div>
        `;
    };
    return `
        <div class="ledger-flow-origin-context" aria-label="All-time account context">
            <div class="ledger-flow-origin-heading">All-time account context</div>
            ${eventMarkup(origin, 'Origination')}
            ${eventMarkup(inbound, 'First inbound transaction')}
        </div>
    `;
}

function renderCounterpartyRows(model) {
    const rows = model.listEdges.map((edge) => {
        const item = edge.counterparty;
        const badge = item.sent && item.received ? 'both' : edge.direction;
        const selected = selectedEdgeId === edge.id;
        return `
            <article class="ledger-flow-counterparty-row${selected ? ' is-selected' : ''}" data-quiet-key="${escapeHtml(edge.id)}">
                <span class="ledger-flow-row-name">
                    ${accountLinksMarkup(item)}
                    ${addressLinkMarkup(item.address)}
                </span>
                <span class="ledger-flow-row-amount">${escapeHtml(formatCompactXTZ(item.total, { withUnit: false }))}</span>
                <span class="ledger-flow-row-badge" data-kind="${escapeHtml(badge)}">${escapeHtml(badge)}${model.coverage?.mode === 'sample' ? ' sample' : ''}</span>
                <button type="button" class="ledger-flow-row-select" data-ledger-edge="${escapeHtml(edge.id)}" aria-pressed="${selected ? 'true' : 'false'}" aria-controls="ledger-flow-detail-panel">Show path</button>
            </article>
        `;
    }).join('');
    return rows || '<div class="ledger-flow-muted">No counterparties match the current filter.</div>';
}

function renderStats(model) {
    const sample = model.coverage?.mode === 'sample';
    const shown = model.threshold > 0;
    const qualifier = sample ? ' sample' : shown ? ' shown' : '';
    const firstValue = model.firstValueEvent;
    return `
        <div class="ledger-flow-stats" aria-label="Ledger Flow summary">
            <div><span>Received${escapeHtml(qualifier)}</span><strong>${escapeHtml(formatCompactXTZ(model.totals.received))}</strong></div>
            <div><span>Sent${escapeHtml(qualifier)}</span><strong>${escapeHtml(formatCompactXTZ(model.totals.sent))}</strong></div>
            <div><span>Counterparties${sample ? ' in sample' : shown ? ' shown' : ''}</span><strong>${escapeHtml(formatCount(model.counterparties.length))}</strong></div>
            <div><span>First value</span><strong>${firstValue?.amountMutez > 0 ? escapeHtml(formatCompactXTZ(firstValue.amountMutez)) : firstValue ? 'receipt' : 'n/a'}</strong></div>
        </div>
    `;
}

function renderWindowContext(model) {
    const windowKey = model.coverage?.windowKey || activeWindow;
    if (model.totals.count > 0 || windowKey === 'all') return '';
    const label = WINDOW_OPTIONS.find((item) => item.key === windowKey)?.label || windowKey.toUpperCase();
    return `
        <div class="ledger-flow-window-empty" role="status">
            <span>No transfers were found in ${escapeHtml(label)}.</span>
            <small>The origination and first-inbound facts below are all-time context and are not counted as current-window counterparties.</small>
            <button type="button" data-ledger-window="all">Show all time</button>
        </div>
    `;
}

function renderControls(model = null, valueOverride = '') {
    const threshold = THRESHOLDS[thresholdIndex] || THRESHOLDS[0];
    const value = valueOverride || activeLabel || activeTarget || '';
    return `
        <form class="ledger-flow-search" id="ledger-flow-search-form" autocomplete="off">
            <label for="ledger-flow-input">Account</label>
            <input id="ledger-flow-input" name="ledger-flow-input" type="search" spellcheck="false" placeholder="tz1 / KT1 / name.tez" value="${escapeHtml(value)}">
            <button type="submit">Map</button>
        </form>
        <div class="ledger-flow-controls" aria-label="Ledger Flow controls">
            <div class="ledger-flow-segmented" role="group" aria-label="Time window">
                ${WINDOW_OPTIONS.map((item) => `
                    <button type="button" data-ledger-window="${escapeHtml(item.key)}" class="${activeWindow === item.key ? 'active' : ''}" aria-pressed="${activeWindow === item.key ? 'true' : 'false'}">${escapeHtml(item.label)}</button>
                `).join('')}
            </div>
            <label class="ledger-flow-threshold" for="ledger-flow-threshold">
                <span>Min transfer</span>
                <input id="ledger-flow-threshold" type="range" min="0" max="${THRESHOLDS.length - 1}" step="1" value="${thresholdIndex}" aria-valuetext="${escapeHtml(threshold.label)}">
                <output id="ledger-flow-threshold-label" for="ledger-flow-threshold">${escapeHtml(threshold.label)}</output>
            </label>
        </div>
        <div class="ledger-flow-load-status" id="ledger-flow-load-status" role="status" aria-live="polite"></div>
        ${model?.rolledUpCount ? `<div class="ledger-flow-filter-note">${escapeHtml(formatCount(model.rolledUpCount))} lower-ranked counterparties reconcile into the directional “Other” nodes; the top ${escapeHtml(formatCount(model.listCounterparties.length))} are listed below.</div>` : ''}
        ${model?.hiddenListCount ? `<div class="ledger-flow-filter-note">${escapeHtml(formatCount(model.hiddenListCount))} additional counterparties remain outside the ranked list.</div>` : ''}
    `;
}

function renderLegend() {
    return `
        <div class="ledger-flow-legend" aria-label="Ledger Flow legend">
            <span><i data-kind="received"></i>Received</span>
            <span><i data-kind="sent"></i>Sent</span>
            <span><i data-kind="first"></i>All-time first value</span>
        </div>
    `;
}

function renderExampleChips() {
    if (!whaleSeed?.target) return '';
    const label = whaleSeed.alias || shortAddress(whaleSeed.target);
    const observed = whaleSeed.timestamp ? formatAge(whaleSeed.timestamp) : 'time unknown';
    return `
        <div class="ledger-flow-examples" aria-label="Live Ledger Flow starting point">
            <button type="button" data-ledger-example="${escapeHtml(whaleSeed.target)}" aria-label="Map ${escapeHtml(label)}, sender of Whale Watch's largest archived 24-hour move">
                <span>Largest archived 24h sender · ${escapeHtml(observed)}</span>
                <strong>${escapeHtml(label)}</strong>
                <small>${escapeHtml(shortAddress(whaleSeed.target))} · TzKT alias if named</small>
            </button>
        </div>
    `;
}

function renderScopeDisclosure() {
    return `
        <div class="ledger-flow-scope">
            <strong>Scope:</strong> applied tez transaction rows only. Account-to-itself rows are excluded from path totals. Token transfers, delegations, originations, tickets, and stake moves are not part of the window totals.
            <a href="/my/?view=portfolio">View tokens in My Tezos</a>.
        </div>
    `;
}

function renderCoverage(model) {
    const coverage = model.coverage || {};
    const windowLabel = WINDOW_OPTIONS.find((item) => item.key === coverage.windowKey)?.label || String(coverage.windowKey || '').toUpperCase();
    const selfRows = Number(model.selfTransferRows || 0);
    const selfDisclosure = selfRows
        ? ` ${formatCount(selfRows)} account-to-itself ${selfRows === 1 ? 'row is' : 'rows are'} excluded from the map totals.`
        : '';
    if (Number(coverage.thresholdMutez || 0) !== Number(model.threshold || 0)) {
        return `
            <div class="ledger-flow-coverage is-pending" role="note">
                <strong>Local filter preview</strong>
                <span>The mounted rows are filtered at ${escapeHtml(THRESHOLDS[thresholdIndex]?.label || '0 XTZ')} per transfer. Release the control to re-count this window and verify whether the result is exact or sampled.</span>
            </div>
        `;
    }
    if (coverage.mode === 'sample') {
        return `
            <div class="ledger-flow-coverage is-sample" role="note">
                <strong>Largest-row sample</strong>
                <span>${escapeHtml(formatCount(coverage.fetchedRows))} largest matching tez transaction rows of ${escapeHtml(formatCount(coverage.totalRows))} observed in ${escapeHtml(windowLabel)}. Every amount, rank, and counterparty count below describes this sample, not the complete account.${escapeHtml(selfDisclosure)}</span>
            </div>
        `;
    }
    return `
            <div class="ledger-flow-coverage is-exact" role="note">
                <strong>Exact observed window</strong>
            <span>All ${escapeHtml(formatCount(coverage.totalRows))} matching tez transaction rows through ${escapeHtml(formatDate(coverage.until))}${model.threshold > 0 ? ` at ${escapeHtml(THRESHOLDS.find((item) => item.mutez === coverage.thresholdMutez)?.label || formatCompactXTZ(coverage.thresholdMutez))} or more per transfer` : ''}.${escapeHtml(selfDisclosure)}</span>
        </div>
    `;
}

function renderEmptyState(container, valueOverride = '') {
    container.innerHTML = `
        <div class="chamber-header lb-header ledger-flow-header chamber-anim-fade">
            <div class="chamber-title-row">
                <h2 class="chamber-title" id="ledger-flow-title">Ledger Flow</h2>
                <span class="chamber-badge current">Account map</span>
            </div>
            <div class="chamber-proposal-info">Map bounded tez transfers with receipt-backed origination and first-inbound context.</div>
        </div>
        <section class="lb-explainer ledger-flow-explainer chamber-anim-fade">
            ${renderControls(null, valueOverride)}
            ${renderExampleChips()}
            <div class="ledger-flow-empty-panel">
                <strong>Choose an account</strong>
                <span>Paste a wallet, contract, or .tez name, or start with the latest validated Whale Watch receipt.</span>
            </div>
            ${renderScopeDisclosure()}
        </section>
        <div class="chamber-footer chamber-anim-fade">
            <span>Source: TzKT transactions</span>
            <span class="chamber-footer-sep">·</span>
            <a class="panel-direct-link" href="/ledger-flow/" aria-label="Direct link to Ledger Flow">Direct: /ledger-flow/</a>
        </div>
    `;
    wireLedgerFlowControls(container);
}

function applyLedgerBodyMarkup(container, markup, options = {}) {
    const content = container.closest('.ledger-flow-content');
    if (options.quiet && content) {
        quietlyMutate(content, () => quietlySyncHtml(container, markup));
    } else {
        container.innerHTML = markup;
    }
}

function renderLedgerFlow(data, options = {}) {
    const container = document.querySelector('#ledger-flow-modal .ledger-flow-body');
    if (!container) return;
    if (!data?.address) {
        renderEmptyState(container);
        return;
    }
    const model = buildLedgerFlowModel(data, {
        thresholdMutez: THRESHOLDS[thresholdIndex]?.mutez || 0
    });
    if (model.coverage?.mode === 'sample') {
        [...model.visibleCounterparties, ...model.listCounterparties].forEach((item) => {
            item.sample = true;
        });
    }
    const selectableEdges = [...model.edges, ...model.listEdges];
    if (!selectableEdges.some((edge) => edge.id === selectedEdgeId)) {
        selectedEdgeId = selectableEdges.find((edge) => edge.isFirstValue)?.id
            || selectableEdges[0]?.id
            || '';
    }
    const firstDetail = selectableEdges.find((edge) => edge.id === selectedEdgeId) || null;
    const windowLabel = WINDOW_OPTIONS.find((item) => item.key === model.coverage?.windowKey)?.label
        || String(model.coverage?.windowKey || '').toUpperCase();
    const ownerFallback = model.resolution?.source === 'owner';
    const identity = ownerFallback
        ? `${model.resolution.name} · owner wallet · ${shortAddress(model.address)}`
        : `${model.account?.alias || model.label || shortAddress(model.address)} · ${shortAddress(model.address)}`;
    const markup = `
        <div class="chamber-header lb-header ledger-flow-header chamber-anim-fade">
            <div class="chamber-title-row">
                <h2 class="chamber-title" id="ledger-flow-title">Ledger Flow</h2>
                <span class="chamber-badge ${model.coverage?.mode === 'sample' ? 'current' : 'live'}">${model.coverage?.mode === 'sample' ? 'Sample' : 'Exact'}</span>
            </div>
            <div class="chamber-proposal-info${ownerFallback ? ' is-owner-fallback' : ''}">
                ${escapeHtml(identity)} · ${escapeHtml(windowLabel)}
            </div>
        </div>
        <section class="lb-explainer ledger-flow-explainer chamber-anim-fade">
            ${renderControls(model)}
            ${renderCoverage(model)}
            ${renderStats(model)}
            ${renderWindowContext(model)}
            ${renderLegend()}
            ${renderScopeDisclosure()}
        </section>
        <section class="lb-panel ledger-flow-panel ledger-flow-map-panel chamber-anim-fade" style="animation-delay:70ms">
            <div class="lb-panel-title">Transfer Map</div>
            ${renderDiagram(model)}
        </section>
        <section class="lb-panel ledger-flow-panel ledger-flow-origin-panel chamber-anim-fade" style="animation-delay:100ms">
            ${renderOriginContext(model)}
        </section>
        <div class="ledger-flow-lower-grid">
            <section class="lb-panel ledger-flow-panel ledger-flow-counterparties chamber-anim-fade" style="animation-delay:120ms">
                <div class="lb-panel-title">${model.coverage?.mode === 'sample' ? 'Counterparties in Sample' : 'Top Counterparties'}</div>
                <div class="ledger-flow-counterparty-list">${renderCounterpartyRows(model)}</div>
            </section>
            <section class="lb-panel ledger-flow-panel ledger-flow-detail chamber-anim-fade" style="animation-delay:160ms">
                <div class="lb-panel-title">Selected Path</div>
                <div id="ledger-flow-detail-panel" aria-live="polite">${edgeDetail(firstDetail, model)}</div>
            </section>
        </div>
        <div class="chamber-footer chamber-anim-fade" style="animation-delay:220ms">
            <span>Source: TzKT transactions</span>
            <span class="chamber-footer-sep">·</span>
            <span>Fetched ${escapeHtml(formatAge(model.updatedAt))}</span>
            <span class="chamber-footer-sep">·</span>
            <span>Last matching transfer ${escapeHtml(formatAge(model.latest))}</span>
            <span class="chamber-footer-sep">·</span>
            <a class="panel-direct-link" href="https://tzkt.io/${encodeURIComponent(model.address)}/operations/" target="_blank" rel="noopener">TzKT operations</a>
            <span class="chamber-footer-sep">·</span>
            <a class="panel-direct-link" href="/ledger-flow/" aria-label="Direct link to Ledger Flow">Direct: /ledger-flow/</a>
        </div>
    `;
    applyLedgerBodyMarkup(container, markup, { quiet: options.quiet });
    container.dataset.ledgerFlowModel = 'ready';
    container.dataset.ledgerFlowWindow = model.coverage?.windowKey || '';
    container.dataset.ledgerFlowMode = model.coverage?.mode || '';
    container._ledgerFlowModel = model;
    wireLedgerFlowControls(container);
}

function setDetailForEdge(edgeId, container) {
    const model = container?._ledgerFlowModel;
    if (!model || !edgeId) return;
    const edge = [...model.edges, ...model.listEdges].find((item) => item.id === edgeId);
    if (!edge) return;
    selectedEdgeId = edgeId;
    const content = container.closest('.ledger-flow-content') || container;
    quietlyMutate(content, () => {
        const markup = edgeDetail(edge, model);
        const panel = container.querySelector('#ledger-flow-detail-panel');
        const mobilePanel = container.querySelector('#ledger-flow-mobile-detail');
        if (panel) panel.innerHTML = markup;
        if (mobilePanel) mobilePanel.innerHTML = markup;
        container.querySelectorAll('[data-ledger-edge]').forEach((item) => {
            const selected = item.dataset.ledgerEdge === edgeId;
            item.classList.toggle('is-selected', selected);
            if (item.matches('button')) item.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        container.querySelectorAll('[data-quiet-key]').forEach((item) => {
            item.classList.toggle('is-selected', item.getAttribute('data-quiet-key') === edgeId);
        });
    });
}

function wireLedgerFlowControls(container) {
    const form = container.querySelector('#ledger-flow-search-form');
    if (form && !form.dataset.ledgerFlowWired) {
        form.dataset.ledgerFlowWired = '1';
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const value = form.querySelector('#ledger-flow-input')?.value || '';
            loadLedgerFlow(value);
        });
    }

    container.querySelectorAll('[data-ledger-window]').forEach((button) => {
        if (button.dataset.ledgerFlowWired) return;
        button.dataset.ledgerFlowWired = '1';
        button.addEventListener('click', () => {
            const next = button.dataset.ledgerWindow;
            if (!WINDOW_OPTIONS.some((item) => item.key === next)) return;
            activeWindow = next;
            writeStorage(WINDOW_KEY, activeWindow);
            if (activeTarget) loadLedgerFlow(activeTarget);
            else renderLedgerFlow(null);
        });
    });

    const threshold = container.querySelector('#ledger-flow-threshold');
    if (threshold && !threshold.dataset.ledgerFlowWired) {
        threshold.dataset.ledgerFlowWired = '1';
        threshold.addEventListener('input', () => {
            const next = Number(threshold.value);
            thresholdIndex = Number.isFinite(next) ? Math.max(0, Math.min(THRESHOLDS.length - 1, next)) : 0;
            writeStorage(THRESHOLD_KEY, String(thresholdIndex));
            const label = THRESHOLDS[thresholdIndex]?.label || THRESHOLDS[0].label;
            threshold.setAttribute('aria-valuetext', label);
            const output = container.querySelector('#ledger-flow-threshold-label');
            if (output) output.textContent = label;
            if (activeData) renderLedgerFlow(activeData, { quiet: true });
            else renderLedgerFlow(null);
        });
        threshold.addEventListener('change', () => {
            window.clearTimeout(thresholdReloadTimer);
            thresholdReloadTimer = window.setTimeout(() => {
                thresholdReloadTimer = null;
                const overlay = document.getElementById('ledger-flow-modal');
                if (overlay?.classList.contains('active') && activeTarget) loadLedgerFlow(activeTarget);
            }, 120);
        });
    }

    if (!container.dataset.ledgerFlowEdgeWired) {
        container.dataset.ledgerFlowEdgeWired = '1';
        container.addEventListener('click', (event) => {
            const example = event.target.closest('[data-ledger-example]');
            if (example) {
                event.preventDefault();
                loadLedgerFlow(example.dataset.ledgerExample);
                return;
            }
            const accountLink = event.target.closest('.ledger-flow-my-tezos-link');
            if (accountLink) {
                if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeLedgerFlowChamber();
                return;
            }
            if (event.target.closest('a')) return;
            const target = event.target.closest('[data-ledger-edge]');
            if (!target) return;
            event.preventDefault();
            setDetailForEdge(target.dataset.ledgerEdge, container);
        });
    }
}

function setLoadStatus(message = '', tone = '') {
    const body = document.querySelector('#ledger-flow-modal .ledger-flow-body');
    if (!body) return;
    const content = body.closest('.ledger-flow-content') || body;
    quietlyMutate(content, () => {
        const busy = Boolean(message) && tone === 'loading';
        body.setAttribute('aria-busy', busy ? 'true' : 'false');
        body.dataset.ledgerFlowLoading = busy ? 'true' : 'false';
        const status = body.querySelector('#ledger-flow-load-status');
        if (status) {
            status.textContent = message;
            status.dataset.tone = tone;
        }
    });
}

function renderLoading(label = 'Opening Ledger Flow...', requestedTarget = '') {
    const body = document.querySelector('#ledger-flow-modal .ledger-flow-body');
    if (!body) return;
    if (!body.querySelector('#ledger-flow-search-form')) renderEmptyState(body, requestedTarget);
    quietlyMutate(body.closest('.ledger-flow-content') || body, () => {
        const input = body.querySelector('#ledger-flow-input');
        if (input && requestedTarget && input.value !== requestedTarget) input.value = requestedTarget;
        body.querySelectorAll('[data-ledger-window]').forEach((button) => {
            const active = button.dataset.ledgerWindow === activeWindow;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    });
    setLoadStatus(label, 'loading');
}

function renderError(message, detail = '') {
    const body = document.querySelector('#ledger-flow-modal .ledger-flow-body');
    if (!body) return;
    if (!body.querySelector('#ledger-flow-search-form')) renderEmptyState(body);
    setLoadStatus(`${message}${detail ? ` — ${detail}` : ''}`, 'error');
}

function abortActiveLoad(reason = 'superseded') {
    if (!activeLoad) return;
    window.clearTimeout(activeLoad.timeoutId);
    activeLoad.abortReason = reason;
    activeLoad.controller.abort();
    activeLoad = null;
}

function accountAlias(value) {
    return {
        address: value?.address || '',
        alias: value?.alias || ''
    };
}

function buildOriginEvent(origination) {
    const counterparty = accountAlias(origination?.sender);
    if (!counterparty.address) return null;
    return {
        kind: 'origination',
        id: origination?.id || null,
        timestamp: origination?.timestamp || '',
        amountMutez: Math.max(0, Number(origination?.contractBalance || 0)),
        counterparty
    };
}

function buildFirstInboundEvent(transaction) {
    const counterparty = accountAlias(transaction?.sender);
    if (!counterparty.address) return null;
    return {
        kind: 'first-inbound',
        id: transaction?.id || null,
        transactionId: transaction?.id || null,
        timestamp: transaction?.timestamp || '',
        amountMutez: Math.max(0, Number(transaction?.amount || 0)),
        counterparty
    };
}

async function loadLedgerFlow(rawTarget) {
    const body = document.querySelector('#ledger-flow-modal .ledger-flow-body');
    if (!body) return;
    const target = String(rawTarget || '').trim();
    abortActiveLoad('superseded');
    if (!target) {
        activeTarget = '';
        activeLabel = '';
        activeData = null;
        selectedEdgeId = '';
        renderLedgerFlow(null);
        return;
    }

    const seq = ++renderSeq;
    const previous = {
        target: activeTarget,
        label: activeLabel,
        data: activeData,
        window: activeData?.coverage?.windowKey || activeWindow
    };
    const requestedWindow = activeWindow;
    const thresholdMutez = THRESHOLDS[thresholdIndex]?.mutez || 0;
    const controller = new AbortController();
    const load = {
        seq,
        controller,
        timeoutId: 0,
        timedOut: false,
        abortReason: ''
    };
    load.timeoutId = window.setTimeout(() => {
        load.timedOut = true;
        load.abortReason = 'timeout';
        controller.abort();
    }, LOAD_TIMEOUT_MS);
    activeLoad = load;
    renderLoading('Mapping account transfers...', target);

    try {
        const resolved = await resolveLedgerTarget(target, controller.signal);
        if (seq !== renderSeq || controller.signal.aborted) return;
        if (!resolved.address) {
            throw new Error('Account not found. Use a valid tz1/tz2/tz3/tz4 wallet, KT1 contract, or resolvable .tez name.');
        }

        const until = new Date().toISOString();
        const boundary = {
            since: windowTimestamp(requestedWindow, until),
            until
        };
        const [account, totalRows, firstInboundRaw, originationRaw] = await Promise.all([
            fetchAccount(resolved.address, controller.signal),
            fetchTransferCount(resolved.address, boundary, thresholdMutez, controller.signal),
            fetchFirstInbound(resolved.address, controller.signal),
            resolved.address.startsWith('KT1')
                ? fetchOrigination(resolved.address, controller.signal)
                : Promise.resolve(null)
        ]);
        const coverage = {
            mode: totalRows > EXACT_ROW_LIMIT ? 'sample' : 'exact',
            totalRows,
            fetchedRows: 0,
            windowKey: requestedWindow,
            since: boundary.since,
            until: boundary.until,
            thresholdMutez
        };
        const transactions = await fetchTransfers(
            resolved.address,
            boundary,
            thresholdMutez,
            coverage,
            controller.signal
        );
        if (seq !== renderSeq) return;
        coverage.fetchedRows = transactions.length;
        const accountOrigin = buildOriginEvent(originationRaw);
        const firstInboundEvent = buildFirstInboundEvent(firstInboundRaw);
        const firstValueEvent = accountOrigin?.amountMutez > 0 ? accountOrigin : firstInboundEvent;
        activeTarget = resolved.address;
        activeLabel = resolved.label || resolved.address;
        activeData = {
            address: resolved.address,
            label: resolved.label,
            resolution: resolved.resolution,
            account,
            transactions,
            accountOrigin,
            firstInboundEvent,
            firstValueEvent,
            coverage,
            updatedAt: new Date().toISOString()
        };
        writeStorage(LAST_TARGET_KEY, resolved.address);
        renderLedgerFlow(activeData, { quiet: true });
        setLoadStatus('');
    } catch (error) {
        console.warn('Ledger Flow failed', error);
        if (seq !== renderSeq) return;
        const abortedByNewLoad = error?.name === 'AbortError' && load.abortReason === 'superseded';
        const abortedByClose = error?.name === 'AbortError' && load.abortReason === 'closed';
        if (abortedByNewLoad || abortedByClose) return;
        activeTarget = previous.target;
        activeLabel = previous.label;
        activeData = previous.data;
        activeWindow = previous.window;
        writeStorage(WINDOW_KEY, activeWindow);
        const reason = load.timedOut
            ? 'The bounded request timed out.'
            : error?.message || 'TzKT did not answer.';
        if (activeData) {
            renderLedgerFlow(activeData, { quiet: true });
            setLoadStatus(`Could not load ${target}; still showing the last-good ${String(activeData.coverage?.windowKey || '').toUpperCase()} view. ${reason}`, 'error');
        } else {
            renderError('Ledger Flow data is delayed', `${reason} Try again in a moment.`);
        }
    } finally {
        window.clearTimeout(load.timeoutId);
        if (activeLoad === load) activeLoad = null;
    }
}

function lockPageScroll() {
    if (savedBodyOverflow !== null) return;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
}

function unlockPageScroll() {
    if (savedBodyOverflow === null) return;
    document.body.style.overflow = savedBodyOverflow || '';
    document.documentElement.style.overflow = savedHtmlOverflow || '';
    savedBodyOverflow = null;
    savedHtmlOverflow = null;
}

function defaultTarget() {
    return readStorage(LAST_TARGET_KEY)
        || readStorage(STORAGE_KEY)
        || '';
}

async function loadWhaleSeed() {
    if (whaleSeed?.target) return whaleSeed;
    try {
        const artifact = await getWhaleWatchArtifact();
        const operation = artifact?.transfers24h?.largestOperation;
        const sender = String(operation?.sender || '');
        const target = String(operation?.target || '');
        if (String(operation?.status || '').toLowerCase() !== 'applied'
            || !isTezosAccount(sender)
            || !isTezosAccount(target)
            || sender === target
            || !(Number(operation?.amountMutez || 0) > 0)) {
            return null;
        }
        whaleSeed = {
            target: sender,
            alias: String(operation?.senderAlias || ''),
            timestamp: operation?.timestamp || artifact?.generatedAt || '',
            amountMutez: Number(operation.amountMutez)
        };
        return whaleSeed;
    } catch {
        return null;
    }
}

export async function openLedgerFlowChamber(target = '') {
    const openGeneration = ++chamberOpenGeneration;
    ensureLedgerFlowStyles();
    let overlay = document.getElementById('ledger-flow-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ledger-flow-modal';
        overlay.className = 'modal-overlay chamber-overlay lb-overlay ledger-flow-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="modal-content modal-large chamber-content lb-content ledger-flow-content" role="dialog" aria-modal="true" aria-labelledby="ledger-flow-title" tabindex="-1">
                <button class="modal-close chamber-close" type="button" aria-label="Close Ledger Flow Chamber" style="z-index:3">&times;</button>
                <div class="chamber-body lb-body ledger-flow-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.chamber-close')?.addEventListener('click', closeLedgerFlowChamber);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeLedgerFlowChamber();
        });
    }

    overlay.classList.add('active');
    activateChamberDialog(overlay, {
        close: closeLedgerFlowChamber,
        dialogSelector: '.ledger-flow-content',
        titleId: 'ledger-flow-title',
        label: 'Ledger Flow Chamber'
    });
    lockPageScroll();
    const content = overlay.querySelector('.ledger-flow-content');
    if (content) content.scrollTop = 0;

    let nextTarget = String(target || '').trim() || defaultTarget();
    if (!nextTarget) {
        renderLedgerFlow(null);
        const seed = await loadWhaleSeed();
        if (openGeneration !== chamberOpenGeneration || !overlay.classList.contains('active')) return;
        nextTarget = seed?.target || '';
    }
    if (nextTarget) {
        await loadLedgerFlow(nextTarget);
    } else {
        renderLedgerFlow(null);
    }
}

export function closeLedgerFlowChamber() {
    chamberOpenGeneration += 1;
    window.clearTimeout(thresholdReloadTimer);
    thresholdReloadTimer = null;
    abortActiveLoad('closed');
    renderSeq += 1;
    const overlay = document.getElementById('ledger-flow-modal');
    if (overlay) {
        overlay.classList.remove('active');
        deactivateChamberDialog(overlay);
    }
    unlockPageScroll();
}

function miniMapSvg() {
    return `
        <svg class="ledger-flow-entry-svg" viewBox="0 0 360 118" aria-hidden="true">
            <path class="ledger-flow-entry-line received" d="M26 30 C105 14, 116 55, 178 56"></path>
            <path class="ledger-flow-entry-line sent" d="M180 62 C238 54, 260 92, 332 82"></path>
            <path class="ledger-flow-entry-line first" d="M52 92 C112 82, 128 66, 178 64"></path>
            <circle class="ledger-flow-entry-node" cx="180" cy="60" r="18"></circle>
            <circle class="ledger-flow-entry-dot received" cx="26" cy="30" r="7"></circle>
            <circle class="ledger-flow-entry-dot sent" cx="332" cy="82" r="7"></circle>
            <circle class="ledger-flow-entry-dot first" cx="52" cy="92" r="7"></circle>
        </svg>
    `;
}

function ensureLedgerFlowEntryCard() {
    const grid = document.getElementById('chambers-grid');
    if (!grid) return null;
    let card = document.getElementById('ledger-flow-entry-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'ledger-flow-entry-card';
        card.className = 'stat-card chamber-entry-card chamber-entry-wide ledger-flow-entry-card chamber-entry-adoption';
        card.dataset.updatedLabel = 'TzKT account transfers';
        card.innerHTML = `
            <button class="card-copy-link" type="button" data-copy-hash="#ledger-flow" aria-label="Copy Ledger Flow direct link" title="Copy Ledger Flow link">🔗</button>
            <div class="card-inner">
                <div class="card-front ledger-flow-entry-front">
                    <h2 class="stat-label" id="ledger-flow-entry-title">Ledger Flow</h2>
                    <div class="ledger-flow-entry-main">
                        ${miniMapSvg()}
                        <div class="ledger-flow-entry-copy">
                            <div class="chamber-entry-icon">Account transfer map</div>
                            <p class="stat-description">Bounded sent and received tez paths with all-time receipt context.</p>
                        </div>
                    </div>
                    <div class="chamber-entry-metrics ledger-flow-entry-metrics">
                        <div class="chamber-entry-metric" data-ledger-flow-metric="received"><span>Received</span><strong>blue</strong></div>
                        <div class="chamber-entry-metric" data-ledger-flow-metric="sent"><span>Sent</span><strong>pink</strong></div>
                        <div class="chamber-entry-metric" data-ledger-flow-metric="first"><span>First value</span><strong>gold</strong></div>
                        <div class="chamber-entry-metric"><span>Weight</span><strong>amount</strong></div>
                    </div>
                </div>
                <div class="card-back" aria-hidden="true">
                    <h2 class="stat-label">Ledger Flow</h2>
                    <div class="stat-value">Graph</div>
                    <p class="stat-description">Open account transfer paths.</p>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }

    wireChamberLauncher(card, {
        open: openLedgerFlowChamber,
        label: 'Open Ledger Flow Chamber',
        titleSelector: '#ledger-flow-entry-title, .stat-label'
    });
    card.dataset.ledgerFlowWired = '1';

    return card;
}

export function initLedgerFlowChamber() {
    ensureLedgerFlowStyles();
    window.openLedgerFlowChamber = openLedgerFlowChamber;
    ensureLedgerFlowEntryCard();
}
