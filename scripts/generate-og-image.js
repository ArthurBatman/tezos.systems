#!/usr/bin/env node
/**
 * Generate the root OG image for tezos.systems with live stats and the
 * deterministic static frame from the Valley theme.
 * Run: node scripts/generate-og-image.js
 * Uses Playwright and falls back to local Chrome/Chromium if the bundled
 * browser is missing.
 */

const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./lib/playwright-browser.cjs');

const PROJECT_ROOT = path.join(__dirname, '..');
const OG_ORIGIN = 'http://tezos-og.local';
const OG_PREVIEW_PATH = '/scripts/_og-preview.html';

async function fetchStats() {
    const [statsResp, protocolResp] = await Promise.all([
        fetch('https://api.tzkt.io/v1/statistics/current'),
        fetch('https://api.tzkt.io/v1/protocols/current')
    ]);
    const stats = await statsResp.json();
    const protocolData = await protocolResp.json();
    const protocolName = protocolData?.extras?.alias || 'Current';

    const supplyMutez = Number(stats.totalSupply || 0);
    const stakedMutez = (Number(stats.totalOwnStaked || 0) + Number(stats.totalExternalStaked || 0))
        || Number(stats.totalFrozen || 0);
    const supply = supplyMutez / 1e6;
    const stakingRatio = supplyMutez > 0 ? ((stakedMutez / supplyMutez) * 100).toFixed(1) : '0.0';
    let bakers = stats.totalBakers || 0;
    let tz4Bakers = 0;
    try {
        const bakersResp = await fetch('https://api.tzkt.io/v1/delegates?active=true&limit=10000&select=address,consensusAddress,bakingPower');
        const allBakersList = await bakersResp.json();
        const fundedBakers = allBakersList.filter(b => Number(b.bakingPower || 0) > 0);
        bakers = fundedBakers.length || bakers;
        tz4Bakers = fundedBakers.filter(b => String(b.consensusAddress || b.address || '').startsWith('tz4')).length;
    } catch(e) { console.error('tz4 fetch error:', e); }

    const tz4Pct = bakers > 0 ? ((tz4Bakers / bakers) * 100).toFixed(1) : '0';
    const supplyB = (supply / 1e9).toFixed(2) + 'B';

    return { bakers, tz4Bakers, tz4Pct, stakingRatio, supply: supplyB, protocolName };
}

