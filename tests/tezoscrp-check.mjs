#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_CATEGORY_DEFINITIONS,
  TEZOSCRP_SCHEMA_VERSION,
  awardsFromArticle,
  buildTezosCrpSummary,
  mergeNewArticles,
  parseMediumRss,
  validateTezosCrpDataset
} from '../scripts/lib/tezoscrp-awards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(await fs.readFile(path.join(ROOT, 'data/tezoscrp-awards.json'), 'utf8'));
const summary = JSON.parse(await fs.readFile(path.join(ROOT, 'data/tezoscrp-summary.json'), 'utf8'));

assert.equal(dataset.schema_version, TEZOSCRP_SCHEMA_VERSION);
assert.deepEqual(validateTezosCrpDataset(dataset), []);
assert.deepEqual(summary, buildTezosCrpSummary(dataset));
assert.equal(CURRENT_CATEGORY_DEFINITIONS.length, 9);
assert.equal(new Set(CURRENT_CATEGORY_DEFINITIONS.map(({ icon }) => icon)).size, 9);
for (const definition of CURRENT_CATEGORY_DEFINITIONS) {
  await fs.access(path.join(ROOT, definition.icon.replace(/^\//, '')));
}

const fixtureArticle = {
  title: 'Tezos Community Rewards — July 2026',
  url: 'https://news.tezoscommons.org/tezos-community-rewards-july-2026-fixture',
  published_at: '2026-08-20T18:00:00.000Z',
  html: `
    <p>For this round, a total of 10,000 tez has been awarded.</p>
    <h3>Helping Hand Award</h3>
    <ul><li>@FixtureHelper</li><li>@TozartWeb3 (ex @TezosNFTMusic)</li></ul>
    <h3>Patissier Award</h3>
    <ul><li>@FixtureBaker</li></ul>
    <h3>Nominations Are Open For August</h3>
    <ul><li>@ThisIsNotAWinner</li></ul>
  `
};

const fixture = awardsFromArticle(fixtureArticle, dataset);
assert.equal(fixture.period, '2026-07');
assert.equal(fixture.awards.length, 3);
assert.equal(fixture.announced_total_tez, 10_000);
assert.equal(fixture.awards.find(({ handle }) => handle === 'TozartWeb3')?.person_id, 'x:tozartweb3');
assert.equal(fixture.awards.find(({ handle }) => handle === 'FixtureBaker')?.category, 'Pâtissier Award');
assert.equal(fixture.awards.some(({ handle }) => handle === 'ThisIsNotAWinner'), false);

const rss = `<?xml version="1.0"?><rss><channel><item>
  <title><![CDATA[${fixtureArticle.title}]]></title>
  <link>${fixtureArticle.url}?source=rss</link>
  <guid>https://medium.com/p/fixture</guid>
  <pubDate>Thu, 20 Aug 2026 18:00:00 GMT</pubDate>
  <content:encoded><![CDATA[${fixtureArticle.html}]]></content:encoded>
</item></channel></rss>`;
const items = parseMediumRss(rss);
assert.equal(items.length, 1);
assert.equal(items[0].url, fixtureArticle.url);
const merged = mergeNewArticles(dataset, items, '2026-08-20T18:01:00.000Z');
assert.deepEqual(merged.addedPeriods, ['2026-07']);
assert.equal(merged.dataset.awards.length, dataset.awards.length + 3);
assert.equal(merged.dataset.coverage.missing_periods.length, 0);
assert.deepEqual(validateTezosCrpDataset(merged.dataset), []);

console.log(`TezosCRP focused checks passed: ${dataset.awards.length} awards, 9 official category icons, RSS parser and alias continuity`);
