/**
 * Stat-card loading, first-arrival, and live-value motion.
 */

import { cancelMagic, tweenNumber, revealValue, setMagicNumber } from '../effects/data-magic.js';

const LOADING_COPY = {
    'total-bakers': 'Preheating the baker board',
    'tz4-adoption': 'Counting fresh keys',
    'cycle-progress': "Dough's rising",
    'network-health': 'Checking the bake',
    'issuance-rate': 'Proofing the numbers',
    'staking-apy': 'Warming the yield',
    'staking-ratio': 'Measuring the rise',
    delegated: 'Counting delegated dough',
    'total-supply': 'Sifting supply',
    'total-burned': 'Tending the oven',
    'baking-power': 'Weighing baking power',
    'reward-accounts': 'Counting staking roles',
    proposal: 'Opening the governance oven',
    'voting-period': 'Checking the voting clock',
    participation: 'Counting baker ballots',
    'tx-volume': 'Reading the mempool',
    'contract-calls': 'Counting contract calls',
    'funded-accounts': 'Finding funded wallets',
    'new-accounts': 'Spotting fresh wallets',
    'smart-contracts': 'Counting contracts',
    tokens: 'Sorting token shelves',
    rollups: 'Checking rollups',
    'active-contracts': 'Finding active contracts'
};

function loadingCopyFor(cardId) {
    return LOADING_COPY[cardId] || "Dough's rising";
}

function clearLoadingState(element) {
    if (!element) return;
    const loadingCopy = element.dataset.loadingCopy;
    element.classList.remove('loading');
    delete element.dataset.loadingCopy;
    if (loadingCopy && element.getAttribute('aria-label') === loadingCopy) {
        element.removeAttribute('aria-label');
    }
}

const pendingStatReveals = new WeakMap();

function invalidateStatReveal(element) {
    if (!element) return null;
    const pending = pendingStatReveals.get(element);
    if (pending?.timer) clearTimeout(pending.timer);
    pendingStatReveals.delete(element);
    return pending || null;
}

function cancelStatReveal(element) {
    if (!element) return;
    const pending = invalidateStatReveal(element);
    cancelMagic(element, {
        preserveSelection: true,
        additionalCancel: pending?.cancel
    });
}

function writeStatInstant(element, text) {
    if (!element) return;
    cancelStatReveal(element);
    setMagicNumber(element, String(text), {
        force: true,
        animate: false,
        animateInitial: false
    });
    clearLoadingState(element);
}

/**
 * Reconcile a changed live stat in place.
 *
 * The historical name remains for callers, but background data no longer
 * flips the whole card or waits through a 600ms transition. The hidden back
 * face is settled immediately and the visible front receives one theme-aware
 * value transition only when its formatted value changed.
 *
 * @param {HTMLElement} cardElement - The stat card element
 * @param {string|number} newValue - New value to display
 * @param {Function} formatter - Formatter function for the value
 * @returns {Promise<boolean>} Whether a visible value transition started
 */
export async function flipCard(cardElement, newValue, formatter) {
    if (!cardElement) {
        console.warn('Card element not found');
        return false;
    }

    const statType = cardElement.getAttribute('data-stat');
    const frontValue = cardElement.querySelector(`#${statType}-front`);
    const backValue = cardElement.querySelector(`#${statType}-back`);
    if (!frontValue || !backValue) {
        console.warn('Card value element not found');
        return false;
    }

    const formattedValue = String(formatter ? formatter(newValue) : newValue);
    cancelStatReveal(frontValue);
    cancelStatReveal(backValue);
    clearLoadingState(frontValue);
    clearLoadingState(backValue);

    // Keep the hidden face truthful without causing an unnecessary mutation.
    setMagicNumber(backValue, formattedValue, {
        force: true,
        animate: false,
        animateInitial: false
    });

    const animated = setMagicNumber(frontValue, formattedValue, {
        force: true,
        animateInitial: false
    });
    return animated;
}

/**
 * Update stat value without animation (instant)
 * @param {string} cardId - ID of the stat card
 * @param {string|number} value - Value to display
 * @param {Function} formatter - Formatter function
 */
