import { CHAMBER_CATEGORY_META, findSiteMapEntry } from '../core/site-map.js';
import { enqueueToast } from './toast-queue.js';
import { isHomeBlockVisible, setHomeBlockVisible } from './home-layout.js';

export const EXPLORE_LAYOUT_STORAGE_KEY = 'tezos-systems-explore-layout-v1';
export const LEGACY_CHAMBER_CATEGORY_STORAGE_KEY = 'tezos-systems-chamber-categories-v1';

const CATEGORY_IDS = Object.freeze(CHAMBER_CATEGORY_META.map((category) => category.key));
const ROOM_IDS = Object.freeze(CHAMBER_CATEGORY_META.flatMap((category) => category.entryIds));
const VALID_CATEGORY_IDS = new Set(CATEGORY_IDS);
const VALID_ROOM_IDS = new Set(ROOM_IDS);
const CATEGORY_BY_ROOM = new Map(CHAMBER_CATEGORY_META.flatMap((category) => (
    category.entryIds.map((id) => [id, category])
)));

let hiddenCategoryIds = new Set();
let hiddenRoomIds = new Set();
let initialized = false;
let previewDepth = 0;

function normalizePreference(value) {
    if (!value || value.version !== 1
        || !Array.isArray(value.hiddenCategories)
        || !Array.isArray(value.hiddenRooms)) return null;
    if (value.hiddenCategories.some((id) => typeof id !== 'string' || !VALID_CATEGORY_IDS.has(id))) return null;
    if (value.hiddenRooms.some((id) => typeof id !== 'string' || !VALID_ROOM_IDS.has(id))) return null;
    return {
        hiddenCategories: CATEGORY_IDS.filter((id) => value.hiddenCategories.includes(id)),
        hiddenRooms: ROOM_IDS.filter((id) => value.hiddenRooms.includes(id))
    };
}

function normalizeLegacyPreference(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.hidden)) return null;
    if (value.hidden.some((id) => typeof id !== 'string' || !VALID_CATEGORY_IDS.has(id))) return null;
    return CATEGORY_IDS.filter((id) => value.hidden.includes(id));
}

function readPreference() {
    const empty = { hiddenCategories: [], hiddenRooms: [] };
    try {
        const raw = localStorage.getItem(EXPLORE_LAYOUT_STORAGE_KEY);
        if (raw !== null) return normalizePreference(JSON.parse(raw)) || empty;

        const legacyRaw = localStorage.getItem(LEGACY_CHAMBER_CATEGORY_STORAGE_KEY);
        if (legacyRaw === null) return empty;
        const legacyCategories = normalizeLegacyPreference(JSON.parse(legacyRaw));
        if (!legacyCategories) return empty;
        const migrated = { hiddenCategories: legacyCategories, hiddenRooms: [] };
        localStorage.setItem(EXPLORE_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 1, ...migrated }));
        localStorage.removeItem(LEGACY_CHAMBER_CATEGORY_STORAGE_KEY);
        return migrated;
    } catch (_) {
        return empty;
    }
}

function persistPreference() {
    try {
        localStorage.setItem(EXPLORE_LAYOUT_STORAGE_KEY, JSON.stringify({
            version: 1,
            hiddenCategories: CATEGORY_IDS.filter((id) => hiddenCategoryIds.has(id)),
            hiddenRooms: ROOM_IDS.filter((id) => hiddenRoomIds.has(id))
        }));
    } catch (_) {}
}

function categoryFor(id) {
    return CHAMBER_CATEGORY_META.find((category) => category.key === id) || null;
}

function roomFor(id) {
    if (!VALID_ROOM_IDS.has(id)) return null;
    const entry = findSiteMapEntry(id);
    return { id, label: entry?.title || id, category: CATEGORY_BY_ROOM.get(id) };
}

function categoryHasVisibleRoom(category, categories = hiddenCategoryIds, rooms = hiddenRoomIds) {
    return !categories.has(category.key) && category.entryIds.some((id) => !rooms.has(id));
}

function effectiveHiddenCategoryIds(categories = hiddenCategoryIds, rooms = hiddenRoomIds) {
    return new Set(CHAMBER_CATEGORY_META
        .filter((category) => !categoryHasVisibleRoom(category, categories, rooms))
        .map((category) => category.key));
}

