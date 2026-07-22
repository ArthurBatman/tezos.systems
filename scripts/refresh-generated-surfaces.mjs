#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHAMBER_ROUTES } from './lib/chamber-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME_NAMES = ['aurora', 'matrix', 'hen', 'default', 'void', 'ember', 'signal', 'nerv', 'clean', 'dark', 'bubblegum', 'abyss', 'moss', 'warzone'];
const COMPARE_PAGES = [
  'compare/tezos-vs-ethereum.html',
  'compare/tezos-vs-solana.html',
  'compare/tezos-vs-cardano.html',
  'compare/tezos-vs-algorand.html'
];

const GOVERNANCE_TARGETS = [
  'data/governance-votes.json',
  'data/governance-refresh-report.json',
  'feed.xml'
];
const CSS_TARGETS = [
  'css/styles.min.css',
  ...THEME_NAMES.flatMap((theme) => [`css/themes/${theme}.css`, `css/themes/${theme}.min.css`])
];
const ROUTE_TARGETS = CHAMBER_ROUTES.map((route) => `${route.slug}/index.html`);
const CHAMBER_OG_TARGETS = CHAMBER_ROUTES.map((route) => `og/${route.slug}.png`);
const SITEMAP_TARGETS = ['sitemap.xml'];
const ROOT_OG_TARGETS = ['og-image.png'];
const MILESTONE_TARGETS = ['data/milestone-catalog.json'];
const NAKAMOTO_TARGETS = ['data/nakamoto-sources.json'];
const MAXIS_TARGETS = ['data/maxis-leaders.json', 'data/maxis'];
const MAXIS_CAREER_TARGETS = ['data/maxis-careers.json'];
const MAXIS_L2_GOVERNANCE_TARGETS = ['data/maxis-l2-governance.json'];
const CAPITAL_TARGETS = ['data/capital-snapshot.json'];
const TEZOSCRP_TARGETS = ['data/tezoscrp-awards.json', 'data/tezoscrp-summary.json'];

const GENERATED_TARGETS = unique([
  ...GOVERNANCE_TARGETS,
  ...CSS_TARGETS,
  ...ROUTE_TARGETS,
  ...CHAMBER_OG_TARGETS,
  ...COMPARE_PAGES,
  ...SITEMAP_TARGETS,
  ...ROOT_OG_TARGETS,
  ...MILESTONE_TARGETS,
  ...NAKAMOTO_TARGETS,
  ...MAXIS_TARGETS,
  ...MAXIS_CAREER_TARGETS,
  ...MAXIS_L2_GOVERNANCE_TARGETS,
  ...CAPITAL_TARGETS,
  ...TEZOSCRP_TARGETS
]);

function unique(values) {
  return [...new Set(values)];
}

function argValue(name, fallback = null) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function mode() {
  if (hasFlag('--all')) return 'all';
  if (hasFlag('--precommit')) return 'precommit';
  return argValue('--mode', 'all');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function git(args, options = {}) {
  return run('git', args, options);
}

function nodeScript(script, args = []) {
  run(process.execPath, [script, ...args]);
}

function stagedFiles() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB'], { capture: true });
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => (pattern instanceof RegExp ? pattern.test(file) : pattern === file));
}

function anyTouched(files, patterns) {
  return files.some((file) => matchesAny(file, patterns));
}

function stageTargets(targets) {
  const existingTargets = targets.filter(Boolean);
  if (existingTargets.length) git(['add', '--', ...existingTargets]);
}

function shouldRun(modeName, touched, patterns) {
  return modeName === 'all' || modeName === 'scheduled' || anyTouched(touched, patterns);
}