function buildHTML(stats) {
    const serializedStats = JSON.stringify(stats).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html data-og-ready="false">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #182016; color: #fff4d6;
    font-family: 'Share Tech Mono', monospace;
    overflow: hidden; position: relative;
  }
  #valley-background-canvas {
    position: absolute !important;
    z-index: 0 !important;
    opacity: 1 !important;
  }
  .valley-wash {
    position: absolute;
    inset: 0;
    z-index: 1;
    background:
      radial-gradient(circle at 78% 14%, rgba(255, 231, 177, 0.05), transparent 32%),
      linear-gradient(90deg, rgba(8, 12, 8, 0.62) 0%, rgba(8, 12, 8, 0.28) 52%, rgba(8, 12, 8, 0.42) 100%),
      linear-gradient(180deg, rgba(7, 10, 7, 0.14) 0%, rgba(7, 10, 7, 0.42) 48%, rgba(7, 10, 7, 0.68) 100%);
  }
  .content {
    position: relative; z-index: 2;
    padding: 42px 50px 32px; height: 100%;
    display: flex; flex-direction: column;
    justify-content: space-between;
  }
  .header {
    display: flex; justify-content: space-between;
    align-items: flex-start;
  }
  .title {
    font-family: 'Orbitron', sans-serif;
    font-size: 64px; line-height: 1; font-weight: 900; color: #fff4d6;
    background: linear-gradient(110deg, #fff8e6 0%, #f3c47a 55%, #dfa06f 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 5px 26px rgba(17, 18, 11, 0.38);
    letter-spacing: 2px;
  }
  .subtitle {
    font-size: 23px; line-height: 1.25; color: #f5e7c6;
    margin-top: 12px; letter-spacing: 0.25px;
    text-shadow: 0 2px 10px rgba(8, 10, 7, 0.85);
  }
  .live-badge {
    background: rgba(20, 29, 18, 0.88);
    border: 1px solid rgba(169, 209, 142, 0.58);
    border-radius: 999px; padding: 10px 18px;
    font-size: 16px; line-height: 1; color: #d5f0c2;
    letter-spacing: 0.8px;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 8px 24px rgba(8, 10, 7, 0.22);
  }
  .live-dot {
    width: 9px; height: 9px; background: #a9d18e;
    border-radius: 50%; box-shadow: 0 0 10px rgba(169, 209, 142, 0.85);
  }
  .stats-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .stat-card {
    min-height: 121px;
    background: linear-gradient(145deg, rgba(35, 42, 27, 0.92), rgba(19, 24, 16, 0.88));
    border: 1px solid rgba(231, 182, 108, 0.38);
    border-radius: 14px; padding: 17px 22px 15px;
    box-shadow: 0 12px 30px rgba(8, 10, 7, 0.2);
  }
  .stat-label {
    font-size: 18px; line-height: 1.05; font-weight: 700; color: #ead9b6;
    letter-spacing: 0.7px; text-transform: uppercase;
    margin-bottom: 7px;
  }
  .stat-value {
    font-family: 'Orbitron', sans-serif;
    font-size: 50px; line-height: 1; font-weight: 700; color: #fff4d6;
    text-shadow: 0 3px 15px rgba(8, 10, 7, 0.5);
  }
  .stat-value.live {
    color: #c8e7b4;
  }
  .stat-value.accent {
    color: #f4a083;
  }
  .footer {
    display: flex; justify-content: space-between;
    align-items: center;
    color: #ead9b6;
    text-shadow: 0 2px 10px rgba(8, 10, 7, 0.9);
  }
  .footer-left {
    font-size: 17px; font-weight: 700;
    letter-spacing: 0.6px;
  }
  .footer-right {
    font-family: 'Orbitron', sans-serif;
    font-size: 18px; font-weight: 700; color: #fff4d6;
    letter-spacing: 0.4px;
  }
</style>
</head>
<body>
  <div class="valley-wash"></div>
  <div class="content">
    <div class="header">
      <div>
        <div class="title">TEZOS SYSTEMS</div>
        <div class="subtitle">Live Tezos + Tezos X intelligence · ${stats.protocolName} protocol</div>
      </div>
      <div class="live-badge"><div class="live-dot"></div>LIVE DATA</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Active Bakers</div>
        <div class="stat-value live">${stats.bakers}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">TZ4 Keys</div>
        <div class="stat-value">${stats.tz4Bakers}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">TZ4 Adoption</div>
        <div class="stat-value accent">${stats.tz4Pct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Staked</div>
        <div class="stat-value live">${stats.stakingRatio}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Supply</div>
        <div class="stat-value">${stats.supply}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Protocol</div>
        <div class="stat-value" style="font-size: 40px;">${stats.protocolName}</div>
      </div>
    </div>
    <div class="footer">
      <div class="footer-left">Real-time network facts, chambers, and personal tools</div>
      <div class="footer-right">tezos.systems</div>
    </div>
  </div>
  <script type="module">
    import { createValleyEffect } from '../js/effects/valley-effects.js';

    const stats = ${serializedStats};
    const valley = createValleyEffect().start().seedStats({
      stakingRatio: Number(stats.stakingRatio),
      cycleProgress: 58,
      transactions24h: 180000
    });
    valley.pause();
    valley.drawScene(0, true);
    document.documentElement.dataset.ogReady = 'true';
  </script>
</body>
</html>`;
}

function localContentType(filePath) {
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    return 'application/octet-stream';
}

async function main() {
    console.log('Fetching live stats from TzKT...');
    const stats = await fetchStats();
    console.log('Stats:', JSON.stringify(stats));

    const html = buildHTML(stats);
    const outputPath = path.join(PROJECT_ROOT, 'og-image.png');

    console.log('Capturing with Playwright...');
    const { chromium } = require('playwright');
    let browser;

    try {
        browser = await launchChromium(chromium, { headless: true });
        const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
        await page.route(`${OG_ORIGIN}/**`, async (route) => {
            const requestUrl = new URL(route.request().url());
            if (requestUrl.pathname === OG_PREVIEW_PATH) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html; charset=utf-8',
                    body: html
                });
                return;
            }

            const assetPath = path.resolve(PROJECT_ROOT, `.${decodeURIComponent(requestUrl.pathname)}`);
            if (!assetPath.startsWith(`${PROJECT_ROOT}${path.sep}`)) {
                await route.fulfill({ status: 403, body: 'Forbidden' });
                return;
            }
            try {
                await route.fulfill({
                    status: 200,
                    contentType: localContentType(assetPath),
                    body: fs.readFileSync(assetPath)
                });
            } catch (_error) {
                await route.fulfill({ status: 404, body: 'Not found' });
            }
        });
        await page.goto(`${OG_ORIGIN}${OG_PREVIEW_PATH}`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForSelector('html[data-og-ready="true"]', { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: outputPath, type: 'png' });
    } finally {
        if (browser) await browser.close();
    }

    console.log(`✅ OG image saved to ${outputPath}`);
    console.log(`   Stats: ${stats.bakers} bakers, ${stats.tz4Bakers} tz4 (${stats.tz4Pct}%), ${stats.stakingRatio}% staked, ${stats.supply} supply`);
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
