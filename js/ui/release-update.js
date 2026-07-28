/**
 * Dedicated service-worker release notice.
 *
 * This surface is intentionally independent from the ambient toast queue:
 * updates remain reachable without blocking Network Moments, while the shared
 * safe-area reservation keeps those notices above the release dock.
 */

import { releaseToastSafeArea, reserveToastSafeArea } from './toast-queue.js';

const SAFE_AREA_KEY = 'release-update-dock';
const ENTER_FRAME_COUNT = 2;

let dock = null;
let card = null;
let pill = null;
let title = null;
let detail = null;
let actionButton = null;
let laterButton = null;
let currentAction = null;
let currentLater = null;
let currentPendingLabel = 'Updating…';
let safeAreaFrame = 0;
let resizeObserver = null;

function scheduleSafeAreaReservation() {
    if (typeof window === 'undefined') return;
    if (safeAreaFrame) window.cancelAnimationFrame(safeAreaFrame);
    safeAreaFrame = window.requestAnimationFrame(() => {
        safeAreaFrame = 0;
        if (!dock || dock.hidden) {
            releaseToastSafeArea(SAFE_AREA_KEY);
            return;
        }
        const rect = dock.getBoundingClientRect();
        reserveToastSafeArea(SAFE_AREA_KEY, window.innerHeight - rect.top + 12);
    });
}

function setCollapsed(collapsed, { moveFocus = false } = {}) {
    if (!dock || !card || !pill) return;
    dock.classList.toggle('is-collapsed', collapsed);
    card.hidden = collapsed;
    pill.hidden = !collapsed;
    scheduleSafeAreaReservation();

    if (!moveFocus) return;
    const focusTarget = collapsed ? pill : actionButton;
    window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
}

function ensureDock() {
    if (dock || typeof document === 'undefined') return dock;

    dock = document.createElement('aside');
    dock.className = 'release-update-dock';
    dock.dataset.releaseUpdateDock = '';
    dock.dataset.state = 'ready';
    dock.setAttribute('aria-label', 'Tezos Systems update');
    dock.hidden = true;

    pill = document.createElement('button');
    pill.className = 'release-update-pill';
    pill.type = 'button';
    pill.hidden = true;
    pill.innerHTML = '<span class="release-update-symbol" aria-hidden="true">↻</span><span data-release-update-pill-label>Update ready</span>';

    card = document.createElement('div');
    card.className = 'release-update-card';

    const icon = document.createElement('span');
    icon.className = 'release-update-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↻';

    const copy = document.createElement('div');
    copy.className = 'release-update-copy';
    copy.setAttribute('role', 'status');
    copy.setAttribute('aria-live', 'polite');
    copy.setAttribute('aria-atomic', 'true');

    title = document.createElement('strong');
    title.className = 'release-update-title';

    detail = document.createElement('span');
    detail.className = 'release-update-detail';
    copy.append(title, detail);

    const actions = document.createElement('div');
    actions.className = 'release-update-actions';

    actionButton = document.createElement('button');
    actionButton.className = 'release-update-action';
    actionButton.type = 'button';
    actionButton.dataset.releaseUpdateAction = '';

    laterButton = document.createElement('button');
    laterButton.className = 'release-update-later';
    laterButton.type = 'button';
    laterButton.dataset.releaseUpdateLater = '';
    laterButton.textContent = 'Later';

    actions.append(actionButton, laterButton);
    card.append(icon, copy, actions);
    dock.append(card, pill);
    document.body.appendChild(dock);

    actionButton.addEventListener('click', () => {
        if (actionButton.disabled || typeof currentAction !== 'function') return;
        dock.dataset.state = 'updating';
        actionButton.disabled = true;
        actionButton.textContent = currentPendingLabel;
        Promise.resolve(currentAction()).catch(() => {
            setReleaseUpdateDockState({
                state: 'ready',
                title: 'Update needs another try',
                detail: 'The new build is still ready. Try the update again.',
                actionLabel: 'Try again'
            });
        });
    });

    laterButton.addEventListener('click', () => {
        setCollapsed(true, { moveFocus: true });
        currentLater?.();
    });

    pill.addEventListener('click', () => {
        setCollapsed(false, { moveFocus: true });
    });

    window.addEventListener('resize', scheduleSafeAreaReservation, { passive: true });
    if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(scheduleSafeAreaReservation);
        resizeObserver.observe(dock);
    }

    return dock;
}

export function setReleaseUpdateDockState({
    state = 'ready',
    title: nextTitle,
    detail: nextDetail,
    actionLabel,
    pendingLabel,
    pillLabel,
    onAction,
    onLater,
    canDefer
} = {}) {
    ensureDock();
    if (!dock) return;

    dock.dataset.state = state;
    if (nextTitle !== undefined) title.textContent = nextTitle;
    if (nextDetail !== undefined) detail.textContent = nextDetail;
    if (actionLabel !== undefined) actionButton.textContent = actionLabel;
    if (pendingLabel !== undefined) currentPendingLabel = pendingLabel;
    if (pillLabel !== undefined) {
        const label = pill.querySelector('[data-release-update-pill-label]');
        if (label) label.textContent = pillLabel;
    }
    if (onAction !== undefined) currentAction = onAction;
    if (onLater !== undefined) currentLater = onLater;
    if (canDefer !== undefined) laterButton.hidden = !canDefer;

    actionButton.disabled = state === 'updating';
    if (state === 'updating') actionButton.textContent = currentPendingLabel;
    scheduleSafeAreaReservation();
}

export function showReleaseUpdateDock({
    state = 'ready',
    title = 'New version ready',
    detail = 'Reload for the latest Tezos Systems fixes and features.',
    actionLabel = 'Update & reload',
    pendingLabel = 'Updating…',
    pillLabel = 'Update ready',
    onAction,
    onLater,
    canDefer = true,
    expanded = true
} = {}) {
    ensureDock();
    if (!dock) return;
    const wasVisible = !dock.hidden;

    setReleaseUpdateDockState({
        state,
        title,
        detail,
        actionLabel,
        pendingLabel,
        pillLabel,
        onAction,
        onLater,
        canDefer
    });

    dock.hidden = false;
    setCollapsed(!expanded);
    if (wasVisible) {
        dock.classList.add('is-visible');
        scheduleSafeAreaReservation();
        return;
    }
    dock.classList.remove('is-visible');
    let frames = 0;
    const enter = () => {
        frames += 1;
        if (frames < ENTER_FRAME_COUNT) {
            window.requestAnimationFrame(enter);
            return;
        }
        dock?.classList.add('is-visible');
        scheduleSafeAreaReservation();
    };
    window.requestAnimationFrame(enter);
}

export function expandReleaseUpdateDock({ moveFocus = false } = {}) {
    if (!dock || dock.hidden) return;
    setCollapsed(false, { moveFocus });
}

export function isReleaseUpdateDockCollapsed() {
    return Boolean(dock && !dock.hidden && dock.classList.contains('is-collapsed'));
}

export function hideReleaseUpdateDock() {
    if (!dock) return;
    dock.classList.remove('is-visible');
    dock.hidden = true;
    releaseToastSafeArea(SAFE_AREA_KEY);
}
