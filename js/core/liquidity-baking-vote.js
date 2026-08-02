import { API_URLS } from './config.js';

const CACHE_TTL_MS = 60_000;
const EMA_DENOMINATOR = 2_000_000_000;
const DISABLE_THRESHOLD = 1_000_000_000;
const voteCache = new Map();

function voteFromToggle(toggle) {
    if (toggle === true) return { key: 'on', label: 'ON', className: 'on', icon: '🟢' };
    if (toggle === false) return { key: 'off', label: 'OFF', className: 'off', icon: '🔴' };
    return { key: 'pass', label: 'PASS', className: 'pass', icon: '⚪' };
}

function formatAge(timestamp) {
    const diff = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(diff) || diff < 0) return 'just now';
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
}

function bakerName(producer) {
    return producer?.alias || `${producer?.address?.slice(0, 6) || 'tz'}...${producer?.address?.slice(-5) || ''}`;
}

export async function fetchBakerLiquidityBakingVote(bakerAddress, { priority = 'normal' } = {}) {
    if (!bakerAddress) return null;
    const cached = voteCache.get(bakerAddress);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.value;

    try {
        const url = `${API_URLS.tzkt}/blocks?sort.desc=level&limit=1&producer=${encodeURIComponent(bakerAddress)}&select=level,timestamp,producer,lbToggle,lbToggleEma`;
        const response = await fetch(url, {
            cache: 'no-store',
            ...(priority === 'interactive' ? { __tezosSystemsPriority: 'interactive' } : {})
        });
        if (!response.ok) throw new Error(`TzKT baker blocks HTTP ${response.status}`);
        const blocks = await response.json();
        const block = Array.isArray(blocks) ? blocks[0] : null;
        if (!block) {
            const value = { found: false, label: 'No blocks found', className: 'unknown' };
            voteCache.set(bakerAddress, { time: Date.now(), value });
            return value;
        }

        const vote = voteFromToggle(block.lbToggle);
        const ema = Number(block.lbToggleEma) || 0;
        const value = {
            found: true,
            address: block.producer?.address || bakerAddress,
            name: bakerName(block.producer),
            label: vote.label,
            key: vote.key,
            className: vote.className,
            icon: vote.icon,
            level: block.level,
            timestamp: block.timestamp,
            age: formatAge(block.timestamp),
            ema: block.lbToggleEma,
            emaPct: Math.max(0, Math.min(100, (ema / EMA_DENOMINATOR) * 100)),
            subsidyDisabled: ema >= DISABLE_THRESHOLD
        };
        voteCache.set(bakerAddress, { time: Date.now(), value });
        return value;
    } catch (error) {
        console.warn('Liquidity Baking baker vote fetch failed', error);
        const value = { found: false, label: 'Unavailable', className: 'unknown', error: true };
        voteCache.set(bakerAddress, { time: Date.now(), value });
        return value;
    }
}
