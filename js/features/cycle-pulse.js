/**
 * Cycle Pulse — Integrated into protocol panel
 * Shows: C#### · ──bar── · XX.X% · 🟢 Xs ago
 */

import { enqueueToast } from '../ui/toast-queue.js';
import { pulseFresh } from '../effects/data-magic.js';

const STREAK_KEY = 'tezos-systems-cycle-streak';
const STRIP_ID   = 'cycle-pulse-strip';

let strip = null;
let lastCycle = null;
let cycleWhispered = false;

function injectStyles() {
  if (document.getElementById('cycle-pulse-styles')) return;
  const s = document.createElement('style');
  s.id = 'cycle-pulse-styles';
  s.textContent = `
    #${STRIP_ID} {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 0; overflow: hidden; padding: 0; margin: 0; border: none;
      font-family: 'Orbitron', 'SF Mono', 'Menlo', monospace;
      font-size: 11px;
      letter-spacing: .06em;
      color: var(--text-secondary);
      border-top: 1px solid rgba(255,255,255,0.06);
      margin-top: 8px;
      padding-top: 8px;
      white-space: nowrap;
      overflow: hidden;
      flex-wrap: nowrap;
    }
    #${STRIP_ID} .cps-cycle {
      color: var(--accent);
      font-weight: 700;
    }
    #${STRIP_ID} .cps-sep {
      opacity: .35;
      margin: 0 2px;
    }
    #${STRIP_ID} .cps-pct {
      min-width: 50px;
      text-align: right;
      letter-spacing: 0;
      color: var(--text-primary);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    #${STRIP_ID} .cps-bar {
      width: 160px;
      height: 6px;
      border-radius: 3px;
      background: rgba(255,255,255,0.15);
      overflow: hidden;
      flex-shrink: 0;
    }
    #${STRIP_ID} .cps-bar-fill {
      display: block;
      height: 100%;
      border-radius: 3px;
      background: #00d4ff;
      box-shadow: 0 0 4px #00d4ff;
      transition: width .8s ease;
      width: 0%;
    }
    #${STRIP_ID} .cps-age {
      font-variant-numeric: tabular-nums;
      opacity: .7;
      min-width: 52px;
      text-align: left;
      letter-spacing: 0;
    }
    #${STRIP_ID} .uptime-pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #0f0;
      display: inline-block;
      box-shadow: 0 0 4px #0f0;
      animation: cps-pulse 2s ease-in-out infinite;
      margin: 0 2px;
    }
    #${STRIP_ID} .uptime-pulse-dot.warn { background: #ff0; box-shadow: 0 0 4px #ff0; }
    #${STRIP_ID} .uptime-pulse-dot.danger { background: #f00; box-shadow: 0 0 4px #f00; }
    #cycle-pulse-strip .cps-block {
      font-variant-numeric: tabular-nums;
      min-width: 90px;
      text-align: right;
      letter-spacing: 0;
    }
    @keyframes cps-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    @media (max-width: 600px) {
      #${STRIP_ID} { font-size: 10px; gap: 3px; }
      #${STRIP_ID} .cps-bar { width: 60px; }
      #${STRIP_ID} .cps-block { display: none; }
      #${STRIP_ID} .cps-cycle { min-width: auto; }
      #${STRIP_ID} .cps-pct { min-width: 36px; }
    }
  `;
  document.head.appendChild(s);
}

function fmtTime(val) {
  if (!val) return '—';
  if (typeof val === 'string') return val.replace(/\s*left\s*$/i, '').trim() || '—';
  if (val <= 0) return '—';
  const h = Math.floor(val / 3600);
  const m = Math.floor((val % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function loadStreak() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY)) || { cycle: null, count: 0 }; }
  catch { return { cycle: null, count: 0 }; }
}

function updateStreak(currentCycle) {
  if (!currentCycle) return 1;
  const s = loadStreak();
  if (s.cycle === currentCycle) return s.count;
  const consecutive = s.cycle === currentCycle - 1;
  const updated = { cycle: currentCycle, count: consecutive ? s.count + 1 : 1 };
  localStorage.setItem(STREAK_KEY, JSON.stringify(updated));
  return updated.count;
}