async function loadSiteMapModule() {
  const source = await fs.readFile(path.join(ROOT, 'js/core/site-map.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

function sitemapUrl(href, changefreq, priority) {
  const url = new URL(href, 'https://tezos.systems');
  url.hash = '';
  return {
    loc: url.toString(),
    changefreq,
    priority
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function renderSitemap() {
  const { siteMapSitemapEntries } = await loadSiteMapModule();
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    if (seen.has(entry.loc)) return;
    seen.add(entry.loc);
    entries.push(entry);
  };

  siteMapSitemapEntries().forEach((entry) => {
    add(sitemapUrl(entry.href, entry.changefreq, entry.priority));
  });

  const body = entries
    .map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc><changefreq>${escapeXml(entry.changefreq)}</changefreq><priority>${escapeXml(entry.priority)}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function writeSitemap() {
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), await renderSitemap());
  console.log('Wrote sitemap.xml from canonical site map');
}

async function main() {
  if (hasFlag('--print-targets')) {
    console.log(GENERATED_TARGETS.join('\n'));
    return;
  }
  if (hasFlag('--sitemap-only')) {
    await writeSitemap();
    return;
  }

  const modeName = mode();
  const shouldStage = hasFlag('--stage');
  const initialStaged = modeName === 'precommit' ? stagedFiles() : [];
  const ran = [];

  if (modeName !== 'all') {
    nodeScript('scripts/refresh-tezoscrp-awards.mjs', ['--check']);
    ran.push('tezoscrp-check');
  } else {
    nodeScript('scripts/refresh-tezoscrp-awards.mjs');
    ran.push('tezoscrp');
    if (shouldStage) stageTargets(TEZOSCRP_TARGETS);
  }

  // Protocol identity is an input to Maxis seasons. Refresh it first so a
  // protocol activation cannot leave Maxis one scheduled run behind.
  nodeScript('scripts/refresh-governance-data.mjs', shouldStage ? ['--stage'] : []);
  ran.push('governance');

  if (modeName === 'precommit') {
    nodeScript('scripts/refresh-maxis-l2-governance.mjs', ['--check']);
    ran.push('maxis-l2-governance-check');
    nodeScript('scripts/refresh-maxis-data.mjs', ['--check']);
    ran.push('maxis-check');
    nodeScript('scripts/refresh-maxis-careers.mjs', ['--check']);
    ran.push('maxis-careers-check');
    nodeScript('scripts/refresh-nakamoto-sources.mjs', ['--check']);
    ran.push('nakamoto-check');
    nodeScript('scripts/refresh-capital-data.mjs', ['--check']);
    ran.push('capital-check');
  } else if (modeName === 'all' || modeName === 'scheduled') {
    nodeScript('scripts/refresh-maxis-l2-governance.mjs');
    ran.push('maxis-l2-governance');
    if (shouldStage) stageTargets(MAXIS_L2_GOVERNANCE_TARGETS);
    nodeScript('scripts/refresh-maxis-data.mjs');
    ran.push('maxis');
    if (shouldStage) stageTargets(MAXIS_TARGETS);
    nodeScript('scripts/refresh-maxis-careers.mjs');
    ran.push('maxis-careers');
    if (shouldStage) stageTargets(MAXIS_CAREER_TARGETS);
    nodeScript('scripts/refresh-nakamoto-sources.mjs');
    ran.push('nakamoto');
    if (shouldStage) stageTargets(NAKAMOTO_TARGETS);
    nodeScript('scripts/refresh-capital-data.mjs');
    ran.push('capital');
    if (shouldStage) stageTargets(CAPITAL_TARGETS);
  }

  const milestoneArgs = [];
  if (modeName === 'all' || hasFlag('--force-milestones')) milestoneArgs.push('--force');
  if (modeName === 'precommit') milestoneArgs.push('--project-next-commit');
  nodeScript('scripts/generate-milestone-catalog.mjs', milestoneArgs);
  ran.push('milestones');
  if (shouldStage) stageTargets(MILESTONE_TARGETS);

  const touched = unique([...initialStaged, ...(modeName === 'precommit' ? stagedFiles() : [])]);

  if (shouldRun(modeName, touched, [/^css\/styles\.css$/, /^scripts\/build-css\.mjs$/, /^package(?:-lock)?\.json$/])) {
    ran.push('css');
    nodeScript('scripts/build-css.mjs');
    if (shouldStage) stageTargets(CSS_TARGETS);
  }

  const routeTouched = shouldRun(modeName, touched, [
    /^index\.html$/,
    /^scripts\/generate-chamber-routes\.mjs$/,
    /^scripts\/lib\/chamber-routes\.mjs$/,
    ...ROUTE_TARGETS
  ]);
  if (routeTouched) {
    ran.push('routes');
    nodeScript('scripts/generate-chamber-routes.mjs');
    if (shouldStage) stageTargets(ROUTE_TARGETS);
  }

  if (routeTouched || shouldRun(modeName, touched, [
    /^scripts\/refresh-generated-surfaces\.mjs$/,
    /^scripts\/lib\/chamber-routes\.mjs$/,
    /^js\/core\/site-map\.js$/,
    /^sitemap\.xml$/,
    /^compare\/.*\.html$/,
    /^widgets\/.*\.html$/,
    /^widgets\/runtime\.js$/
  ])) {
    ran.push('sitemap');
    await writeSitemap();
    if (shouldStage) stageTargets(SITEMAP_TARGETS);
  }

  if (shouldRun(modeName, touched, [
    /^scripts\/bake-compare-pages\.mjs$/,
    /^js\/core\/config\.js$/,
    /^data\/protocol-data\.json$/,
    /^compare\/.*\.html$/
  ])) {
    ran.push('compare');
    nodeScript('scripts/bake-compare-pages.mjs');
    if (shouldStage) stageTargets(COMPARE_PAGES);
  }

  if (shouldRun(modeName, touched, [
    /^scripts\/generate-chamber-og-images\.mjs$/,
    /^scripts\/lib\/chamber-routes\.mjs$/,
    /^data\/governance-refresh-report\.json$/,
    /^data\/protocol-data\.json$/,
    /^og\/.*\.png$/
  ])) {
    ran.push('chamber-og');
    nodeScript('scripts/generate-chamber-og-images.mjs');
    if (shouldStage) stageTargets(CHAMBER_OG_TARGETS);
  }

  ran.push('root-og');
  nodeScript('scripts/generate-og-image.js');
  if (shouldStage) stageTargets(ROOT_OG_TARGETS);

  console.log(`Generated-surface refresh complete (${modeName}): ${ran.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
