/**
 * Valley — a procedural painterly landscape behind the dashboard.
 *
 * The renderer is deliberately decorative: Tezos data remains accessible DOM
 * content. Existing app events only tune bounded atmospheric targets, and the
 * scene never starts its own network request.
 */

const CANVAS_ID = 'valley-background-canvas';
// The scenery is intentionally soft and painterly, so a 1x decorative raster
// preserves the look while keeping high-DPI displays from multiplying the
// full-viewport paint cost. All readable dashboard content remains DOM-native.
const DPR_CAP = 1;
const FRAME_INTERVAL_MS = 1000 / 30;
const TAU = Math.PI * 2;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + ((to - from) * amount);
const finite = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

function normalize(value, min, max) {
    if (!Number.isFinite(value) || max <= min) return null;
    return clamp((value - min) / (max - min));
}

function normalizeLog(value, min, max) {
    if (!Number.isFinite(value) || value < 0) return null;
    const safeMin = Math.log10(Math.max(1, min));
    const safeMax = Math.log10(Math.max(min + 1, max));
    return clamp((Math.log10(Math.max(1, value)) - safeMin) / (safeMax - safeMin));
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function roundedPolygon(ctx, points) {
    if (!points.length) return;
    ctx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        ctx.quadraticCurveTo(
            current[0],
            current[1],
            (current[0] + next[0]) / 2,
            (current[1] + next[1]) / 2
        );
    }
    ctx.closePath();
}

class ValleyEffect {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.started = false;
        this.animationId = null;
        this.resizeAnimationId = null;
        this.lastPaint = 0;
        this.sceneTime = 0;
        this.frameCount = 0;
        this.blockImpulses = 0;
        this.blockImpulse = 0;
        this.blockOrigin = 0.5;
        this.statsRevision = 0;
        this.width = 0;
        this.height = 0;
        this.dpr = 1;
        this.grass = [];
        this.trees = [];
        this.clouds = [];
        this.seeds = [];
        this.paused = true;
        this.contextLost = false;

        this.targets = {
            energy: 0.38,
            wind: 0.42,
            cycle: 0.45,
            stake: 0.45
        };
        this.current = { ...this.targets };