function createStrip() {
  injectStyles();
  const el = document.createElement('div');
  el.id = STRIP_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Cycle progress');
  el.innerHTML = `
    <span class="cps-cycle"></span>
    <span class="cps-sep">·</span>
    <span class="cps-bar"><span class="cps-bar-fill"></span></span>
    <span class="cps-pct"></span>
    <span class="cps-sep">·</span>
    <span class="cps-block" id="uptime-block-number">—</span>
    <span class="uptime-pulse-dot" id="uptime-pulse-dot" title="Network healthy"></span>
    <span class="cps-age" id="uptime-block-age">—</span>
  `;
  return el;
}

export async function initCyclePulse(stats) {
  // Cycle info now lives in price bar chip — no strip rendered
  updateCyclePulse(stats);
}

export function updateCyclePulse(stats) {
  const rawCycle = Number(stats?.cycle ?? stats?.currentStats?.cycle ?? 0);
  const rawProgress = Number(stats?.cycleProgress ?? stats?.currentStats?.cycleProgress ?? 0);
  const cycle = Number.isFinite(rawCycle) ? rawCycle : 0;
  const progress = Number.isFinite(rawProgress) ? rawProgress : 0;
  const validCycle = cycle > 0;
  const previousCycle = lastCycle;
  const cycleAdvanced = validCycle && previousCycle > 0 && cycle > previousCycle;
  const cycleJustStarted = progress >= 0 && progress <= 5;

  if (cycleAdvanced) {
    updateStreak(cycle);
  }
  if (validCycle) lastCycle = cycle;

  // Update price bar cycle chip
  const chipBlock = document.getElementById('cycle-chip-block');
  const chipLabel = document.getElementById('cycle-chip-label');
  const chipPct = document.getElementById('cycle-chip-pct');
  const progressBar = document.getElementById('price-bar-progress');
  const cycleChip = document.getElementById('cycle-chip');
  cycleChip?.classList.toggle('is-loading', !validCycle);
  if (chipLabel) chipLabel.textContent = validCycle ? `C${cycle}` : 'sync';
  if (chipPct) chipPct.textContent = validCycle ? `${progress.toFixed(1)}%` : 'live';
  const blockLevel = Number(stats?.blockLevel ?? stats?.currentStats?.blockLevel ?? 0);
  if (chipBlock && blockLevel) chipBlock.textContent = blockLevel.toLocaleString();
  if (progressBar) progressBar.style.width = `${validCycle ? Math.min(100, Math.max(0, progress)) : 0}%`;

  if (cycleAdvanced && cycleJustStarted && !cycleWhispered) {
    cycleWhispered = true;
    const pulseTarget = document.getElementById('cycle-chip') || chipLabel;
    if (pulseTarget) pulseFresh(pulseTarget);
    enqueueToast({
      priority: 4,
      duration: 4000,
      show: (done, duration) => showCycleWhisper(cycle, done, duration)
    });
  }
}

function showCycleWhisper(cycle, done, duration = 4000) {
  let container = document.getElementById('moments-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'moments-toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'moment-toast cycle-whisper-toast';
  toast.innerHTML = `
    <div class="moment-toast-header"><span class="moment-toast-label">🔄 Cycle</span></div>
    <div class="moment-toast-title">Cycle ${cycle} begins. Rewards are being dealt.</div>
    <div class="moment-toast-progress"><div class="moment-toast-progress-bar"></div></div>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const bar = toast.querySelector('.moment-toast-progress-bar');
  requestAnimationFrame(() => {
    if (!bar) return;
    bar.style.transition = `width ${duration}ms linear`;
    bar.style.width = '0%';
  });
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.classList.add('exiting');
    setTimeout(() => {
      toast.remove();
      done?.();
    }, 400);
  }, duration);
}
