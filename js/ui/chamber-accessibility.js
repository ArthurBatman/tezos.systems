/**
 * Shared accessibility wiring for Chamber launch cards and modal dialogs.
 */

const DIALOG_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

const dialogStates = new WeakMap();

function visibleFocusableElements(root) {
    return [...root.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)].filter((element) => (
        element.getAttribute('aria-hidden') !== 'true'
        && !element.closest('[hidden]')
        && element.getClientRects().length > 0
    ));
}

function ensureLauncherTitle(card, titleSelector, fallbackId) {
    const title = card.querySelector(titleSelector || 'h1, h2, h3, .stat-label');
    if (!title) return '';
    if (!title.id) title.id = fallbackId;
    return title.id;
}

function ensureOpenButton(card, label) {
    window.syncChamberEntryFooters?.(card.parentElement || document);
    let cue = card.querySelector('.chamber-entry-footer > .chamber-expand-cue');
    if (!cue) return null;

    if (cue.tagName !== 'BUTTON') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = cue.className;
        button.innerHTML = cue.innerHTML;
        cue.replaceWith(button);
        cue = button;
    }
    cue.type = 'button';
    cue.removeAttribute('aria-hidden');
    cue.setAttribute('aria-label', label);
    cue.title = label;
    return cue;
}

export function findChamberLauncher(cardSelector) {
    return document.querySelector(cardSelector)?.querySelector('.chamber-expand-cue') || null;
}

/**
 * Make a Chamber card a labelled article with one explicit native Open action.
 */
export function wireChamberLauncher(card, {
    open,
    label,
    titleSelector = 'h1, h2, h3, .stat-label'
} = {}) {
    if (!card || typeof open !== 'function') return null;

    const titleId = ensureLauncherTitle(card, titleSelector, `${card.id || card.dataset.stat || 'chamber'}-title`);
    card.setAttribute('role', 'article');
    if (titleId) card.setAttribute('aria-labelledby', titleId);
    else card.setAttribute('aria-label', label);
    card.removeAttribute('tabindex');
    card.removeAttribute('title');
    card.style.cursor = 'default';

    const button = ensureOpenButton(card, label);
    if (!button) return null;
    if (button.dataset.chamberOpenWired !== '1') {
        button.dataset.chamberOpenWired = '1';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
        });
    }
    return button;
}

/**
 * Activate an existing Chamber overlay as a keyboard-contained modal dialog.
 */
export function activateChamberDialog(overlay, {
    close,
    dialogSelector = '[role="dialog"], .chamber-content',
    titleId = '',
    label = '',
    initialFocusSelector = '.chamber-close'
} = {}) {
    if (!overlay || typeof close !== 'function') return;
    const dialog = overlay.querySelector(dialogSelector);
    if (!dialog) return;

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');
    if (titleId) dialog.setAttribute('aria-labelledby', titleId);
    if (label) dialog.setAttribute('aria-label', label);
    overlay.setAttribute('aria-hidden', 'false');

    if (!dialogStates.has(overlay)) {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const keydown = (event) => {
            if (!overlay.classList.contains('active')) return;

            const foreignDialog = event.target?.closest?.('[role="dialog"]');
            if (foreignDialog && foreignDialog !== dialog && !dialog.contains(foreignDialog)) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = visibleFocusableElements(dialog);
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus({ preventScroll: true });
                return;
            }

            const first = focusable[0];
            const last = focusable.at(-1);
            if (!dialog.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus({ preventScroll: true });
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        dialogStates.set(overlay, { opener, keydown });
        document.addEventListener('keydown', keydown, true);
    }

    window.requestAnimationFrame(() => {
        const target = dialog.querySelector(initialFocusSelector)
            || visibleFocusableElements(dialog)[0]
            || dialog;
        target.focus({ preventScroll: true });
    });
}

/**
 * Deactivate a Chamber dialog and return focus to the control that opened it.
 */
export function deactivateChamberDialog(overlay) {
    if (!overlay) return;
    const state = dialogStates.get(overlay);
    if (state) {
        document.removeEventListener('keydown', state.keydown, true);
        dialogStates.delete(overlay);
    }
    overlay.setAttribute('aria-hidden', 'true');

    if (state?.opener?.isConnected && state.opener !== document.body) {
        window.requestAnimationFrame(() => state.opener.focus({ preventScroll: true }));
    }
}
