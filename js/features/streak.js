/**
 * Tezos Systems - Visit Streak Counter
 * Tracks consecutive daily visits using localStorage
 */

const STORAGE_KEY_COUNT = 'tezos_streak_count';
const STORAGE_KEY_LAST = 'tezos_streak_last_visit';
const SIGNAL_TOAST_DURATION = 11000;
const SIGNAL_MOMENTS = Object.freeze({
    7: { kind: 'numerology', kicker: 'First signal', glyph: '✦', message: 'A pattern appears.' },
    10: { kind: 'round', kicker: 'Landmark signal', glyph: '◇', message: 'Double digits. The counter has awakened.' },
    11: { kind: 'master', kicker: 'Master signal', glyph: '✦', message: 'The signal echoes.' },
    22: { kind: 'master', kicker: 'Master signal', glyph: '✦', message: 'The pattern holds.' },
    33: { kind: 'master', kicker: 'Master signal', glyph: '✦', message: 'Still in tune.' },
    100: { kind: 'round', kicker: 'Landmark signal', glyph: '◇', message: 'Triple digits. Okay, now this is a thing.' },
    111: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'The signal repeats.' },
    222: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'The pattern found you again.' },
    333: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'Three threes. Still tuned in.' },
    365: { kind: 'orbit', kicker: 'One full orbit', glyph: '◌', message: 'Still circling Tezos.' },
    444: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'Four keeps knocking.' },
    555: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'The pattern refuses to be subtle.' },
    666: { kind: 'repeating', kicker: 'Unusual frequency', glyph: '⁂', message: 'Probably fine.' },
    777: { kind: 'repeating', kicker: 'Lucky signal', glyph: '⁂', message: 'Obviously.' },
    888: { kind: 'repeating', kicker: 'Repeating signal', glyph: '⁂', message: 'The loop keeps looping.' },
    999: { kind: 'repeating', kicker: 'Threshold signal', glyph: '⁂', message: 'One step from four digits.' },
    1000: { kind: 'round', kicker: 'Four-digit signal', glyph: '◇', message: 'You stayed.' },
    1111: { kind: 'repeating', kicker: 'Gateway signal', glyph: '⁂', message: 'The signal became a doorway.' }
});

import { enqueueToast } from '../ui/toast-queue.js';

/**
 * Get today's date string in user's local timezone (YYYY-MM-DD)
 */
function getToday(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Get yesterday's date string in user's local timezone
 */
function getYesterday(now = new Date()) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
}

/**
 * Calculate and update the streak.
 * didAdvance is false for same-day reloads so they stay silent.
 */
function updateStreak(now = new Date()) {
    const today = getToday(now);
    const lastVisit = localStorage.getItem(STORAGE_KEY_LAST);
    let count = parseInt(localStorage.getItem(STORAGE_KEY_COUNT), 10) || 0;
    let isFirstVisit = false;

    if (!lastVisit) {
        // First ever visit
        isFirstVisit = true;
        count = 1;
    } else if (lastVisit === today) {
        // Same day revisit — no change
        return { count, isFirstVisit: false, didAdvance: false };
    } else if (lastVisit === getYesterday(now)) {
        // Consecutive day
        count += 1;
    } else {
        // Missed a day — reset
        count = 1;
    }

    localStorage.setItem(STORAGE_KEY_COUNT, count);
    localStorage.setItem(STORAGE_KEY_LAST, today);
    return { count, isFirstVisit, didAdvance: true };
}

function renderCurrentStreak(count) {
    const current = document.getElementById('visit-streak-current');
    if (!current) return;
    current.textContent = count > 0
        ? `Current streak: ${count} day${count === 1 ? '' : 's'}`
        : 'No visit streak yet';
}

