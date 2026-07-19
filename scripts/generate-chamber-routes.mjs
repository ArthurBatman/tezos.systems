#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMBER_ROUTES, routeImage, routeUrl } from './lib/chamber-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`Route shell replacement failed: ${pattern}`);
  return html.replace(pattern, replacement);
}

function jsonLd(value) {
  return JSON.stringify(value, null, 2).replaceAll('<', '\\u003c');
}

function renderRouteStructuredData(route, url, image) {
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: route.shortTitle,
      headline: route.title,
      url,
      description: route.description,
      primaryImageOfPage: image,
      isPartOf: {
        '@type': 'WebSite',
        name: 'Tezos Systems',
        url: 'https://tezos.systems/'
      },
      about: {
        '@type': 'Thing',
        name: 'Tezos'
      },
      publisher: {
        '@type': 'Person',
        name: 'Primate',
        url: 'https://x.com/BakingBenjamins',
        sameAs: [
          'https://x.com/BakingBenjamins',
          'https://github.com/Primate411'
        ],
        affiliation: {
          '@type': 'Organization',
          name: 'Tez Capital',
          url: 'https://tez.capital'
        }
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Tezos Systems',
          item: 'https://tezos.systems/'
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: route.shortTitle,
          item: url
        }
      ]
    }
  ];

  return `    <!-- Route-specific structured data: generated, do not edit in route shells -->
    <script type="application/ld+json">
${jsonLd(schema)}
    </script>`;
}

function renderRouteIntro(route) {
  return `
        <section class="chamber-route-shell-intro" aria-labelledby="chamber-route-title" style="--chamber-route-accent:${escapeHtml(route.accent)}">
            <nav aria-label="Breadcrumb"><a href="/">Tezos Systems</a><span aria-hidden="true"> / </span>${escapeHtml(route.eyebrow)}</nav>
            <h1 id="chamber-route-title">${escapeHtml(route.shortTitle)}</h1>
            <p>${escapeHtml(route.description)}</p>
        </section>`;
}

const ROUTE_INTRO_STYLES = `    <style data-chamber-route-shell>
      .chamber-route-shell-intro{box-sizing:border-box;max-width:1160px;margin:0 auto 1rem;padding:clamp(1rem,3vw,1.75rem);border:1px solid color-mix(in srgb,var(--chamber-route-accent) 52%,transparent);border-radius:16px;background:linear-gradient(135deg,rgba(8,15,28,.96),rgba(13,22,38,.9));color:#edf4ff;box-shadow:0 18px 48px rgba(0,0,0,.22)}
      .chamber-route-shell-intro nav{margin:0 0 .7rem;color:#aebdd1;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase}.chamber-route-shell-intro nav a{color:var(--chamber-route-accent)}
      .chamber-route-shell-intro h1{margin:0;color:#fff;font-size:clamp(1.65rem,4vw,2.7rem);line-height:1.08}.chamber-route-shell-intro p{max-width:68ch;margin:.75rem 0 0;color:#d4deec;line-height:1.6}
    </style>`;

function absolutizeShellAssetRefs(html) {
  return html.replace(/\b(href|src)="(?!https?:|\/|#|mailto:|data:)([^"]+)"/g, (_match, attr, value) => {
    return `${attr}="/${value}"`;
  });
}

function renderRoute(route, dashboardShell) {
  const url = routeUrl(route);
  const image = routeImage(route);
  const escapedTitle = escapeHtml(route.title);
  const escapedDescription = escapeHtml(route.description);
  const robots = escapeHtml(route.robots || 'index, follow, max-image-preview:large');

  let html = absolutizeShellAssetRefs(dashboardShell);
  html = replaceTag(html, /<html lang="en">/, `<html lang="en" data-chamber-route="${escapeHtml(route.slug)}">`);
  html = replaceTag(html, /<title>[\s\S]*?<\/title>/, `<title>${escapedTitle} | tezos.systems</title>`);
  html = replaceTag(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapedDescription}">`);
  html = replaceTag(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  html = replaceTag(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  html = replaceTag(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapedTitle}">`);
  html = replaceTag(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapedDescription}">`);
  html = replaceTag(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`);
  html = replaceTag(html, /<meta property="og:image:width" content="[^"]*">/, '<meta property="og:image:width" content="1200">');
  html = replaceTag(html, /<meta property="og:image:height" content="[^"]*">/, '<meta property="og:image:height" content="630">');
  html = replaceTag(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapedTitle}">`);
  html = replaceTag(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapedDescription}">`);
  html = replaceTag(html, /<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`);
  html = replaceTag(html, /<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${robots}">`);
  html = replaceTag(
    html,
    /\s*<!-- JSON-LD Structured Data -->[\s\S]*?(?=\s*<!-- GoatCounter Analytics -->)/,
    `\n${renderRouteStructuredData(route, url, image)}\n`
  );
  html = html.replace(/\s*<!-- Price Intelligence Structured Data -->\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
  html = replaceTag(html, /\n<\/head>/, `\n${ROUTE_INTRO_STYLES}\n</head>`);
  html = replaceTag(
    html,
    /<main class="main-content" id="main-content" role="main">/,
    `<main class="main-content" id="main-content" role="main">${renderRouteIntro(route)}`
  );
  return html.replace(/[ \t]+$/gm, '');
}

async function main() {
  const dashboardShell = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  for (const route of CHAMBER_ROUTES) {
    const dir = path.join(ROOT, route.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), renderRoute(route, dashboardShell));
  }
  console.log(`Wrote ${CHAMBER_ROUTES.length} chamber route pages`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