function shownRoomCount(categories = hiddenCategoryIds, rooms = hiddenRoomIds) {
    return CHAMBER_CATEGORY_META.reduce((total, category) => (
        total + (categories.has(category.key)
            ? 0
            : category.entryIds.filter((id) => !rooms.has(id)).length)
    ), 0);
}

function syncRootState() {
    const effectiveCategories = effectiveHiddenCategoryIds();
    document.documentElement.setAttribute(
        'data-chamber-categories-hidden',
        CATEGORY_IDS.filter((id) => effectiveCategories.has(id)).join(' ')
    );
    document.documentElement.setAttribute(
        'data-chamber-rooms-hidden',
        ROOM_IDS.filter((id) => hiddenRoomIds.has(id)).join(' ')
    );
}

function categoryElement(id) {
    return document.querySelector(`#chambers-grid > .chamber-category[data-chamber-category="${id}"]`);
}

function roomElement(id) {
    return document.querySelector(`#chambers-grid [data-chamber-entry-id="${id}"]`);
}

function isRendered(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function captureLayoutAnchor(id, type, nextCategories, nextRooms) {
    const element = type === 'room' ? roomElement(id) : categoryElement(id);
    if (!element) return null;
    const candidates = [];
    let next = element.nextElementSibling;
    while (next) {
        candidates.push(next);
        next = next.nextElementSibling;
    }
    const parentCategory = element.closest?.('.chamber-category');
    let nextCategory = parentCategory?.nextElementSibling;
    while (nextCategory) {
        candidates.push(nextCategory);
        nextCategory = nextCategory.nextElementSibling;
    }
    candidates.push(document.getElementById('moments-section'));
    candidates.push(document.getElementById('recruit-section'));
    candidates.push(document.getElementById('site-footer'));
    const effectiveCategories = effectiveHiddenCategoryIds(nextCategories, nextRooms);
    const anchorElement = candidates.find((candidate) => {
        const category = candidate?.matches?.('.chamber-category') ? candidate : candidate?.closest?.('.chamber-category');
        const roomId = candidate?.dataset?.chamberEntryId;
        if (category && effectiveCategories.has(category.dataset.chamberCategory)) return false;
        if (roomId && nextRooms.has(roomId)) return false;
        return isRendered(candidate);
    });
    return anchorElement ? { element: anchorElement, top: anchorElement.getBoundingClientRect().top } : null;
}

function preserveLayoutAnchor(anchor) {
    if (!anchor?.element?.isConnected) return;
    requestAnimationFrame(() => {
        if (!anchor.element.isConnected) return;
        const delta = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
    });
}

function syncExploreVisibility(source, { reveal = false } = {}) {
    const empty = shownRoomCount() === 0;
    if (reveal && !empty && !isHomeBlockVisible('explore')) {
        setHomeBlockVisible('explore', true, `${source}-explore`);
    } else if (empty && isHomeBlockVisible('explore')) {
        setHomeBlockVisible('explore', false, `${source}-empty`);
    }
}

function dispatchChange(id, visible, source, type) {
    window.dispatchEvent(new CustomEvent('tezos:chamber-category-change', {
        detail: { id, visible, source, type }
    }));
    window.dispatchEvent(new CustomEvent('tezos:explore-layout-change', {
        detail: { id, visible, source, type }
    }));
}

function syncControls() {
    CHAMBER_CATEGORY_META.forEach((category) => {
        const categoryEnabled = !hiddenCategoryIds.has(category.key);
        const categoryShown = category.entryIds.filter((id) => (
            categoryEnabled && !hiddenRoomIds.has(id)
        )).length;
        document.querySelectorAll(`[data-chamber-category-toggle="${category.key}"]`).forEach((input) => {
            input.checked = categoryEnabled;
        });
        document.querySelectorAll(`[data-chamber-topic-room-count="${category.key}"]`).forEach((badge) => {
            badge.textContent = `${categoryShown}/${category.entryIds.length}`;
            badge.setAttribute('aria-label', `${categoryShown} of ${category.entryIds.length} ${category.label} Chambers shown`);
        });
    });
    ROOM_IDS.forEach((id) => {
        const parentHidden = hiddenCategoryIds.has(CATEGORY_BY_ROOM.get(id)?.key);
        document.querySelectorAll(`[data-chamber-room-toggle="${id}"]`).forEach((input) => {
            input.checked = !hiddenRoomIds.has(id);
            input.disabled = parentHidden;
        });
    });
    const shownCategories = CHAMBER_CATEGORY_META.filter((category) => categoryHasVisibleRoom(category)).length;
    const shownRooms = shownRoomCount();
    document.querySelectorAll('[data-chamber-category-count]').forEach((badge) => {
        badge.textContent = `${shownCategories} topics`;
        badge.setAttribute('aria-label', `${shownCategories} of ${CATEGORY_IDS.length} Explore topics shown`);
    });
    document.querySelectorAll('[data-chamber-room-count]').forEach((badge) => {
        badge.textContent = `${shownRooms} shown`;
        badge.setAttribute('aria-label', `${shownRooms} of ${ROOM_IDS.length} Chambers shown`);
    });
    const showAll = document.getElementById('chamber-category-show-all');
    if (showAll) showAll.disabled = hiddenCategoryIds.size === 0 && hiddenRoomIds.size === 0;
    window.dispatchEvent(new CustomEvent('tezos:explore-layout-sync'));
}

export function isChamberCategoryVisible(id) {
    const category = categoryFor(id);
    return Boolean(category && categoryHasVisibleRoom(category));
}

export function isChamberRoomVisible(id) {
    const category = CATEGORY_BY_ROOM.get(id);
    return Boolean(category && !hiddenCategoryIds.has(category.key) && !hiddenRoomIds.has(id));
}

export function setChamberCategoryVisible(id, visible, source = 'api') {
    const category = categoryFor(id);
    if (!category) return false;
    const nextVisible = Boolean(visible);
    const wasEnabled = !hiddenCategoryIds.has(id);
    if (wasEnabled === nextVisible) {
        if (nextVisible && shownRoomCount() > 0) syncExploreVisibility(source, { reveal: true });
        return false;
    }

    const nextCategories = new Set(hiddenCategoryIds);
    const nextRooms = new Set(hiddenRoomIds);
    const restoredRoomIds = [];
    if (nextVisible) {
        nextCategories.delete(id);
        if (category.entryIds.every((roomId) => nextRooms.has(roomId))) {
            category.entryIds.forEach((roomId) => {
                nextRooms.delete(roomId);
                restoredRoomIds.push(roomId);
            });
        }
    } else {
        nextCategories.add(id);
    }
    const nextShown = shownRoomCount(nextCategories, nextRooms);
    const anchor = nextVisible || nextShown === 0
        ? null
        : captureLayoutAnchor(id, 'category', nextCategories, nextRooms);

    hiddenCategoryIds = nextCategories;
    hiddenRoomIds = nextRooms;
    syncRootState();
    persistPreference();
    syncControls();
    syncExploreVisibility(source, { reveal: nextVisible });
    preserveLayoutAnchor(anchor);
    dispatchChange(id, nextVisible, source, 'category');
    restoredRoomIds.forEach((roomId) => dispatchChange(roomId, true, source, 'room'));
    return true;
}

export function setChamberRoomVisible(id, visible, source = 'api') {
    const room = roomFor(id);
    if (!room) return false;
    const nextVisible = Boolean(visible);
    const wasVisible = isChamberRoomVisible(id);
    const storedVisible = !hiddenRoomIds.has(id);
    const parentHidden = hiddenCategoryIds.has(room.category.key);
    if (wasVisible === nextVisible && (nextVisible || storedVisible === nextVisible)) {
        if (nextVisible) syncExploreVisibility(source, { reveal: true });
        return false;
    }

    const nextCategories = new Set(hiddenCategoryIds);
    const nextRooms = new Set(hiddenRoomIds);
    if (nextVisible) {
        nextRooms.delete(id);
        nextCategories.delete(room.category.key);
    } else {
        nextRooms.add(id);
        if (room.category.entryIds.every((roomId) => nextRooms.has(roomId))) {
            nextCategories.add(room.category.key);
        }
    }
    const nextShown = shownRoomCount(nextCategories, nextRooms);
    const anchor = nextVisible || nextShown === 0
        ? null
        : captureLayoutAnchor(id, 'room', nextCategories, nextRooms);

    hiddenCategoryIds = nextCategories;
    hiddenRoomIds = nextRooms;
    syncRootState();
    persistPreference();
    syncControls();
    syncExploreVisibility(source, { reveal: nextVisible });
    preserveLayoutAnchor(anchor);
    dispatchChange(id, nextVisible, source, 'room');
    const parentNowHidden = hiddenCategoryIds.has(room.category.key);
    if (parentHidden !== parentNowHidden) {
        dispatchChange(room.category.key, !parentNowHidden, source, 'category');
    }
    return true;
}

export function showAllChamberCategories(source = 'show-all-chambers', { revealExplore = true } = {}) {
    const changedCategories = CHAMBER_CATEGORY_META.filter((category) => hiddenCategoryIds.has(category.key));
    const changedRooms = ROOM_IDS.filter((id) => hiddenRoomIds.has(id));
    if (!changedCategories.length && !changedRooms.length) {
        if (revealExplore) syncExploreVisibility(source, { reveal: true });
        return false;
    }
    hiddenCategoryIds = new Set();
    hiddenRoomIds = new Set();
    syncRootState();
    persistPreference();
    syncControls();
    if (revealExplore) syncExploreVisibility(source, { reveal: true });
    changedCategories.forEach((category) => dispatchChange(category.key, true, source, 'category'));
    changedRooms.forEach((id) => dispatchChange(id, true, source, 'room'));
    return true;
}

function beginPreview(source = 'preview') {
    previewDepth += 1;
    document.documentElement.setAttribute('data-chamber-categories-preview', 'all');
    window.dispatchEvent(new CustomEvent('tezos:chamber-category-preview', { detail: { active: true, source } }));
}

function endPreview(source = 'preview') {
    previewDepth = Math.max(0, previewDepth - 1);
    if (previewDepth) return;
    document.documentElement.removeAttribute('data-chamber-categories-preview');
    window.dispatchEvent(new CustomEvent('tezos:chamber-category-preview', { detail: { active: false, source } }));
}

function showUndoToast(item, keyboardTriggered, type) {
    enqueueToast({
        priority: 1,
        duration: 6500,
        show(done, duration) {
            const toast = document.createElement('div');
            toast.className = 'home-layout-toast';
            toast.setAttribute('role', 'status');
            toast.innerHTML = `<span>${item.label} hidden</span><span aria-hidden="true">·</span><button type="button">Undo</button>`;
            document.body.appendChild(toast);
            const undo = toast.querySelector('button');
            let timer = 0;
            const finish = ({ restoreFallback = false } = {}) => {
                if (!toast.isConnected) return;
                window.clearTimeout(timer);
                const ownedFocus = toast.contains(document.activeElement);
                toast.classList.add('is-leaving');
                window.setTimeout(() => {
                    toast.remove();
                    if (restoreFallback && ownedFocus) {
                        document.getElementById('customize-home-btn')?.focus({ preventScroll: true });
                    }
                    done();
                }, 160);
            };
            undo.addEventListener('click', () => {
                if (type === 'room') setChamberRoomVisible(item.id, true, 'undo');
                else setChamberCategoryVisible(item.key, true, 'undo');
                finish();
                requestAnimationFrame(() => {
                    const selector = type === 'room'
                        ? `[data-chamber-room-hide="${item.id}"]`
                        : `[data-chamber-category-hide="${item.key}"]`;
                    document.querySelector(selector)?.focus({ preventScroll: true });
                });
            });
            requestAnimationFrame(() => {
                toast.classList.add('is-visible');
                if (keyboardTriggered) undo.focus({ preventScroll: true });
            });
            timer = window.setTimeout(() => finish({ restoreFallback: keyboardTriggered }), duration);
        }
    });
}

function applyStoredPreference(preference, source) {
    const nextCategories = new Set(preference.hiddenCategories);
    const nextRooms = new Set(preference.hiddenRooms);
    const changedCategories = CHAMBER_CATEGORY_META.filter((category) => (
        hiddenCategoryIds.has(category.key) !== nextCategories.has(category.key)
    ));
    const changedRooms = ROOM_IDS.filter((id) => hiddenRoomIds.has(id) !== nextRooms.has(id));
    if (!changedCategories.length && !changedRooms.length) return;

    const firstHiddenRoom = changedRooms.find((id) => !hiddenRoomIds.has(id) && nextRooms.has(id));
    const firstHiddenCategory = changedCategories.find((category) => (
        !hiddenCategoryIds.has(category.key) && nextCategories.has(category.key)
    ));
    const nextShown = shownRoomCount(nextCategories, nextRooms);
    const anchor = nextShown === 0 ? null : firstHiddenRoom
        ? captureLayoutAnchor(firstHiddenRoom, 'room', nextCategories, nextRooms)
        : firstHiddenCategory
            ? captureLayoutAnchor(firstHiddenCategory.key, 'category', nextCategories, nextRooms)
            : null;
    hiddenCategoryIds = nextCategories;
    hiddenRoomIds = nextRooms;
    syncRootState();
    syncControls();
    syncExploreVisibility(source);
    preserveLayoutAnchor(anchor);
    changedCategories.forEach((category) => (
        dispatchChange(category.key, !hiddenCategoryIds.has(category.key), source, 'category')
    ));
    changedRooms.forEach((id) => dispatchChange(id, isChamberRoomVisible(id), source, 'room'));
}

function syncFromStorage(event) {
    if (event.key !== EXPLORE_LAYOUT_STORAGE_KEY) return;
    let next = { hiddenCategories: [], hiddenRooms: [] };
    try {
        next = event.newValue === null
            ? next
            : (normalizePreference(JSON.parse(event.newValue)) || next);
    } catch (_) {}
    applyStoredPreference(next, 'storage');
}

export function initChamberCategories() {
    if (initialized) return;
    initialized = true;
    const preference = readPreference();
    hiddenCategoryIds = new Set(preference.hiddenCategories);
    hiddenRoomIds = new Set(preference.hiddenRooms);
    syncRootState();
    syncControls();
    syncExploreVisibility('init');

    document.querySelectorAll('[data-chamber-category-toggle]').forEach((input) => {
        input.addEventListener('change', () => {
            setChamberCategoryVisible(input.dataset.chamberCategoryToggle, input.checked, 'panel');
        });
    });
    document.querySelectorAll('[data-chamber-room-toggle]').forEach((input) => {
        input.addEventListener('change', () => {
            setChamberRoomVisible(input.dataset.chamberRoomToggle, input.checked, 'panel');
        });
    });
    document.getElementById('chamber-category-show-all')?.addEventListener('click', () => {
        showAllChamberCategories();
    });
    document.addEventListener('click', (event) => {
        const categoryButton = event.target.closest('[data-chamber-category-hide]');
        if (categoryButton?.isConnected) {
            event.preventDefault();
            event.stopPropagation();
            const category = categoryFor(categoryButton.dataset.chamberCategoryHide);
            if (!category) return;
            const keyboardTriggered = event.detail === 0;
            if (setChamberCategoryVisible(category.key, false, keyboardTriggered ? 'inline-keyboard' : 'inline-pointer')) {
                showUndoToast(category, keyboardTriggered, 'category');
            }
            return;
        }
        const roomButton = event.target.closest('[data-chamber-room-hide]');
        if (!roomButton?.isConnected) return;
        event.preventDefault();
        event.stopPropagation();
        const room = roomFor(roomButton.dataset.chamberRoomHide);
        if (!room) return;
        const keyboardTriggered = event.detail === 0;
        if (setChamberRoomVisible(room.id, false, keyboardTriggered ? 'inline-keyboard' : 'inline-pointer')) {
            showUndoToast(room, keyboardTriggered, 'room');
        }
    }, true);
    window.addEventListener('storage', syncFromStorage);
    window.addEventListener('tezos:home-layout-change', (event) => {
        if (event.detail?.id === 'explore' && event.detail.visible && shownRoomCount() === 0) {
            showAllChamberCategories('explore-recovery', { revealExplore: false });
        }
    });

    window.tezosSystemsChamberCategories = Object.freeze({
        beginPreview,
        endPreview,
        initChamberCategories,
        isChamberCategoryVisible,
        isChamberRoomVisible,
        setChamberCategoryVisible,
        setChamberRoomVisible,
        showAllChamberCategories
    });
}