export function updateStatInstant(cardId, value, formatter) {
    const card = document.querySelector(`[data-stat="${cardId}"]`);
    if (!card) return;

    const statType = cardId;
    const formattedValue = formatter ? formatter(value) : value;

    // Update both front and back faces
    const frontValue = card.querySelector(`#${statType}-front`);
    const backValue = card.querySelector(`#${statType}-back`);

    writeStatInstant(frontValue, formattedValue);
    writeStatInstant(backValue, formattedValue);
}

// Cascading stagger so first-load reveals ripple instead of firing in lockstep.
let revealSeq = 0;
let revealResetTimer = null;
const REVEAL_STAGGER_MS = 45;
const REVEAL_STAGGER_MAX = 12; // cap the cascade length

function nextRevealDelay() {
    const delay = Math.min(revealSeq, REVEAL_STAGGER_MAX) * REVEAL_STAGGER_MS;
    revealSeq++;
    if (revealResetTimer) clearTimeout(revealResetTimer);
    revealResetTimer = setTimeout(() => { revealSeq = 0; }, 400);
    return delay;
}

/**
 * Reveal a stat value on first load with magic: numbers count up (odometer),
 * strings decode in (scramble). Falls back to an instant set under reduced motion.
 * Drop-in replacement for updateStatInstant on the first-load path.
 *
 * @param {string} cardId
 * @param {string|number} value  raw value (number → count-up, string → scramble)
 * @param {Function} formatter   value → display string
 */
export function revealStat(cardId, value, formatter) {
    const card = document.querySelector(`[data-stat="${cardId}"]`);
    if (!card) return;

    const frontValue = card.querySelector(`#${cardId}-front`);
    const backValue = card.querySelector(`#${cardId}-back`);
    const apply = (el, str) => {
        if (!el) return;
        writeStatInstant(el, str);
    };

    const isNumeric = typeof value === 'number' && Number.isFinite(value);
    const finalStr = formatter ? formatter(value) : String(value);

    // Back face holds the settled value immediately (it's hidden on first load).
    apply(backValue, finalStr);

    if (!frontValue) return;
    cancelStatReveal(frontValue);
    clearLoadingState(frontValue);

    const delay = nextRevealDelay();
    const pending = { timer: null, cancel: null, finalText: finalStr };
    pendingStatReveals.set(frontValue, pending);
    const run = () => {
        if (pendingStatReveals.get(frontValue) !== pending) return;
        pending.timer = null;
        const onDone = () => {
            frontValue.__dmMagicFinalText = finalStr;
            if (pendingStatReveals.get(frontValue) === pending) {
                pendingStatReveals.delete(frontValue);
            }
        };
        if (isNumeric) {
            pending.cancel = tweenNumber(frontValue, 0, value, { formatter, onDone });
        } else {
            pending.cancel = revealValue(frontValue, finalStr, { onDone });
        }
    };
    if (delay > 0) {
        pending.timer = setTimeout(run, delay);
    }
    else run();
}

/**
 * Show loading state on a stat card
 * @param {string} cardId - ID of the stat card
 */
export function showLoading(cardId) {
    const card = document.querySelector(`[data-stat="${cardId}"]`);
    if (card) {
        const frontValue = card.querySelector(`#${cardId}-front`);
        const backValue = card.querySelector(`#${cardId}-back`);
        const copy = loadingCopyFor(cardId);

        [frontValue, backValue].forEach((valueEl) => {
            if (!valueEl) return;
            writeStatInstant(valueEl, copy);
            valueEl.dataset.loadingCopy = copy;
            valueEl.setAttribute('aria-label', copy);
            valueEl.classList.add('loading');
        });
    }
}

/**
 * Show error state on a stat card
 * @param {string} cardId - ID of the stat card
 * @param {string} message - Error message
 */
export function showError(cardId, message = "Didn't load — retrying next refresh") {
    updateStatInstant(cardId, message, null);

    const card = document.querySelector(`[data-stat="${cardId}"]`);
    if (card) {
        const frontValue = card.querySelector(`#${cardId}-front`);
        const backValue = card.querySelector(`#${cardId}-back`);

        if (frontValue) {
            frontValue.classList.add('error-state');
            clearLoadingState(frontValue);
        }
        if (backValue) {
            backValue.classList.add('error-state');
            clearLoadingState(backValue);
        }
    }
}
