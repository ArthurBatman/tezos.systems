/**
 * Tezos Systems - Visit Streak Counter
 * Tracks consecutive daily visits using localStorage
 */

const STORAGE_KEY_COUNT = 'tezos_streak_count';
const STORAGE_KEY_LAST = 'tezos_streak_last_visit';
const STREAK_TOAST_DURATION = 6400;
const MILESTONE_TOAST_DURATION = 11000;
const MILESTONES = new Set([7, 14, 30, 60, 100, 365]);
const STREAK_SCOPE_COPY = 'Browser-local · Details in Settings → Visit streak.';
const MILESTONE_COPY = {
    7: '🍞 One week in the bakery.',
    14: '🍞 Two weeks. The oven knows you now.',
    30: "🥖 30 days — you've watched dozens of cycles pass.",
    60: '🥖 60 days of showing up.',
    100: '🏛️ 100 days. Practically furniture.',
    365: '🎂 A full year — and at least one protocol upgrade you lived through.'
};

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

/**
 * Format the streak text
 */
function formatStreak(count) {
    if (count === 1) {
        return `🔥 Day 1 · ${STREAK_SCOPE_COPY} Come back tomorrow to start a streak.`;
    }
    if (MILESTONE_COPY[count]) {
        return `${MILESTONE_COPY[count]} ${STREAK_SCOPE_COPY}`;
    }
    return `🔥 ${count}-day visit streak · ${STREAK_SCOPE_COPY}`;
}

function renderCurrentStreak(count) {
    const current = document.getElementById('visit-streak-current');
    if (!current) return;
    current.textContent = count > 0
        ? `Current streak: ${count} day${count === 1 ? '' : 's'}`
        : 'No visit streak yet';
}

async function shareStreakMilestone(count, copy, button) {
    const originalText = button?.textContent || '';
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
                <div style="font-size:14px;font-weight:800;color:rgba(255,255,255,0.42);letter-spacing:0;text-transform:uppercase;">Visit streak</div>
                <div style="font-size:56px;line-height:1.04;font-weight:900;color:#ffffff;overflow-wrap:anywhere;">${copy}</div>
                <div style="margin-top:auto;font-size:24px;font-weight:800;color:#00ff88;">${count.toLocaleString()} days straight watching Tezos run.</div>
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
            label: '🔥 Streak',
            text: `${count} days straight checking the Tezos network. Mainnet history stretches back to September 2018.\n\ntezos.systems`
        }], 'Tezos Streak');
    } catch (error) {
        console.error('Failed to share streak milestone', error);
    } finally {
        if (card?.isConnected) card.remove();
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function showStreakToast({ text, shareText = text, count, isMilestone }, done, duration = 6000) {
    const badge = document.createElement('div');
    badge.className = 'visit-streak-toast';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    if (isMilestone) badge.classList.add('milestone');

    if (isMilestone) {
        const copy = document.createElement('span');
        copy.className = 'visit-streak-copy';
        copy.textContent = text;
        const share = document.createElement('button');
        share.className = 'visit-streak-share';
        share.type = 'button';
        share.textContent = 'Share';
        share.addEventListener('click', (event) => {
            event.stopPropagation();
            shareStreakMilestone(count, shareText, share);
        });
        badge.append(copy, share);
    } else {
        badge.textContent = text;
    }

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

    const isMilestone = MILESTONES.has(count);
    enqueueToast({
        priority: 3,
        duration: isMilestone ? MILESTONE_TOAST_DURATION : STREAK_TOAST_DURATION,
        show: (done, duration) => showStreakToast({
            text: formatStreak(count),
            shareText: MILESTONE_COPY[count],
            count,
            isMilestone
        }, done, duration)
    });
}