async function shareStreakSignal(count, moment, button) {
    const originalText = button?.textContent || '';
    const formattedCount = count.toLocaleString('en-US');
    let card = null;
    try {
        if (button) {
            button.disabled = true;
            button.textContent = '...';
        }
        const { loadHtml2Canvas, showShareModal, appendCardSeal } = await import('../ui/share.js');
        await loadHtml2Canvas();

        card = document.createElement('div');
        card.style.cssText = `
            position:fixed;left:-9999px;top:-9999px;width:680px;min-height:420px;
            display:flex;flex-direction:column;gap:24px;padding:34px;
            color:#f7fbff;background:#0a0e1a;border:1px solid rgba(0,255,136,0.18);
            border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            box-shadow:0 22px 80px rgba(0,0,0,0.34);box-sizing:border-box;overflow:hidden;
        `;
        card.innerHTML = `
            <div style="position:absolute;inset:0;background:linear-gradient(rgba(0,255,136,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.025) 1px,transparent 1px);background-size:22px 22px;pointer-events:none;"></div>
            <div style="position:relative;z-index:1;display:flex;flex-direction:column;gap:18px;flex:1;">
                <div style="font-family:Orbitron,sans-serif;font-size:18px;font-weight:900;color:#00ff88;letter-spacing:0;text-transform:uppercase;">TEZOS SYSTEMS</div>
                <div style="width:180px;height:1px;background:#00ff88;opacity:0.48;"></div>
                <div style="font-size:14px;font-weight:800;color:rgba(255,255,255,0.42);letter-spacing:0;text-transform:uppercase;">Hidden signal · Day ${formattedCount}</div>
                <div style="font-size:56px;line-height:1.04;font-weight:900;color:#ffffff;overflow-wrap:anywhere;">${moment.message}</div>
                <div style="margin-top:auto;font-size:24px;font-weight:800;color:#00ff88;">${formattedCount} days straight watching Tezos run.</div>
            </div>
        `;
        appendCardSeal(card);
        document.body.appendChild(card);

        const canvas = await window.html2canvas(card, {
            backgroundColor: '#0a0e1a',
            scale: 2,
            useCORS: true,
            logging: false
        });
        card.remove();
        card = null;

        showShareModal(canvas, [{
            label: '✦ Signal',
            text: `Day ${formattedCount}: ${moment.message}\n\nI found a hidden signal at tezos.systems`
        }], 'Tezos Signal');
    } catch (error) {
        console.error('Failed to share visit signal', error);
    } finally {
        if (card?.isConnected) card.remove();
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function appendSignalDigits(number, count) {
    Array.from(count.toLocaleString('en-US')).forEach((character) => {
        const digit = document.createElement('span');
        digit.className = character === ',' ? 'signal-bloom-separator' : 'signal-bloom-digit';
        digit.textContent = character;
        number.append(digit);
    });
}

function showSignalBloom({ count, moment }, done, duration = SIGNAL_TOAST_DURATION) {
    const formattedCount = count.toLocaleString('en-US');
    const badge = document.createElement('div');
    badge.className = 'visit-streak-toast signal-bloom milestone';
    badge.setAttribute('data-signal-kind', moment.kind);
    badge.setAttribute('data-streak-count', String(count));

    const announcement = document.createElement('span');
    announcement.className = 'signal-bloom-announcement';
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.textContent = `${moment.kicker}. Day ${formattedCount}. ${moment.message}`;

    const sigil = document.createElement('span');
    sigil.className = 'signal-bloom-sigil';
    sigil.setAttribute('aria-hidden', 'true');
    const outerRing = document.createElement('span');
    outerRing.className = 'signal-bloom-ring signal-bloom-ring-outer';
    const innerRing = document.createElement('span');
    innerRing.className = 'signal-bloom-ring signal-bloom-ring-inner';
    const glyph = document.createElement('span');
    glyph.className = 'signal-bloom-glyph';
    glyph.textContent = moment.glyph;
    sigil.append(outerRing, innerRing, glyph);

    const content = document.createElement('div');
    content.className = 'signal-bloom-content';
    const kicker = document.createElement('span');
    kicker.className = 'signal-bloom-kicker';
    kicker.textContent = moment.kicker;
    const numberRow = document.createElement('span');
    numberRow.className = 'signal-bloom-number-row';
    numberRow.setAttribute('aria-hidden', 'true');
    const day = document.createElement('span');
    day.className = 'signal-bloom-day';
    day.textContent = 'Day';
    const number = document.createElement('strong');
    number.className = 'signal-bloom-number';
    appendSignalDigits(number, count);
    numberRow.append(day, number);
    const message = document.createElement('span');
    message.className = 'signal-bloom-message';
    message.textContent = moment.message;
    const share = document.createElement('button');
    share.className = 'signal-bloom-share';
    share.type = 'button';
    share.textContent = 'Share the signal';
    share.setAttribute('aria-label', `Share the Day ${formattedCount} signal`);
    share.addEventListener('click', (event) => {
        event.stopPropagation();
        shareStreakSignal(count, moment, share);
    });
    content.append(kicker, numberRow, message, share);
    badge.append(announcement, sigil, content);

    document.body.appendChild(badge);
    requestAnimationFrame(() => badge.classList.add('visible'));

    setTimeout(() => {
        badge.classList.remove('visible');
        setTimeout(() => {
            badge.remove();
            done?.();
        }, 500);
    }, duration);
}

/**
 * Create and display the streak badge
 */
export function initStreak(now = new Date()) {
    const { count, isFirstVisit, didAdvance } = updateStreak(now);
    renderCurrentStreak(count);

    // A first visit starts the counter silently, and a full reload on the same
    // calendar day should not replay a streak the visitor already saw.
    if (isFirstVisit || !didAdvance) return;

    const moment = SIGNAL_MOMENTS[count];
    // Ordinary days, missed-day resets, and non-special round numbers advance
    // quietly. The sparse signal catalog is meant to be discovered by chance.
    if (!moment) return;

    enqueueToast({
        priority: 3,
        duration: SIGNAL_TOAST_DURATION,
        show: (done, duration) => showSignalBloom({ count, moment }, done, duration)
    });
}
