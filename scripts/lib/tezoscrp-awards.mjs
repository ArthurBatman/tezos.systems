import { createHash } from 'node:crypto';

export const TEZOSCRP_SCHEMA_VERSION = '1.2.0';
export const TEZOSCRP_IDENTITY_REGISTRY_VERSION = '1.0.0';
export const TEZOSCRP_RSS_URL = 'https://medium.com/feed/tezoscommons';

export const CURRENT_CATEGORY_DEFINITIONS = [
  {
    category: 'Drill Sergeant Award',
    icon: '/assets/tezoscrp/cat-icon01.png',
    description: 'Helping onboard developers into the Tezos ecosystem.'
  },
  {
    category: 'Helping Hand Award',
    icon: '/assets/tezoscrp/cat-icon02.png',
    description: 'Helping people onboard, use Tezos, and find dependable support.'
  },
  {
    category: 'Influencer Award',
    icon: '/assets/tezoscrp/cat-icon03.png',
    description: 'Building public awareness, education, engagement, and advocacy for Tezos.'
  },
  {
    category: 'Tez Dev Award',
    icon: '/assets/tezoscrp/cat-icon04.png',
    description: 'Contributing Tezos code, documentation, tools, wikis, and developer knowledge.'
  },
  {
    category: 'Assimilation Award',
    icon: '/assets/tezoscrp/cat-icon05.png',
    description: 'Creating and collecting art on Tezos or helping artists join the ecosystem.'
  },
  {
    category: 'Formal Verification Award',
    icon: '/assets/tezoscrp/cat-icon06.png',
    description: 'Setting a standard for evidence, clear terms, careful reasoning, and constructive exchange.'
  },
  {
    category: 'Pâtissier Award',
    icon: '/assets/tezoscrp/cat-icon07.png',
    description: 'Helping bakers and strengthening decentralized validation on Tezos.'
  },
  {
    category: 'Tezos Tutor Award',
    icon: '/assets/tezoscrp/cat-icon08.png',
    description: 'Publishing educational videos, articles, tutorials, threads, and other learning material.'
  },
  {
    category: 'TEO Award',
    icon: '/assets/tezoscrp/cat-icon09.png',
    description: 'Recognizing long-standing contributors who have gone above and beyond for Tezos.'
  }
];

export const CURRENT_CATEGORIES = CURRENT_CATEGORY_DEFINITIONS.map(({ category }) => category);

const CATEGORY_ALIASES = new Map([
  ['drill sergeant', 'Drill Sergeant Award'],
  ['drill sergeant award', 'Drill Sergeant Award'],
  ['helping hand', 'Helping Hand Award'],
  ['helping hand award', 'Helping Hand Award'],
  ['influencer', 'Influencer Award'],
  ['influencer award', 'Influencer Award'],
  ['tez dev', 'Tez Dev Award'],
  ['tez dev award', 'Tez Dev Award'],
  ['the assimilation award', 'Assimilation Award'],
  ['assimilation award', 'Assimilation Award'],
  ['the formal verification award', 'Formal Verification Award'],
  ['formal verification award', 'Formal Verification Award'],
  ['the patissier award', 'Pâtissier Award'],
  ['patissier award', 'Pâtissier Award'],
  ['the pâtissier award', 'Pâtissier Award'],
  ['pâtissier award', 'Pâtissier Award'],
  ['tezos tutor', 'Tezos Tutor Award'],
  ['tezos tutor award', 'Tezos Tutor Award'],
  ['the teo award', 'TEO Award'],
  ['teo award', 'TEO Award']
]);

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&mdash;', '—')
    .replaceAll('&ndash;', '–');
}

