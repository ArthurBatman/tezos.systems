/**
 * Valley background lifecycle.
 *
 * The substantial painterly renderer stays out of the critical module graph:
 * it is imported only when Valley is active. A generation guard prevents a
 * late import from mounting after a rapid theme-picker preview has moved on.
 */

const VALLEY_THEME = 'valley';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let activeEffect = null;
let effectModulePromise = null;
let requestGeneration = 0;
let lastStatsDetail = null;

function rememberStats(event) {
    if (event?.detail?.stats && typeof event.detail.stats === 'object') {
        lastStatsDetail = {
            ...event.detail,
            stats: { ...event.detail.stats }
        };
    }
}

function stopActiveEffect() {
    const effect = activeEffect;
    activeEffect = null;
    effect?.stop?.();
}

function loadEffectModule() {
    if (!effectModulePromise) {
        effectModulePromise = import('./valley-effects.js').catch((error) => {
            effectModulePromise = null;
            throw error;
        });
    }
    return effectModulePromise;
}

export async function syncValleyEffect(theme = document.body?.getAttribute('data-theme')) {
    const generation = ++requestGeneration;
    const shouldRun = theme === VALLEY_THEME && !reducedMotion.matches;

    if (!shouldRun) {
        stopActiveEffect();
        return null;
    }
    if (activeEffect) return activeEffect;

    try {
        const module = await loadEffectModule();
        if (
            generation !== requestGeneration
            || document.body?.getAttribute('data-theme') !== VALLEY_THEME
            || reducedMotion.matches
        ) {
            return null;
        }

        const factory = module.createValleyEffect || module.default;
        if (typeof factory !== 'function') {
            throw new TypeError('valley-effects.js must export createValleyEffect()');
        }

        const effect = await factory();
        if (
            generation !== requestGeneration
            || document.body?.getAttribute('data-theme') !== VALLEY_THEME
            || reducedMotion.matches
        ) {
            effect?.stop?.();
            return null;
        }

        effect?.seedStats?.(lastStatsDetail);
        try {
            effect?.start?.();
        } catch (error) {
            effect?.stop?.();
            throw error;
        }
        activeEffect = effect;
        return activeEffect;
    } catch (error) {
        if (generation === requestGeneration) {
            console.error('Valley background could not start:', error);
        }
        return null;
    }
}

window.addEventListener('themechange', (event) => {
    void syncValleyEffect(event.detail?.theme);
});
window.addEventListener('stats-updated', rememberStats);

const handleMotionPreference = () => {
    void syncValleyEffect();
};
if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', handleMotionPreference);
} else {
    reducedMotion.addListener(handleMotionPreference);
}

void syncValleyEffect();
