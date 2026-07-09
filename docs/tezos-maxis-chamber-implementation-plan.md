# Implementation Plan — Tezos Maxis Chamber (`/maxis/`)

## Outcome

Add a first-class **Tezos Maxis** chamber that answers “who is doing the most?”
with one inspectable leader per activity category, plus a cross-category
**Unicorn**. Every result must say what was measured, over which window, when
the data was refreshed, and link the account directly into Ledger Flow so a
visitor can investigate the surrounding on-chain activity.

The chamber is playful in voice, but the ranking contract is not: no manually
picked personalities, no opaque composite reputation score, and no claim of
chain-wide leadership when a source only exposes a sample.

## Product contract

### Initial leader cards

| Card | Ranking question | Initial score |
| --- | --- | --- |
| Transaction Maxi | Who is using Tezos most often? | Successful user-originated transactions in the declared activity window |
| Collector Maxi | Who is collecting the most art? | Qualified NFT purchases, with purchase count primary and XTZ volume shown as context |
| Creator Maxi | Who is minting the most art? | Qualified NFT mints initiated by the creator |
| DeFi Maxi | Who is using the broadest set of DeFi apps? | Successful calls to curated DeFi contracts; unique apps primary, calls secondary |
| Gaming Maxi | Who is using Tezos games most? | Successful calls to curated gaming contracts; unique games primary, calls secondary |
| Governance Maxi | Who keeps showing up for governance? | Recorded proposal/ballot participation across the latest available governance periods |
| Staking Maxi | Who has the largest live staking footprint? | Live staked balance among active funded bakers, with stakers and baking power as context |
| Unicorn | Who genuinely crosses Tezos lanes? | Category breadth first, then normalized score across qualifying non-staking activity categories |

Default recent-activity window: **30 days**. Governance uses the latest
available completed/current voting periods because Tezos governance is not
guaranteed to have ballot activity inside an arbitrary 30-day slice. Staking
is explicitly labeled **live**, not 30-day activity.

### Ranking and identity rules

- Count successful operations only and exclude obvious system/burn/null
  accounts, contracts presented as people, and failed/backtracked activity.
- Prefer breadth before raw call spam for DeFi, Gaming, and Unicorn rankings.
- Publish deterministic tie-breakers beside the ranking implementation:
  primary score, secondary score, most recent qualifying activity, then
  lexicographic address order.
- Resolve a Tezos Domains name or TzKT alias when available, but always show a
  shortened address and keep the address as the stable identity.
- If a category has no trustworthy qualifying result, render an explanatory
  quiet state instead of inventing a winner.
- Label source coverage. A category backed by a curated contract registry says
  so and links to the methodology; it must not imply that unknown contracts
  were classified.

## Data architecture

### 1. Generated snapshot, not a browser-wide chain scan

Create `scripts/refresh-maxis-data.mjs` and a generated
`data/maxis-leaders.json` artifact. The script will page authoritative APIs,
apply the declared taxonomy and scoring rules, and write a compact snapshot:

```json
{
  "generatedAt": "ISO timestamp",
  "window": { "kind": "rolling", "days": 30, "from": "ISO", "to": "ISO" },
  "coverage": { "source": "TzKT / OBJKT", "notes": [] },
  "leaders": [
    {
      "category": "collector",
      "address": "tz1…",
      "alias": "name.tez",
      "score": 42,
      "scoreLabel": "42 purchases",
      "context": ["17 collections", "1,234 ꜩ volume"],
      "lastActivity": "ISO timestamp",
      "sourceUrl": "https://…"
    }
  ]
}
```

Why generated data:

- exhaustive pagination and category aggregation do not belong on every page
  load;
- GitHub Pages can serve a small cacheable artifact quickly;
- a timestamped snapshot permits honest stale/error states;
- the ranking code can be tested deterministically with fixtures.

Wire the refresh into the existing generated-surface conventions only after
measuring request cost. If a full refresh is too expensive for every commit,
add a scheduled/manual mode and keep pre-commit to schema validation rather
than silently slowing normal commits.

### 2. Source validation before coding the collectors

Verify the current primary-source schemas and rate limits before locking the
implementation:

- TzKT accounts/delegates for transaction and staking leaders;
- TzKT ballot/proposal operations plus the repo’s generated governance history
  for participation continuity;
- OBJKT GraphQL and/or TzKT token transfers for purchase and mint semantics;
- TzKT transaction calls for DeFi and Gaming activity;
- Tezos Domains/TzKT metadata already used by the site for display identity.

Prefer server-side filtering and pagination. If an API cannot support an
exhaustive 30-day result at reasonable cost, narrow and relabel the category
before implementation rather than presenting a sampled winner as “top.”

### 3. Curated app taxonomy

Add a small reviewed registry such as `data/maxis-contracts.json` for DeFi,
Gaming, marketplaces, and mint contracts. Each entry includes category, app
name, contract address, provenance/source URL, and optional entrypoint rules.
Keep scoring logic in the refresh script and taxonomy in data so classification
changes are reviewable without rewriting UI code.

The script validates duplicate addresses, invalid Tezos addresses, missing
provenance, and category collisions. Contracts serving multiple legitimate
roles must declare those roles explicitly; the scorer deduplicates operations
for Unicorn breadth.

### 4. Freshness and fallback

- Render the last valid snapshot immediately.
- Show `Updated …` and the exact scoring window in the chamber header.
- Mark snapshots stale after a documented threshold (target: 48 hours).
- Keep previous leaders visible with a stale label if refresh fails; never
  replace them with fabricated placeholders.
