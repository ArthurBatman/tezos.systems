/**
 * Stat-card loading, first-arrival, and live-value motion.
 */

import {
    cancelFresh,
    pulseFresh,
    setMagicValue
} from '../effects/data-magic.js';

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
    element.classList.remove('loading', 'error-state');
    delete element.dataset.loadingCopy;
    if (loadingCopy && element.getAttribute('aria-label') === loadingCopy) {
        element.removeAttribute('aria-label');
    }
}

function statFreshSurface(element) {
    const card = element?.closest?.('[data-stat]');
    return card?.querySelector('.card-inner') || card || element;
}

function hasStatMotion(element) {
    return Boolean(element?.__dmMagicCancel);
}

function statTargetState(element, finalText) {
    const active = hasStatMotion(element);
    return {
        sameActive: active && element.__dmMagicFinalText === finalText,
        sameSettled: !active && element.textContent.trim() === finalText
    };
}

function writeStatInstant(element, text) {
    if (!element) return;
    cancelFresh(statFreshSurface(element));
    setMagicValue(element, String(text), {
        animate: false
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
 * @returns {boolean} Whether a visible value transition started
 */
export function flipCard(cardElement, newValue, formatter) {
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
    const {
        sameActive: sameActiveTarget,
        sameSettled: sameSettledTarget
    } = statTargetState(frontValue, formattedValue);
    if (!(sameActiveTarget || sameSettledTarget)) {
        cancelFresh(statFreshSurface(frontValue));
    }
    clearLoadingState(frontValue);
    clearLoadingState(backValue);

    // Keep the hidden face truthful without causing an unnecessary mutation.
    setMagicValue(backValue, formattedValue, { animate: false });

    if (sameSettledTarget) return false;

    const animated = setMagicValue(frontValue, formattedValue, {
        force: true,
        animateInitial: true
    });
    if (animated) pulseFresh(cardElement.querySelector('.card-inner') || cardElement);
    else if (sameActiveTarget && !hasStatMotion(frontValue)) {
        cancelFresh(statFreshSurface(frontValue));
    }
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

/**
 * Reveal a stat value on first load with the active theme personality.
 * Falls back to an instant set under reduced motion or outside the viewport.
 * Drop-in replacement for updateStatInstant on the first-load path.
 *
 * @param {string} cardId
 * @param {string|number} value  raw value
 * @param {Function} formatter   value → display string
 */
export function revealStat(cardId, value, formatter) {
    const card = document.querySelector(`[data-stat="${cardId}"]`);
    if (!card) return;

    const frontValue = card.querySelector(`#${cardId}-front`);
    const backValue = card.querySelector(`#${cardId}-back`);
    const finalStr = String(formatter ? formatter(value) : value);

    // Back face holds the settled value immediately (it's hidden on first load).
    if (backValue) {
        setMagicValue(backValue, finalStr, { animate: false });
        clearLoadingState(backValue);
    }

    if (!frontValue) return;
    const {
        sameActive: sameActiveTarget,
        sameSettled: sameSettledTarget
    } = statTargetState(frontValue, finalStr);
    if (sameSettledTarget) {
        clearLoadingState(frontValue);
        return;
    }
    if (sameActiveTarget) {
        setMagicValue(frontValue, finalStr, {
            force: true,
            animateInitial: true
        });
        if (!hasStatMotion(frontValue)) cancelFresh(statFreshSurface(frontValue));
        clearLoadingState(frontValue);
        return;
    }

    cancelFresh(statFreshSurface(frontValue));
    clearLoadingState(frontValue);
    const animated = setMagicValue(frontValue, finalStr, {
        force: true,
        animateInitial: true
    });
    if (animated) pulseFresh(card.querySelector('.card-inner') || card);
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
            clearLoadingState(frontValue);
            frontValue.classList.add('error-state');
        }
        if (backValue) {
            clearLoadingState(backValue);
            backValue.classList.add('error-state');
        }
    }
}