        this.handleResize = this.handleResize.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handleStatsUpdated = this.handleStatsUpdated.bind(this);
        this.handleBlockPulse = this.handleBlockPulse.bind(this);
        this.handleContextLost = this.handleContextLost.bind(this);
        this.handleContextRestored = this.handleContextRestored.bind(this);
        this.animate = this.animate.bind(this);
    }

    start() {
        if (this.started) return this;

        document.getElementById(CANVAS_ID)?.remove();

        const canvas = document.createElement('canvas');
        canvas.id = CANVAS_ID;
        canvas.setAttribute('aria-hidden', 'true');
        canvas.setAttribute('role', 'presentation');
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '-2';
        canvas.style.opacity = '0.96';
        canvas.style.pointerEvents = 'none';
        canvas.style.contain = 'strict';

        let context = null;
        try {
            context = canvas.getContext('2d', { alpha: false, desynchronized: true });
        } catch (_error) {
            context = null;
        }
        if (!context) {
            canvas.remove();
            return this;
        }

        this.canvas = canvas;
        this.ctx = context;
        this.started = true;
        document.body.prepend(canvas);

        window.addEventListener('resize', this.handleResize, { passive: true });
        window.addEventListener('stats-updated', this.handleStatsUpdated);
        window.addEventListener('block-pulse', this.handleBlockPulse);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        canvas.addEventListener('contextlost', this.handleContextLost);
        canvas.addEventListener('contextrestored', this.handleContextRestored);

        this.resize();
        this.drawScene(0, true);
        this.updateDebugState();

        if (document.visibilityState === 'visible') {
            this.resume();
        }
        return this;
    }

    stop() {
        this.started = false;
        this.pause();
        if (this.resizeAnimationId !== null) {
            cancelAnimationFrame(this.resizeAnimationId);
            this.resizeAnimationId = null;
        }

        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('stats-updated', this.handleStatsUpdated);
        window.removeEventListener('block-pulse', this.handleBlockPulse);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.canvas?.removeEventListener('contextlost', this.handleContextLost);
        this.canvas?.removeEventListener('contextrestored', this.handleContextRestored);
        this.canvas?.remove();

        this.canvas = null;
        this.ctx = null;
        this.grass = [];
        this.trees = [];
        this.clouds = [];
        this.seeds = [];
    }

    pause() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.paused = true;
        this.updateDebugState();
    }

    resume() {
        if (!this.started || !this.ctx || this.contextLost || this.animationId !== null) return;
        this.paused = false;
        this.lastPaint = performance.now();
        this.updateDebugState();
        this.animationId = requestAnimationFrame(this.animate);
    }

    handleVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            this.pause();
        } else {
            this.resume();
        }
    }

    handleContextLost(event) {
        event.preventDefault?.();
        this.contextLost = true;
        if (this.canvas) this.canvas.dataset.valleyFallback = 'context-lost';
        this.pause();
    }

    handleContextRestored() {
        if (!this.canvas) return;
        this.contextLost = false;
        this.canvas.dataset.valleyFallback = '';
        this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!this.ctx) return;
        this.resize();
        this.drawScene(0, true);
        if (document.visibilityState === 'visible') this.resume();
    }

    handleResize() {
        if (!this.started) return;
        if (this.resizeAnimationId !== null) cancelAnimationFrame(this.resizeAnimationId);
        this.resizeAnimationId = requestAnimationFrame(() => {
            this.resizeAnimationId = null;
            this.resize();
            this.drawScene(0, true);
        });
    }

    handleStatsUpdated(event) {
        const stats = event?.detail?.stats;
        if (!stats || typeof stats !== 'object') return;

        const next = {};
        const stakingRatio = finite(stats.stakingRatio);
        const cycleProgress = finite(stats.cycleProgress);
        const activity = finite(
            stats.contractCalls24h
            ?? stats.transactionVolume24h
            ?? stats.transactions24h
        );

        if (stakingRatio !== null) next.stake = normalize(stakingRatio, 15, 60);
        if (cycleProgress !== null) next.cycle = normalize(cycleProgress, 0, 100);
        if (activity !== null) next.activity = normalizeLog(activity, 500, 2_000_000);

        if (!Object.values(next).some((value) => value !== null && Number.isFinite(value))) return;

        if (next.stake !== undefined && next.stake !== null) {
            this.targets.stake = next.stake;
        }
        if (next.cycle !== undefined && next.cycle !== null) {
            this.targets.cycle = next.cycle;
        }
        if (next.activity !== undefined && next.activity !== null) {
            this.targets.energy = clamp(0.2 + (next.activity * 0.55));
            this.targets.wind = clamp(0.28 + (next.activity * 0.42));
        }

        this.statsRevision += 1;
        this.updateDebugState();
    }

    seedStats(detail) {
        if (detail) this.handleStatsUpdated({ detail });
        return this;
    }

    handleBlockPulse() {
        this.blockImpulses = Math.min(64, this.blockImpulses + 1);
        this.blockImpulse = clamp(this.blockImpulse + 0.58);
        this.blockOrigin = (0.17 + ((this.blockImpulses * 0.61803398875) % 0.72));
        this.updateDebugState();
    }

    updateDebugState() {
        if (!this.canvas) return;
        this.canvas.dataset.valleyFrame = String(this.frameCount);
        this.canvas.dataset.valleyImpulses = String(this.blockImpulses);
        this.canvas.dataset.valleyPaused = String(this.paused);
        this.canvas.dataset.valleyStatsRevision = String(this.statsRevision);
        this.canvas.dataset.valleyEnergyTarget = this.targets.energy.toFixed(4);
        this.canvas.dataset.valleyWindTarget = this.targets.wind.toFixed(4);
        this.canvas.dataset.valleyCycleNormalized = this.targets.cycle.toFixed(4);
        this.canvas.dataset.valleyStakeNormalized = this.targets.stake.toFixed(4);
        this.canvas.dataset.valleyDpr = this.dpr.toFixed(2);
        this.canvas.dataset.valleyGrass = String(this.grass.length);
    }

    resize() {
        if (!this.canvas || !this.ctx) return;

        this.width = Math.max(1, window.innerWidth);
        this.height = Math.max(1, window.innerHeight);
        this.dpr = Math.max(1, Math.min(DPR_CAP, window.devicePixelRatio || 1));
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        this.buildScene();
        this.updateDebugState();
    }

    buildScene() {
        const random = seededRandom(
            ((Math.round(this.width) * 73856093) ^ (Math.round(this.height) * 19349663)) >>> 0
        );
        const compact = this.width < 640;
        const medium = this.width < 1100;
        const grassCount = compact ? 480 : medium ? 780 : 1250;
        const treeCount = compact ? 13 : medium ? 20 : 28;
        const cloudCount = compact ? 4 : 7;
        const seedCount = compact ? 12 : 24;

        this.grass = Array.from({ length: grassCount }, (_value, index) => {
            const depth = random();
            const baseY = lerp(this.height * 0.52, this.height * 1.035, Math.pow(depth, 0.7));
            const perspective = clamp((baseY - (this.height * 0.5)) / (this.height * 0.52));
            return {
                x: random() * this.width,
                y: baseY + ((random() - 0.5) * this.height * 0.025),
                length: lerp(5, compact ? 34 : 48, Math.pow(perspective, 1.3)) * lerp(0.76, 1.18, random()),
                phase: random() * TAU,
                width: lerp(0.45, compact ? 1.2 : 1.55, perspective) * lerp(0.75, 1.15, random()),
                depth: perspective,
                seedHead: index % (compact ? 37 : 31) === 0 && perspective > 0.56
            };
        }).sort((left, right) => left.depth - right.depth);

        this.trees = Array.from({ length: treeCount }, (_value, index) => {
            const sideBias = index % 3 === 0 ? random() * 0.25 : 0.17 + (random() * 0.78);
            const depth = random();
            return {
                x: sideBias * this.width,
                y: lerp(this.height * 0.47, this.height * 0.57, depth),
                size: lerp(compact ? 13 : 18, compact ? 36 : 56, depth) * lerp(0.78, 1.2, random()),
                lean: (random() - 0.5) * 0.18,
                phase: random() * TAU,
                tone: index % 4
            };
        }).sort((left, right) => left.y - right.y);

        this.clouds = Array.from({ length: cloudCount }, () => ({
            x: random() * this.width,
            y: lerp(this.height * 0.09, this.height * 0.34, random()),
            width: lerp(this.width * 0.08, this.width * 0.22, random()),
            height: lerp(10, compact ? 28 : 42, random()),
            speed: lerp(0.35, 0.9, random()),
            alpha: lerp(0.025, 0.09, random())
        }));

        this.seeds = Array.from({ length: seedCount }, () => ({
            x: random() * this.width,
            y: lerp(this.height * 0.46, this.height * 0.9, random()),
            phase: random() * TAU,
            speed: lerp(0.35, 1.1, random()),
            size: lerp(0.6, 1.8, random())
        }));
    }

    animate(timestamp) {
        this.animationId = null;
        if (!this.started || this.paused || !this.ctx || this.contextLost) return;

        const elapsed = timestamp - this.lastPaint;
        if (elapsed >= FRAME_INTERVAL_MS) {
            const delta = Math.min(elapsed, 100);
            this.lastPaint = timestamp - (elapsed % FRAME_INTERVAL_MS);
            this.sceneTime += delta / 1000;
            this.drawScene(delta, false);
            this.frameCount += 1;
            this.updateDebugState();
        }

        if (this.started && !this.paused) {
            this.animationId = requestAnimationFrame(this.animate);
        }
    }

    drawScene(deltaMs, staticFrame) {
        const ctx = this.ctx;
        if (!ctx || !this.width || !this.height) return;

        const settle = staticFrame ? 1 : 1 - Math.exp(-Math.max(1, deltaMs) / 1150);
        for (const key of Object.keys(this.current)) {
            this.current[key] = lerp(this.current[key], this.targets[key], settle);
        }
        if (!staticFrame) {
            this.blockImpulse *= Math.exp(-Math.max(1, deltaMs) / 1350);
        }

        const time = this.sceneTime;
        const cameraX = staticFrame ? 0 : Math.sin(time * 0.09) * this.width * 0.006;
        const cameraY = staticFrame ? 0 : Math.sin((time * 0.07) + 1.4) * this.height * 0.003;

        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.translate(cameraX, cameraY);

        this.drawSky(ctx, time);
        this.drawClouds(ctx, time, staticFrame);
        this.drawMountains(ctx);
        this.drawHills(ctx, time);
        this.drawRiver(ctx, time, staticFrame);
        this.drawTrees(ctx, time, staticFrame);
        this.drawGrass(ctx, time, staticFrame);
        this.drawSeeds(ctx, time, staticFrame);
        this.drawAtmosphere(ctx);

        ctx.restore();
    }

    drawSky(ctx, time) {
        const horizon = this.height * 0.56;
        const cycleWarmth = this.current.cycle;
        const sky = ctx.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#53696F');
        sky.addColorStop(0.42, '#82918A');
        sky.addColorStop(0.78, '#C4A878');
        sky.addColorStop(1, '#D5B476');
        ctx.fillStyle = sky;
        ctx.fillRect(-40, -40, this.width + 80, horizon + 90);

        const sunX = this.width * lerp(0.68, 0.82, cycleWarmth);
        const sunY = this.height * lerp(0.18, 0.12, cycleWarmth);
        const sunRadius = Math.max(55, Math.min(this.width, this.height) * 0.14);
        const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius);
        sun.addColorStop(0, 'rgba(255, 238, 184, 0.88)');
        sun.addColorStop(0.12, 'rgba(255, 222, 143, 0.52)');
        sun.addColorStop(0.46, 'rgba(232, 171, 95, 0.16)');
        sun.addColorStop(1, 'rgba(232, 171, 95, 0)');
        ctx.fillStyle = sun;
        ctx.fillRect(sunX - sunRadius, sunY - sunRadius, sunRadius * 2, sunRadius * 2);

        ctx.fillStyle = `rgba(255, 224, 166, ${0.025 + (this.current.energy * 0.035)})`;
        const hazeOffset = Math.sin(time * 0.025) * this.width * 0.02;
        ctx.fillRect(hazeOffset - 30, horizon * 0.66, this.width + 60, horizon * 0.42);
    }

    drawClouds(ctx, time, staticFrame) {
        for (const cloud of this.clouds) {
            const travel = staticFrame ? 0 : (time * cloud.speed * 4);
            const x = ((cloud.x + travel + (cloud.width * 1.5)) % (this.width + (cloud.width * 3))) - (cloud.width * 1.5);
            ctx.save();
            ctx.translate(x, cloud.y);
            ctx.fillStyle = `rgba(246, 226, 189, ${cloud.alpha})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, cloud.width * 0.42, cloud.height * 0.62, -0.05, 0, TAU);
            ctx.ellipse(cloud.width * 0.3, cloud.height * 0.08, cloud.width * 0.5, cloud.height * 0.72, 0.04, 0, TAU);
            ctx.ellipse(-cloud.width * 0.32, cloud.height * 0.12, cloud.width * 0.35, cloud.height * 0.5, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
        }
    }

    drawMountains(ctx) {
        const horizon = this.height * 0.53;
        const layers = [
            { color: '#56675A', alpha: 0.58, y: horizon - (this.height * 0.09), amp: this.height * 0.075, phase: 0.8 },
            { color: '#445844', alpha: 0.72, y: horizon - (this.height * 0.035), amp: this.height * 0.062, phase: 2.4 }
        ];

        for (const layer of layers) {
            ctx.beginPath();
            ctx.moveTo(-40, this.height);
            ctx.lineTo(-40, layer.y);
            for (let x = -40; x <= this.width + 40; x += Math.max(36, this.width / 24)) {
                const ridge = Math.sin((x / this.width) * 8.4 + layer.phase)
                    + (Math.sin((x / this.width) * 17.8 + (layer.phase * 0.7)) * 0.35);
                ctx.lineTo(x, layer.y - (ridge * layer.amp));
            }
            ctx.lineTo(this.width + 40, this.height);
            ctx.closePath();
            ctx.globalAlpha = layer.alpha;
            ctx.fillStyle = layer.color;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    drawHills(ctx, time) {
        const wind = this.current.wind;
        const hillLayers = [
            { y: 0.57, color: '#69754A', amp: 0.028, phase: 0.2 },
            { y: 0.64, color: '#4D5C36', amp: 0.035, phase: 2.1 },
            { y: 0.73, color: '#344329', amp: 0.042, phase: 4.2 }
        ];

        for (const [index, hill] of hillLayers.entries()) {
            const baseY = this.height * hill.y;
            ctx.beginPath();
            ctx.moveTo(-50, this.height + 40);
            ctx.lineTo(-50, baseY);
            for (let x = -50; x <= this.width + 50; x += Math.max(42, this.width / 26)) {
                const wave = Math.sin((x / this.width) * 7.4 + hill.phase)
                    + (Math.sin((x / this.width) * 14.2 + hill.phase) * 0.22);
                const livingShift = Math.sin(time * 0.08 + (x * 0.002)) * wind * (index + 1) * 0.5;
                ctx.lineTo(x, baseY - (wave * this.height * hill.amp) + livingShift);
            }
            ctx.lineTo(this.width + 50, this.height + 40);
            ctx.closePath();
            ctx.fillStyle = hill.color;
            ctx.fill();
        }
    }

    drawRiver(ctx, time, staticFrame) {
        const horizonY = this.height * 0.535;
        const mouthX = this.width * 0.59;
        const bottomX = this.width * 0.42;
        const bottomHalfWidth = this.width * (this.width < 640 ? 0.24 : 0.19);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(mouthX - (this.width * 0.012), horizonY);
        ctx.bezierCurveTo(
            this.width * 0.57,
            this.height * 0.66,
            bottomX + (this.width * 0.12),
            this.height * 0.79,
            bottomX - bottomHalfWidth,
            this.height + 20
        );
        ctx.lineTo(bottomX + bottomHalfWidth, this.height + 20);
        ctx.bezierCurveTo(
            bottomX + (this.width * 0.03),
            this.height * 0.82,
            this.width * 0.63,
            this.height * 0.64,
            mouthX + (this.width * 0.012),
            horizonY
        );
        ctx.closePath();

        const water = ctx.createLinearGradient(0, horizonY, 0, this.height);
        water.addColorStop(0, '#8E9C87');
        water.addColorStop(0.35, '#687F75');
        water.addColorStop(0.72, '#415E5B');
        water.addColorStop(1, '#263E3D');
        ctx.fillStyle = water;
        ctx.fill();
        ctx.clip();

        const glintAlpha = 0.08 + (this.current.energy * 0.12);
        ctx.strokeStyle = `rgba(255, 224, 166, ${glintAlpha})`;
        ctx.lineCap = 'round';
        for (let index = 0; index < 18; index += 1) {
            const progress = index / 18;
            const y = lerp(horizonY + 8, this.height, Math.pow(progress, 1.45));
            const width = lerp(8, bottomHalfWidth * 1.6, progress);
            const drift = staticFrame ? 0 : Math.sin((time * 0.8) + (index * 1.9)) * lerp(1, 8, progress);
            ctx.lineWidth = lerp(0.45, 1.8, progress);
            ctx.beginPath();
            ctx.moveTo(lerp(mouthX, bottomX, progress) - (width * 0.45) + drift, y);
            ctx.quadraticCurveTo(
                lerp(mouthX, bottomX, progress) + drift,
                y + Math.sin(index * 2.2) * 2,
                lerp(mouthX, bottomX, progress) + (width * 0.45) + drift,
                y
            );
            ctx.stroke();
        }
        ctx.restore();
    }

    drawTrees(ctx, time, staticFrame) {
        const palette = [
            ['#263A2B', '#39513A', '#53674A'],
            ['#31452E', '#465C37', '#61734A'],
            ['#2B402F', '#3F5740', '#596C4C'],
            ['#35482A', '#4B5D34', '#69754A']
        ];

        for (const tree of this.trees) {
            const sway = staticFrame ? 0 : Math.sin((time * 0.62) + tree.phase) * this.current.wind * tree.size * 0.025;
            const trunkHeight = tree.size * 0.7;
            ctx.save();
            ctx.translate(tree.x, tree.y);
            ctx.rotate(tree.lean + (sway * 0.002));

            ctx.strokeStyle = '#3A2D20';
            ctx.lineWidth = Math.max(1, tree.size * 0.095);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, tree.size * 0.18);
            ctx.lineTo(sway * 0.25, -trunkHeight);
            ctx.stroke();

            const colors = palette[tree.tone % palette.length];
            const crownY = -trunkHeight;
            const lobes = [
                [-0.34, 0.1, 0.48, colors[0]],
                [0.32, 0.06, 0.45, colors[1]],
                [-0.03, -0.28, 0.54, colors[2]],
                [0.03, 0.28, 0.5, colors[1]]
            ];
            for (const [x, y, scale, color] of lobes) {
                const radius = tree.size * scale;
                ctx.fillStyle = color;
                ctx.beginPath();
                roundedPolygon(ctx, [
                    [(x * tree.size) - radius, crownY + (y * tree.size)],
                    [(x * tree.size) - (radius * 0.25), crownY + (y * tree.size) - (radius * 0.85)],
                    [(x * tree.size) + (radius * 0.7), crownY + (y * tree.size) - (radius * 0.4)],
                    [(x * tree.size) + radius, crownY + (y * tree.size) + (radius * 0.35)],
                    [(x * tree.size), crownY + (y * tree.size) + (radius * 0.72)]
                ]);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    drawGrass(ctx, time, staticFrame) {
        const visibleFraction = 0.78 + (this.current.stake * 0.22);
        const visibleCount = Math.floor(this.grass.length * visibleFraction);
        const travelingPosition = staticFrame
            ? this.blockOrigin
            : ((this.blockOrigin + (time * (0.13 + (this.current.energy * 0.08)))) % 1);
        const palette = [
            'rgba(91, 111, 64, 0.5)',
            'rgba(104, 126, 67, 0.68)',
            'rgba(119, 137, 70, 0.8)',
            'rgba(138, 146, 74, 0.9)'
        ];

        for (let band = 0; band < 4; band += 1) {
            ctx.beginPath();
            ctx.strokeStyle = palette[band];
            ctx.lineCap = 'round';

            for (let index = 0; index < visibleCount; index += 1) {
                const blade = this.grass[index];
                const bladeBand = Math.min(3, Math.floor(blade.depth * 4));
                if (bladeBand !== band) continue;

                const xNormalized = blade.x / this.width;
                const coherentWave = staticFrame
                    ? Math.sin(blade.x * 0.012 + blade.phase) * 0.18
                    : (
                        Math.sin((time * (0.9 + (this.current.wind * 0.75))) + (blade.x * 0.012) + (blade.y * 0.004) + blade.phase) * 0.66
                        + Math.sin((time * 0.43) + (blade.x * 0.0045)) * 0.34
                    );
                const gustDistance = Math.min(
                    Math.abs(xNormalized - travelingPosition),
                    1 - Math.abs(xNormalized - travelingPosition)
                );
                const gust = this.blockImpulse * Math.exp(-(gustDistance * gustDistance) / 0.0045);
                const bend = blade.length
                    * (0.08 + (this.current.wind * 0.25))
                    * (coherentWave + (gust * 1.6));
                const tipX = blade.x + bend;
                const tipY = blade.y - blade.length;

                ctx.lineWidth = blade.width;
                ctx.moveTo(blade.x, blade.y);
                ctx.quadraticCurveTo(
                    blade.x + (bend * 0.28),
                    blade.y - (blade.length * 0.56),
                    tipX,
                    tipY
                );
            }
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(205, 184, 111, 0.52)';
        for (let index = 0; index < visibleCount; index += 1) {
            const blade = this.grass[index];
            if (!blade.seedHead) continue;
            const coherentWave = staticFrame
                ? Math.sin(blade.phase) * 0.08
                : Math.sin((time * 1.1) + blade.phase + (blade.x * 0.008)) * this.current.wind * 0.24;
            const bend = blade.length * coherentWave;
            ctx.beginPath();
            ctx.ellipse(
                blade.x + bend,
                blade.y - blade.length,
                Math.max(0.7, blade.width * 1.3),
                Math.max(1.8, blade.width * 3.2),
                coherentWave,
                0,
                TAU
            );
            ctx.fill();
        }
    }

    drawSeeds(ctx, time, staticFrame) {
        const visibleSeeds = Math.floor(this.seeds.length * (0.35 + (this.current.energy * 0.65)));
        ctx.fillStyle = 'rgba(255, 226, 169, 0.3)';
        for (let index = 0; index < visibleSeeds; index += 1) {
            const seed = this.seeds[index];
            const travel = staticFrame ? 0 : time * seed.speed * (9 + (this.current.wind * 14));
            const x = ((seed.x + travel + 20) % (this.width + 40)) - 20;
            const y = seed.y
                + (staticFrame ? 0 : Math.sin((time * seed.speed) + seed.phase) * 12)
                - ((travel * 0.08) % (this.height * 0.18));
            ctx.beginPath();
            ctx.ellipse(x, y, seed.size * 0.55, seed.size * 1.6, 0.7, 0, TAU);
            ctx.fill();
        }
    }

    drawAtmosphere(ctx) {
        const horizon = this.height * 0.52;
        const mist = ctx.createLinearGradient(0, horizon - 45, 0, horizon + (this.height * 0.19));
        mist.addColorStop(0, 'rgba(244, 215, 168, 0)');
        mist.addColorStop(0.42, 'rgba(224, 199, 154, 0.12)');
        mist.addColorStop(1, 'rgba(224, 199, 154, 0)');
        ctx.fillStyle = mist;
        ctx.fillRect(-40, horizon - 45, this.width + 80, this.height * 0.25);

        const vignette = ctx.createRadialGradient(
            this.width * 0.5,
            this.height * 0.44,
            Math.min(this.width, this.height) * 0.24,
            this.width * 0.5,
            this.height * 0.5,
            Math.max(this.width, this.height) * 0.72
        );
        vignette.addColorStop(0, 'rgba(12, 15, 10, 0)');
        vignette.addColorStop(0.72, 'rgba(12, 15, 10, 0.04)');
        vignette.addColorStop(1, 'rgba(8, 10, 7, 0.3)');
        ctx.fillStyle = vignette;
        ctx.fillRect(-40, -40, this.width + 80, this.height + 80);
    }
}

export function createValleyEffect() {
    return new ValleyEffect();
}

export default createValleyEffect;