export function stripHtml(value) {
  return compactWhitespace(decodeHtml(String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function cdataValue(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${escaped}>`, 'i'));
  return match ? (match[1] ?? match[2] ?? '').trim() : '';
}

function canonicalArticleUrl(value) {
  try {
    const url = new URL(decodeHtml(value));
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function parseMediumRss(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    const published = new Date(cdataValue(block, 'pubDate'));
    return {
      title: stripHtml(cdataValue(block, 'title')),
      url: canonicalArticleUrl(cdataValue(block, 'link')),
      guid: canonicalArticleUrl(cdataValue(block, 'guid')),
      published_at: Number.isFinite(published.getTime()) ? published.toISOString() : null,
      html: cdataValue(block, 'content:encoded')
    };
  });
}

export function periodFromArticle(article) {
  const source = `${article?.title || ''} ${stripHtml(article?.html || '').slice(0, 800)}`;
  const match = source.match(/(?:winners?\s+(?:for\s+)?|rewards?\s*[—–-]\s*)(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/i);
  if (!match) return null;
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return `${match[2]}-${String(months.indexOf(match[1].toLowerCase()) + 1).padStart(2, '0')}`;
}

export function normalizeCategory(value) {
  const raw = stripHtml(value).replace(/[.:]+$/, '').trim();
  const key = raw.toLowerCase().replace(/\bthe\s+/g, 'the ').replace(/\s+/g, ' ');
  return CATEGORY_ALIASES.get(key) || raw;
}

function articleWinnerSections(article) {
  const html = String(article?.html || '');
  const headings = [...html.matchAll(/<h([23])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => ({ index: match.index, end: match.index + match[0].length, title: stripHtml(match[2]) }));
  const sections = [];
  let foundAwardSection = false;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (/nominations?\s+(?:are\s+)?open|stay in the conversation|frequently asked/i.test(heading.title)) break;
    const nextIndex = headings[index + 1]?.index ?? html.length;
    const sectionHtml = html.slice(heading.end, nextIndex);
    const items = [...sectionHtml.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)]
      .map((match) => stripHtml(match[1]))
      .filter(Boolean);
    if (!items.length) continue;
    const category = normalizeCategory(heading.title);
    if (CURRENT_CATEGORIES.includes(category)) foundAwardSection = true;
    if (!foundAwardSection) continue;
    sections.push({ category, category_raw: stripHtml(heading.title), recipients: items });
  }
  return sections;
}

function handleKey(value) {
  return String(value || '').replace(/^@/, '').trim().toLowerCase();
}

function nameKey(value) {
  return compactWhitespace(value).toLowerCase();
}

function nameSlug(value) {
  return nameKey(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function identityLabel(personId) {
  const [platform, ...rest] = String(personId || '').split(':');
  const value = rest.join(':');
  if (platform === 'x') return `@${value}`;
  if (platform === 'reddit') return `u/${value}`;
  return value;
}

function identityRegistryIndexes(registry) {
  const canonicalByAlias = new Map();
  const entryByCanonical = new Map();
  for (const entry of registry?.identities || []) {
    const canonical = String(entry?.canonical_person_id || '');
    if (!canonical) continue;
    entryByCanonical.set(canonical, entry);
    for (const alias of entry.alias_person_ids || []) canonicalByAlias.set(String(alias), canonical);
  }
  return { canonicalByAlias, entryByCanonical };
}

export function validateTezosCrpIdentityAliases(registry, dataset = null) {
  const errors = [];
  if (!registry || typeof registry !== 'object') return ['identity registry must be an object'];
  if (registry.schema_version !== TEZOSCRP_IDENTITY_REGISTRY_VERSION) {
    errors.push(`identity registry schema_version must be ${TEZOSCRP_IDENTITY_REGISTRY_VERSION}`);
  }
  if (!Array.isArray(registry.identities)) errors.push('identity registry identities must be an array');
  if (!Array.isArray(registry.pending_review)) errors.push('identity registry pending_review must be an array');
  if (registry.policy?.merge_threshold !== 'high_confidence_only') errors.push('identity registry must use the high_confidence_only merge policy');
  if (registry.policy?.preserve_published_recipient !== true) errors.push('identity registry must preserve published recipients');
  if (registry.policy?.infer_wallets !== false) errors.push('identity registry must not infer wallets');

  const canonicalIds = new Set();
  const aliases = new Map();
  for (const [index, entry] of (registry.identities || []).entries()) {
    const canonical = String(entry?.canonical_person_id || '');
    if (!/^(?:x|reddit|name):[^\s:]+$/i.test(canonical)) errors.push(`identity registry entry ${index} has invalid canonical_person_id`);
    if (canonicalIds.has(canonical)) errors.push(`duplicate canonical identity ${canonical}`);
    canonicalIds.add(canonical);
    if (!entry?.display_name) errors.push(`identity registry entry ${canonical || index} lacks display_name`);
    if (!Array.isArray(entry?.alias_person_ids) || !entry.alias_person_ids.length) errors.push(`identity registry entry ${canonical || index} lacks aliases`);
    if (!entry?.basis) errors.push(`identity registry entry ${canonical || index} lacks basis`);
    if (!Array.isArray(entry?.evidence_urls) || !entry.evidence_urls.length || entry.evidence_urls.some((url) => !/^https:\/\//.test(url))) {
      errors.push(`identity registry entry ${canonical || index} needs HTTPS evidence_urls`);
    }
    if (entry?.profile) {
      if (!['x', 'reddit'].includes(entry.profile.platform) || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,30}$/.test(entry.profile.handle || '')) {
        errors.push(`identity registry entry ${canonical || index} has an invalid profile`);
      }
    }
    for (const alias of entry?.alias_person_ids || []) {
      if (!/^(?:x|reddit|name):[^\s:]+$/i.test(alias)) errors.push(`identity registry entry ${canonical || index} has invalid alias ${alias}`);
      if (alias === canonical) errors.push(`identity registry entry ${canonical || index} aliases itself`);
      if (aliases.has(alias)) errors.push(`identity alias ${alias} is claimed by both ${aliases.get(alias)} and ${canonical}`);
      aliases.set(alias, canonical);
    }
  }
  for (const canonical of canonicalIds) {
    if (aliases.has(canonical)) errors.push(`canonical identity ${canonical} is also registered as an alias`);
  }
  for (const [index, row] of (registry.pending_review || []).entries()) {
    if (!Array.isArray(row?.person_ids) || row.person_ids.length < 2 || !row.reason) errors.push(`pending identity review ${index} is incomplete`);
    for (const personId of row?.person_ids || []) {
      if (aliases.has(personId)) errors.push(`pending identity ${personId} is already merged`);
    }
  }
  if (dataset) {
    const datasetIds = new Set((dataset.awards || []).map(({ person_id }) => person_id));
    for (const [alias, canonical] of aliases) {
      if (datasetIds.has(alias)) errors.push(`dataset still uses registered alias ${alias}; expected ${canonical}`);
    }
  }
  return [...new Set(errors)];
}

function identityIndexes(dataset, identityRegistry = null) {
  const registry = identityRegistryIndexes(identityRegistry);
  const byHandle = new Map();
  const byName = new Map();
  const displayByPerson = new Map();
  const knownHandlesByPerson = new Map();
  for (const award of dataset?.awards || []) {
    const sourceId = String(award?.identity_source_id || award?.person_id || '');
    const personId = registry.canonicalByAlias.get(sourceId) || registry.canonicalByAlias.get(String(award?.person_id || '')) || String(award?.person_id || '');
    if (!personId) continue;
    if (!displayByPerson.has(personId) || award.period >= displayByPerson.get(personId).period) {
      displayByPerson.set(personId, { period: award.period, value: award.recipient_name || award.handle || award.recipient_raw });
    }
    const handles = [award.handle, ...(award.aliases || [])]
      .map((value) => String(value || '').match(/@?([A-Za-z0-9_]{1,15})/)?.[1])
      .filter(Boolean);
    if (!knownHandlesByPerson.has(personId)) knownHandlesByPerson.set(personId, new Set());
    for (const handle of handles) {
      byHandle.set(handleKey(handle), personId);
      knownHandlesByPerson.get(personId).add(handleKey(handle));
    }
    if (award.recipient_name) byName.set(nameKey(award.recipient_name), personId);
    if (award.recipient_raw) byName.set(nameKey(award.recipient_raw), personId);
  }
  for (const [canonical, entry] of registry.entryByCanonical) {
    displayByPerson.set(canonical, { period: '9999-12', value: entry.display_name });
    if (!knownHandlesByPerson.has(canonical)) knownHandlesByPerson.set(canonical, new Set());
    for (const personId of [canonical, ...(entry.alias_person_ids || [])]) {
      const [platform, value] = personId.split(':');
      if (platform === 'x') {
        byHandle.set(handleKey(value), canonical);
        knownHandlesByPerson.get(canonical).add(handleKey(value));
      } else if (value) {
        byName.set(nameKey(value), canonical);
      }
    }
  }
  return { byHandle, byName, displayByPerson, knownHandlesByPerson };
}

function recipientIdentity(rawValue, indexes) {
  const raw = stripHtml(rawValue);
  const handles = [...raw.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((match) => match[1]);
  const currentHandle = handles[0] || null;
  const formerHandles = handles.slice(1);
  const mappedFormer = formerHandles.map(handleKey).find((key) => indexes.byHandle.has(key));
  const mappedCurrent = currentHandle && indexes.byHandle.get(handleKey(currentHandle));
  let personId = mappedFormer ? indexes.byHandle.get(mappedFormer) : mappedCurrent;
  let platform = 'x';
  if (!personId && currentHandle) personId = `x:${handleKey(currentHandle)}`;
  if (!personId) {
    platform = /^u\//i.test(raw) ? 'reddit' : 'display_name';
    const plain = raw.replace(/^u\//i, '').trim();
    personId = indexes.byName.get(nameKey(plain)) || `${platform === 'reddit' ? 'reddit' : 'name'}:${nameSlug(plain)}`;
  }
  const knownHandles = indexes.knownHandlesByPerson.get(personId) || new Set();
  let display = indexes.displayByPerson.get(personId)?.value || currentHandle || raw;
  if (currentHandle && knownHandles.has(handleKey(display)) && handleKey(display) !== handleKey(currentHandle)) display = currentHandle;
  const aliases = formerHandles.map((handle) => `@${handle}`);
  return {
    recipient_raw: raw,
    recipient_name: display,
    platform,
    handle: currentHandle,
    person_id: personId,
    aliases: [...new Set(aliases)]
  };
}

function awardId(period, category, personId, occurrence = 0) {
  const digest = createHash('sha256')
    .update([period, category, personId, occurrence].join('\u0000'))
    .digest('hex')
    .slice(0, 12);
  return `tezoscrp:${digest}`;
}

function announcedTotalTez(article) {
  const match = stripHtml(article?.html || '').match(/(?:a\s+)?total\s+of\s+([\d,]+)\s+tez\s+(?:has\s+been\s+)?awarded/i);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function awardsFromArticle(article, dataset, identityRegistry = null) {
  const period = periodFromArticle(article);
  if (!period) throw new Error(`Could not determine award period from ${article?.title || article?.url || 'article'}`);
  const sections = articleWinnerSections(article);
  if (!sections.some(({ category }) => CURRENT_CATEGORIES.includes(category))) {
    throw new Error(`No current TezosCRP award sections found in ${article?.url || article?.title}`);
  }
  const indexes = identityIndexes(dataset, identityRegistry);
  const occurrences = new Map();
  const awards = [];
  for (const section of sections) {
    for (const recipient of section.recipients) {
      const identity = recipientIdentity(recipient, indexes);
      const key = `${section.category}\u0000${identity.person_id}`;
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      awards.push({
        period,
        category: section.category,
        category_raw: section.category_raw,
        award_group: CURRENT_CATEGORIES.includes(section.category) ? 'core_crp' : 'special',
        ...identity,
        rank: null,
        tie: false,
        amount_tez: null,
        source_excerpt: recipient,
        sources: [{
          type: 'official_tezos_commons_article',
          url: article.url,
          published_at: article.published_at
        }],
        confidence: 'official_primary',
        award_id: awardId(period, section.category, identity.person_id, occurrence)
      });
    }
  }
  return { period, awards, announced_total_tez: announcedTotalTez(article) };
}

function monthRange(first, last) {
  const [firstYear, firstMonth] = String(first || '').split('-').map(Number);
  const [lastYear, lastMonth] = String(last || '').split('-').map(Number);
  if (![firstYear, firstMonth, lastYear, lastMonth].every(Number.isFinite)) return [];
  const periods = [];
  for (let year = firstYear, month = firstMonth; year < lastYear || (year === lastYear && month <= lastMonth);) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { year += 1; month = 1; }
  }
  return periods;
}

function sortedCountEntries(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function rebuildDerivedFields(dataset, generatedAt = new Date().toISOString(), identityRegistry = null) {
  const awards = Array.isArray(dataset?.awards) ? dataset.awards : [];
  const registry = identityRegistryIndexes(identityRegistry);
  const periods = [...new Set(awards.map(({ period }) => period).filter(Boolean))].sort();
  const first = periods[0] || dataset?.program?.first_award_period || null;
  const latest = periods.at(-1) || dataset?.program?.latest_award_period || null;
  const expected = monthRange(first, latest);
  const awardRowsByPeriod = new Map(sortedCountEntries(awards.map(({ period }) => period)));
  const people = new Map();
  for (const award of awards) {
    const id = award.person_id;
    if (!people.has(id)) people.set(id, { awards: [], periods: new Set(), categories: new Map(), rawNames: new Set(), aliases: new Set() });
    const person = people.get(id);
    person.awards.push(award);
    person.periods.add(award.period);
    person.categories.set(award.category, (person.categories.get(award.category) || 0) + 1);
    if (award.recipient_raw) person.rawNames.add(award.recipient_raw);
    for (const alias of award.aliases || []) person.aliases.add(alias);
  }
  const peopleSummary = [...people.entries()].map(([person_id, person]) => {
    const entry = registry.entryByCanonical.get(person_id);
    const latestAward = [...person.awards].sort((left, right) => right.period.localeCompare(left.period))[0];
    for (const alias of entry?.alias_person_ids || []) person.aliases.add(identityLabel(alias));
    return {
      person_id,
      display_name: entry?.display_name || latestAward?.recipient_name || latestAward?.handle || person_id,
      ...(entry?.profile ? { profile: entry.profile } : {}),
      total_awards: person.awards.length,
      distinct_periods: person.periods.size,
      periods: [...person.periods].sort(),
      categories: Object.fromEntries([...person.categories].sort(([left], [right]) => left.localeCompare(right))),
      raw_names: [...person.rawNames].sort((left, right) => left.localeCompare(right)),
      aliases: [...person.aliases].sort((left, right) => left.localeCompare(right))
    };
  }).sort((left, right) => right.total_awards - left.total_awards || right.distinct_periods - left.distinct_periods || left.person_id.localeCompare(right.person_id));

  const appliedAliasIds = [...new Set(awards.map(({ identity_source_id }) => identity_source_id).filter((personId) => registry.canonicalByAlias.has(personId)))].sort();

  return {
    ...dataset,
    schema_version: TEZOSCRP_SCHEMA_VERSION,
    generated_at: generatedAt,
    program: {
      ...(dataset.program || {}),
      first_award_period: first,
      latest_award_period: latest,
      cadence: 'monthly'
    },
    coverage: {
      expected_periods: expected.length,
      covered_periods: periods.length,
      missing_periods: expected.filter((period) => !periods.includes(period)),
      unexpected_periods: periods.filter((period) => !expected.includes(period)),
      periods: periods.map((period) => ({ period, award_rows: awardRowsByPeriod.get(period) || 0 }))
    },
    identity_resolution: {
      registry_schema_version: identityRegistry?.schema_version || null,
      registry_updated_at: identityRegistry?.updated_at || null,
      canonical_records: registry.entryByCanonical.size,
      registry_alias_ids: registry.canonicalByAlias.size,
      applied_alias_ids: appliedAliasIds.length,
      pending_review_records: identityRegistry?.pending_review?.length || 0
    },
    category_summary: sortedCountEntries(awards.map(({ category }) => category)).map(([category, award_rows]) => ({ category, award_rows })),
    people_summary: peopleSummary
  };
}

export function applyIdentityAliases(dataset, identityRegistry, generatedAt = dataset?.generated_at || new Date().toISOString()) {
  const registryErrors = validateTezosCrpIdentityAliases(identityRegistry);
  if (registryErrors.length) throw new Error(`TezosCRP identity registry validation failed:\n- ${registryErrors.join('\n- ')}`);
  const { canonicalByAlias } = identityRegistryIndexes(identityRegistry);
  const next = structuredClone(dataset);
  next.awards = (next.awards || []).map((award) => {
    const sourceId = String(award.identity_source_id || award.person_id || '');
    const canonical = canonicalByAlias.get(sourceId) || canonicalByAlias.get(String(award.person_id || ''));
    if (!canonical) return award;
    const aliases = new Set(award.aliases || []);
    aliases.add(identityLabel(sourceId));
    return {
      ...award,
      identity_source_id: sourceId,
      person_id: canonical,
      aliases: [...aliases]
    };
  });
  return rebuildDerivedFields(next, generatedAt, identityRegistry);
}

function displayAwardForPerson(dataset, personId) {
  const rows = (dataset.awards || []).filter((award) => award.person_id === personId);
  return rows.sort((left, right) => right.period.localeCompare(left.period))[0] || null;
}

export function buildTezosCrpSummary(dataset) {
  const latestPeriod = dataset?.program?.latest_award_period || dataset?.coverage?.periods?.at(-1)?.period || null;
  const latestArticle = (dataset?.articles_and_threads || []).find(({ period }) => period === latestPeriod) || null;
  const latestAwards = (dataset?.awards || []).filter(({ period }) => period === latestPeriod);
  const people = dataset?.people_summary || [];
  const topPeople = people.slice(0, 12).map((person) => {
    const award = displayAwardForPerson(dataset, person.person_id);
    return {
      person_id: person.person_id,
      display_name: person.display_name || award?.recipient_name || award?.handle || person.person_id,
      handle: person.profile?.handle || award?.handle || null,
      platform: person.profile?.platform || award?.platform || null,
      ...(person.profile ? { profile: person.profile } : {}),
      total_awards: person.total_awards,
      distinct_periods: person.distinct_periods,
      latest_period: person.periods?.at(-1) || null,
      categories: person.categories
    };
  });
  return {
    schema_version: TEZOSCRP_SCHEMA_VERSION,
    generated_at: dataset.generated_at,
    program: dataset.program,
    coverage: dataset.coverage,
    identity_resolution: dataset.identity_resolution,
    totals: {
      awards: dataset.awards?.length || 0,
      people: people.length,
      periods: dataset.coverage?.covered_periods || 0,
      categories: dataset.category_summary?.length || 0
    },
    counting_note: 'Counts are official category recognitions. They are not per-person XTZ payout totals.',
    current_categories: CURRENT_CATEGORY_DEFINITIONS.map((definition) => ({
      ...definition,
      award_rows: dataset.category_summary?.find(({ category }) => category === definition.category)?.award_rows || 0
    })),
    top_people: topPeople,
    latest: {
      period: latestPeriod,
      article: latestArticle,
      awards: latestAwards.map((award) => ({
        person_id: award.person_id,
        recipient_name: award.recipient_name,
        platform: award.platform,
        handle: award.handle,
        category: award.category,
        award_group: award.award_group
      }))
    }
  };
}

export function mergeNewArticles(dataset, rssItems, generatedAt = new Date().toISOString(), identityRegistry = null) {
  const existingPeriods = new Set((dataset.articles_and_threads || []).map(({ period }) => period));
  const candidates = rssItems
    .filter((article) => /tezos community rewards/i.test(article.title))
    .map((article) => ({ ...article, period: periodFromArticle(article) }))
    .filter((article) => article.period && !existingPeriods.has(article.period))
    .sort((left, right) => left.period.localeCompare(right.period));
  if (!candidates.length) return { dataset: identityRegistry ? applyIdentityAliases(dataset, identityRegistry, dataset.generated_at || generatedAt) : dataset, addedPeriods: [] };

  const next = identityRegistry ? applyIdentityAliases(dataset, identityRegistry, dataset.generated_at || generatedAt) : structuredClone(dataset);
  next.awards ||= [];
  next.articles_and_threads ||= [];
  const addedPeriods = [];
  for (const article of candidates) {
    const parsed = awardsFromArticle(article, next, identityRegistry);
    next.awards.push(...parsed.awards);
    next.articles_and_threads.push({
      period: parsed.period,
      url: article.url,
      published_at: article.published_at,
      extraction: 'medium_rss',
      award_rows: parsed.awards.length,
      ...(parsed.announced_total_tez ? { announced_total_tez: parsed.announced_total_tez } : {})
    });
    addedPeriods.push(parsed.period);
  }
  next.articles_and_threads.sort((left, right) => left.period.localeCompare(right.period));
  return { dataset: identityRegistry ? applyIdentityAliases(next, identityRegistry, generatedAt) : rebuildDerivedFields(next, generatedAt), addedPeriods };
}

export function validateTezosCrpDataset(dataset, identityRegistry = null) {
  const errors = [];
  if (!dataset || typeof dataset !== 'object') return ['dataset must be an object'];
  if (!Array.isArray(dataset.awards) || !dataset.awards.length) errors.push('awards must be a non-empty array');
  if (!Array.isArray(dataset.articles_and_threads) || !dataset.articles_and_threads.length) errors.push('articles_and_threads must be a non-empty array');
  if (!Array.isArray(dataset.people_summary)) errors.push('people_summary must be an array');
  const ids = new Set();
  for (const [index, award] of (dataset.awards || []).entries()) {
    for (const key of ['period', 'category', 'recipient_name', 'person_id', 'award_id']) {
      if (!award?.[key]) errors.push(`award ${index} is missing ${key}`);
    }
    if (ids.has(award.award_id)) errors.push(`duplicate award_id ${award.award_id}`);
    ids.add(award.award_id);
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(award.period || '')) errors.push(`award ${index} has invalid period ${award.period}`);
    const sources = Array.isArray(award.sources) ? award.sources : [];
    if (!sources.some((source) => /^official_tezos_commons_/.test(source?.type || '') && /^https:\/\//.test(source?.url || ''))) {
      errors.push(`award ${award.award_id || index} lacks an official Tezos Commons HTTPS source`);
    }
  }
  if (identityRegistry) {
    errors.push(...validateTezosCrpIdentityAliases(identityRegistry, dataset));
    const { canonicalByAlias } = identityRegistryIndexes(identityRegistry);
    for (const award of dataset.awards || []) {
      if (award.identity_source_id && canonicalByAlias.get(award.identity_source_id) !== award.person_id) {
        errors.push(`award ${award.award_id} has identity_source_id ${award.identity_source_id} without canonical person_id ${award.person_id}`);
      }
    }
  }
  if (dataset.coverage?.missing_periods?.length) errors.push(`coverage has missing periods: ${dataset.coverage.missing_periods.join(', ')}`);
  if (dataset.coverage?.covered_periods !== dataset.coverage?.periods?.length) errors.push('coverage period count does not match period rows');
  if ((dataset.category_summary || []).reduce((sum, row) => sum + Number(row.award_rows || 0), 0) !== (dataset.awards || []).length) {
    errors.push('category_summary does not reconcile to award rows');
  }
  if ((dataset.people_summary || []).reduce((sum, row) => sum + Number(row.total_awards || 0), 0) !== (dataset.awards || []).length) {
    errors.push('people_summary does not reconcile to award rows');
  }
  return [...new Set(errors)];
}