- Include per-category source/method text and a chamber-level methodology
  drawer or panel.

## Chamber implementation

### Feature module and styling

Create `js/features/maxis.js` and `css/maxis.css` following the existing
chamber overlay conventions:

- lazy stylesheet loading;
- accessible dialog semantics, focus return, Escape/overlay close, scroll lock;
- loading skeleton, quiet/error/stale states, and retry;
- in-place refresh without rebuilding the overlay while a user is reading;
- responsive leader-card grid with a deliberate featured Unicorn card;
- restrained identity treatment—recognizable and fun, but not a generic gaming
  leaderboard or a wealth-celebration wall.

Each leader card contains category, resolved identity, shortened address,
primary score, one or two context metrics, scoring window/freshness, source
link, and these actions:

- **Trace in Ledger Flow** → `/#ledger-flow=<encoded address>`;
- **Open in My Tezos** → the existing address-scoped My Tezos route;
- **View source** → a relevant TzKT/OBJKT primary-source page.

The homepage entry card should preview several category winners rather than
repeat a marketing sentence. It opens the full chamber and has a copyable
`/maxis/` route.

### App wiring

Update the established source-of-truth surfaces together:

- `js/core/app.js`: initialization, pretty-path hydration, hash/deep-link
  handling, close-before-route behavior, and chamber entry ordering;
- `js/core/site-map.js`: canonical navigation/search entry under Live Rooms;
- `scripts/lib/chamber-routes.mjs`: `/maxis/` title, description, accent,
  canonical URL, and OG metadata;
- `index.html`: module preload and any shared shell/footer discovery link;
- `README.md`: chamber map, route list, and data-source/method contract;
- `js/features/changelog.js`: concise user-facing feature entry;
- `sw.js` and lazy CSS query stamps: cache alignment after JS/CSS changes.

Regenerate route shells with `npm run routes:chambers` and served CSS with
`npm run build:css`. Treat generated route HTML and `styles.min.css` as outputs,
not hand-edited sources.

## Testing

### Deterministic data tests

Add fixtures around the ranking functions covering:

- success/failure filtering and operation deduplication;
- contract taxonomy classification;
- address exclusion rules;
- primary/secondary/recency/address tie-break order;
- DeFi/Gaming breadth beating call spam;
- governance’s period-based window;
- Unicorn eligibility and normalized cross-category scoring;
- stale snapshot and category-empty behavior.

If the repo has no suitable unit harness, expose a validation/dry-run mode from
the refresh script and assert its output in `tests/static-checks.mjs` with a
small local fixture—do not make CI depend on live network results.

### Route and interaction coverage

Extend static/smoke coverage to prove:

- `/maxis/` is generated with correct canonical/OG metadata and hydrates the
  real chamber with an empty hash;
- the site-map/search entry opens `/maxis/`;
- entry card and full chamber render a known fixture winner;
- `Trace in Ledger Flow` opens the selected address, not an empty flow;
- source links remain external and do not close the chamber unexpectedly;
- Escape layering, focus return, background scroll lock, and retry work;
- loading, stale, partial-category, and total-error states are readable;
- 375 px mobile has no horizontal escape.

### Browser QA

Serve locally and inspect the rendered result at minimum in:

- default/dark desktop;
- clean/light desktop;
- default/dark 375 px mobile;
- clean/light 375 px mobile.

Verify card hierarchy, long aliases/addresses, the featured Unicorn, stale and
empty states, direct `/maxis/` loading, Ledger Flow handoff, and service-worker
freshness. Capture screenshots for the final handoff.

## Implementation order

1. Confirm the current dirty worktree and preserve all unrelated pending edits.
2. Validate live API schemas and settle exhaustive, accurately labeled metrics.
3. Add the taxonomy and refresh script with deterministic fixtures/validation.
4. Generate and inspect the first `maxis-leaders.json` snapshot.
5. Build the chamber module, entry card, and scoped styles.
6. Wire site map, route generation, app hydration, shell discovery, README, and
   changelog.
7. Regenerate CSS and chamber route shells; align cache stamps.
8. Run focused tests, then the full static/smoke suite.
9. Complete desktop/mobile and dark/light browser QA; fix visible regressions.

## Acceptance gate

The chamber is complete only when every visible winner is reproducible from the
published method and snapshot, every card reaches that exact address in Ledger
Flow, `/maxis/` is a first-class generated route, stale/partial data is honest,
tests pass, and the rendered layout survives the four required browser states.

## Implementation status — 2026-07-09

Implemented with two evidence-driven refinements after validating the live
source schemas:

- the art surface is split into **Collector Maxi**, **Art Maxi** (artist sales
  volume), and **Mint Maxi** (distinct tokens minted) so buying, selling, and
  creating are not collapsed into one ambiguous score;
- **Transaction Maxi** uses TzKT's exhaustive all-time account transaction
  counter rather than implying that a sampled recent-operation scan is a
  chain-wide result.

The delivered chamber therefore has nine ready cards: Transaction, Collector,
Art, Mint, DeFi, Gaming, Governance, Staking, and Tezos Unicorn. The rolling
categories use a 30-day window, Staking is explicitly live, Transaction is
explicitly all-time, and the generated snapshot declares coverage, freshness,
and truncation state. All nine cards link the exact leader address into Ledger
Flow.
