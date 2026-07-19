# Tezos Systems

Real-time Tezos network dashboard for consensus, economics, governance, market
state, baker activity, and ecosystem signals.

Live site: [tezos.systems](https://tezos.systems)

## What This Is

Tezos Systems is a static, client-side dashboard for understanding what is
happening on Tezos without digging through several explorers and data services.
It is built for bakers, stakers, governance watchers, and people who want a
fast read on network health.

The app is vanilla HTML, CSS, and JavaScript ES modules. There is no runtime
framework, no bundler, and no client-side build step for JavaScript or HTML.
The repo does use npm tooling for reproducible installs, smoke tests, CSS
minification, Playwright, governance refresh scripts, and shared git hooks.

## Current Reality

- Live hosting: GitHub Pages from `main`, with custom domain from `CNAME`.
- Local server: `npm run serve`, which runs `python3 -m http.server 9000`.
- Served stylesheet: `css/styles.min.css`; edit `css/styles.css` first, then
  run `npm run build:css`.
- Critical first-paint skeletons live in `css/loading.css`.
- Shared hook wrapper: `.githooks/pre-commit`; enable it once per clone with
  `npm run install-hooks`.
- README sync guard: pre-commit blocks when staged changes touch
  README-documented behavior but `README.md` is not staged.
- Version metadata: `version.json` is stamped by the pre-commit hook and shown
  in the faint footer build marker alongside the latest GitHub `main` commit.
- Standard verification: `npm test`, which runs static checks and browser smoke
  tests.

## Project Structure

```text
tezos.systems/
├── index.html                         # Main SPA shell, CSP, schema, dashboard DOM
├── landing.html                       # Welcome and SEO landing page
├── css/
│   ├── styles.css                     # Source dashboard styles and themes
│   ├── styles.min.css                 # Served base dashboard stylesheet
│   ├── loading.css                    # Critical first-paint skeleton states
│   ├── network-health.css             # Lazy Network Health detail-panel styles
│   ├── capital.css                    # Lazy Capital Chamber styles
│   ├── themes/                        # Generated lazy-loaded theme bundles
│   ├── hen-mode.css                   # HEN overlay styles
│   └── landing.css                    # Landing and SEO page styles
├── js/
│   ├── core/
│   │   ├── app.js                     # App orchestration, DOM wiring, refresh loop
│   │   ├── api.js                     # TzKT, Octez RPC, Supabase, Tezos data fetches
│   │   ├── config.js                  # Endpoints, refresh intervals, constants
│   │   ├── etherlink-governance-contracts.mjs # Reviewed L2 governance lineage
│   │   ├── tzkt-throttle.js           # Browser-local TzKT request pacing
│   │   ├── protocol-count.js          # Human-facing upgrade count convention
│   │   ├── wallet.js                  # Lazy Octez.Connect wallet bridge
│   │   ├── storage.js                 # localStorage/sessionStorage wrappers
│   │   └── utils.js                   # Formatting, sanitization, utility helpers
│   ├── features/                      # Governance, LB, bakers, market, feeds, widgets
│   ├── ui/                            # Theme, share, toast queue, gauge, title, animations
│   └── effects/                       # Matrix, themed backgrounds, audio/vibes, data-magic text reveals
├── data/
│   ├── protocol-data.json             # Activated protocol timeline and lore
│   ├── protocol-debates.json          # Debate/rejection narratives
│   ├── governance-votes.json          # Generated governance vote history
│   ├── governance-refresh-report.json # Generated stale-data/lore audit
│   ├── milestone-catalog.json         # Cadence-generated milestone thresholds
│   ├── nakamoto-sources.json          # Dated external Nakamoto source ledger
│   ├── capital-snapshot.json          # Generated, source-receipted Capital snapshot
│   ├── maxis-contracts.json            # Reviewed app/entrypoint taxonomy
│   ├── maxis-careers.json              # Exact all-history governance career records
│   ├── maxis-l2-governance.json         # Exact all-history Etherlink governance careers
│   ├── maxis-leaders.json              # Generated canonical lane-native-clock Maxis snapshot
│   ├── maxis/
│   │   ├── manifest.json               # Protocol-season index and active season
│   │   └── seasons/<season-id>/
│   │       ├── summary.json            # Season lanes, standings, deltas, and Honors
│   │       ├── rules.json              # Frozen season scoring and badge rules
│   │       ├── transaction-state.json  # Last complete signed accumulator; not a browser payload
│   │       ├── transaction-state.building.json # Optional signed resume sidecar; never publishable
│   │       └── passports/00.json..3f.json # 64 deterministic address buckets
│   └── tweets.json                    # Share-copy templates
├── widgets/                           # Standalone embeddable widgets, shared runtime, and builder
├── staking/ governance/ bakers/ hen/ compare/
│                                      # SEO and standalone pages
├── chamber/ pulse/ capital/ stake/ maxis/ health/ tezosx/ l2chamber/ tz4/ lb/ ledger-flow/ domains/ ctez/
│                                      # Pretty share/OG routes into live Chambers
├── og/                                # Generated per-chamber OG images
├── feed.xml                           # Generated Tezos governance RSS feed
├── supabase/
│   └── migrations/                    # SQL contract for historical capture
├── tests/
│   ├── static-checks.mjs              # Dependency-free repo contract checks
│   └── smoke.mjs                      # Playwright browser smoke suites
├── scripts/
│   ├── refresh-governance-data.mjs    # Canonical governance refresh command
│   ├── refresh-maxis-data.mjs         # Canonical Maxis and protocol-season artifacts
│   ├── refresh-maxis-careers.mjs      # Canonical governance career history
│   ├── refresh-maxis-l2-governance.mjs # Canonical Etherlink governance career history
│   ├── refresh-nakamoto-sources.mjs   # Dated external Nakamoto source ledger
│   ├── refresh-capital-data.mjs       # Public-source Capital snapshot generator/checker
│   ├── lib/maxis-l2-governance.mjs     # Etherlink career scoring and validation
│   ├── lib/maxis-artifact-budget.mjs  # Exact pretty-JSON byte-budget receipts
│   ├── lib/maxis-evaluator-v2.mjs     # Immutable v2 season scoring/validation
│   ├── lib/maxis-source-v2.mjs        # Immutable v2 source/query and build adapter
│   ├── lib/maxis-transactions-v2.mjs  # Immutable v2 transaction checkpoint semantics
│   ├── refresh-generated-surfaces.mjs  # Commit/scheduled generated-surface orchestrator
│   ├── generate-chamber-routes.mjs    # Pretty Chamber route generator
│   ├── generate-chamber-og-images.mjs # Per-Chamber OG image generator
│   ├── generate-milestone-catalog.mjs # 14-day/100-commit milestone refresh
│   ├── bake-compare-pages.mjs         # Static compare-page content baker
│   ├── build-css.mjs                  # Base/theme CSS splitter and minifier
│   ├── update-governance-votes.mjs    # Compatibility wrapper
│   ├── stamp-version.sh               # Pre-commit version metadata stamp
│   └── generate-og-image.js           # OG image generator
├── .github/scripts/
│   ├── collect-data.js                # 2-hour global Supabase history row
│   └── collect-chamber-history.js     # 30-minute chamber/domain snapshots
├── .githooks/pre-commit               # Shared local hook wrapper
├── LICENSE                             # Mozilla Public License 2.0 terms
├── NOTICE                              # Project attribution and license scope
├── sw.js                              # Bounded shell cache and offline strategy
├── version.json                       # Served build metadata
├── site.webmanifest
├── robots.txt
└── sitemap.xml
```

## Runtime Flow

1. `index.html` loads `css/styles.min.css` and `js/core/app.js` as an ES
   module.
2. `app.js` installs `js/core/tzkt-throttle.js` before feature startup so
   browser-side TzKT API fetches are queued at six request starts per second.
   Standalone landing, compare, and widget entry points import the same shim
   for their separate browser windows or iframes. Widget pages go through
   `widgets/runtime.js`, which also shares the dashboard theme metadata,
   endpoint config, fetch retry/cache helper, and widget catalog.
3. `app.js` initializes feature modules behind safe wrappers, registers the
   service worker, handles deep links, and starts the refresh loop.
4. Cached stats and protocol data are displayed first when available.
5. First-visit default content is the command deck plus the Chambers section.
   During proposal and ballot windows, a compact Governance Alert strip sits
   above Chambers and reuses the live voting/My Tezos baker-vote logic to expose
   Chamber, My Tezos, RSS, and browser-reminder actions. Outside active voting
   windows, the strip stays hidden. Explore now leads with the canonical Network
   Pulse, Staking Chamber, and Tezos Maxis starter paths, while live signals and
   specialist tools stay folded by category; legacy `#section=...` links can
   still reveal the inline stat sections for focused QA and deep links.
6. Background refreshes update hero stats, comparison data, governance state,
   cycle pulse, daily briefing, rewards tracker, price intelligence, baker
   tools, leaderboard, My Tezos, and share-ready UI through quiet DOM
   reconciliation: timed updates preserve page and chamber scroll, focused
   controls, text selection, and existing panel nodes, while hidden tabs defer
   network polling until they become visible. Welcome, streak,
   anniversary, network-moment, and cycle toasts go through a shared priority
   queue after the hero arrival settles so first-load signals do not stack over
   one another.
7. Sparkline cards draw their series from historical snapshots, then align the
   final point with the latest live stat so chart endpoints and card values
   agree.
8. DOM elements are updated directly by id and class. There is no app state
   framework.

Current refresh and cache intervals from `js/core/config.js`:

- Headline telemetry refresh: 15 minutes; full dashboard refresh: 2 hours.
- Sparkline refresh: 10 minutes.
- Price refresh: 30 minutes.
- Memory cache TTL: 1 minute.
- Storage cache TTL: 4 hours.

## Themes

There are 14 visual themes in `js/ui/theme.js`. `aurora` is the default theme.
The theme picker groups animated themes separately from classic data-focused
themes, and stores the selection in `localStorage` under
`tezos-systems-theme`.
Aurora's header title uses a desktop-specific multicolor sweep so the one-line
wordmark stays as vivid as the wrapped mobile title.

| Theme | Role |
|-------|------|
| `aurora` | Default animated aurora theme |
| `matrix` | Terminal/data-rain theme |
| `hen` | hic et nunc terminal/CRT theme |
| `default` | Midnight classic |
| `void` | Deep-space particle theme |
| `ember` | Warm particle theme |
| `signal` | Tech/signal theme |
| `nerv` | Operations-console theme |
| `clean` | Light analytics theme |
| `dark` | Achromatic dark analytics theme |
| `bubblegum` | Pink playful theme |
| `abyss` | Deep-ocean theme |
| `moss` | Green organic theme |
| `warzone` | Amber command theme |

HEN is both a selectable persisted dashboard theme and a separate live-feed
overlay entry point. `/hen/` is the canonical, crawlable live-feed page and
opens the collecting surface immediately; the legacy `/?hen=1` entry still
activates the feed and canonicalizes to `/hen/`. The feed shows Teia/HEN contract mints and OBJKT artist
collection mints together by default. The HEN overlay uses a fixed grid shell:
header, status, feed, and CLI rows stay stable while terminal scrollback, new
mint pulses, the collecting hint, idle/listening state, and the now-playing
arrival panel float off-flow over the feed. Live arrival chrome is suppressed
while the expanded piece viewer is open, `now playing` is throttled to avoid
interrupting readers, and the sticky new-mints pill accumulates unseen mints
until the visitor jumps back to the top. The visible HEN filter bar is the
primary collecting surface: explicit Source, Price (ꜩ), Edition, and Sort
labels keep its for-sale, price, search, edition, sort, saved, hide-owned, and
shuffle controls understandable without requiring the CLI; desktop gets
a clipped edge fade when controls overflow, while mobile keeps the controls
collapsed behind an anchored `filters` toggle; opening it drops the filter tray
below the status line without dislodging the toggle. First-time HEN visitors see
a dismissible hint that points
them to For Sale plus wallet-owned flags. Inside the HEN CLI,
`all`, `teia`, and `objkt` switch source scope; `forsale on|off`,
`price <max>`, `editions <max>`, `sort <newest|cheapest|scarce>`,
`saved on|off`, `hideowned on|off`, `wallet <tz1...|name.tez|me|clear>`,
`random`/`r`, `crt`, and `filters` mirror or extend the visible controls. CLI
dismissal clears retained scrollback, `artist <tz1...>` validates Tezos
addresses before querying, and global arrow/random shortcuts stop at the
expanded viewer boundary. The selected source and sort are remembered for the
next HEN session, and non-newest sorts show that live prepend is paused instead
of silently going quiet. HEN
starts from the current My Tezos
address when one is saved, and its wallet controls explain that connecting flags
owned pieces; they can pair through Octez.Connect, accept a raw address, or
resolve a `.tez` name. Any HEN address update writes back to My Tezos and saved
address history. HEN preloads Octez.Connect on entry, keeps wallet pairing
overlays visible above the NFT overlay, and returns the connect control to a
retryable state if a wallet prompt never answers. New live arrivals prepend
themselves into the top of the feed automatically when the feed is sorted by
newest; if a visitor is scrolled down, the feed compensates scroll position and
shows a floating `new mints` pill instead of shoving visible cards. Quiet newest
polls let the header dot enter a real `listening` state, busy poll windows page
through multiple fresh batches before advancing the high-water mark, and long
sessions cap token/profile/domain caches while card timestamps update only while
HEN is active. Teia cards carry a cyan left edge, OBJKT cards carry a green top
edge, and source tabs pulse when a source delivers a mint. HEN card media retries
failed IPFS loads across fallback gateways, HEN grid/profile thumbnails load from
OBJKT's media CDN first before falling back to live IPFS gateways, and video
pieces autoplay only for the first eager rows or on hover/focus. The overlay now
owns the reusable OBJKT profile stats for owned NFTs, recent acquisitions,
created NFTs, marketplace activity, and lifetime totals.

Theme support is intentionally broad but scattered. When changing themes, check
`js/ui/theme.js`, CSS variables and overrides, `js/ui/share.js`,
`js/ui/gauge.js`, `js/features/history.js`, `js/effects/bg-effects.js`, and
inline modal styles in `js/core/app.js`.

## Main Surfaces

- Explore is a progressively disclosed launcher rather than a second dashboard:
  Chambers stays the hero, the three canonical starter rooms fit in the first
  mobile view, and live signals, baker tools, account tools, markets, publishing,
  and recovery open only when requested. Its mobile corner gift launcher owns a
  dedicated in-flow slot beside the top price rail and scrolls away with that
  rail instead of painting over telemetry or the centered wordmark.
- Chambers section is visible by default and orders the chamber rows as Network
  Pulse <> Capital Chamber, the narrow Staking Chamber, Network Health <> Tezos L1 Governance, Tezos X <> Tezos X Governance,
  tz4 Adoption <> LB Monitor, Ledger Flow <> Protocol History, Tezos Maxis, then
  a full-width Tezos Domains strip at the bottom. ctez Oven Exit and KT1
  Multisig Recovery stay off the
  default Chambers grid and open from Explore's collapsed Recovery tools drawer
  or the corner gift tray launcher.
  Each Chamber row is wrapped responsively so wide cards keep their companion
  card instead of creating desktop grid holes; cards also keep a canonical
  app-shell open affordance in the fixed footer rail, card-level direct-link
  controls, a matching section info button, and quiet `as of` freshness stamps on
  the live chamber cards.
- A live block ticker sits as its own island below the header/title row and
  above the command deck.
  It uses the Network Health block feed to show the latest block, baker,
  attestation health, attested power, round, and age in a single
  animated strip with stable-width volatile numbers, compact baker names, and a
  clean whole-line transition.
  Clicking the strip opens the Network Health Chamber.
- The header keeps the current protocol beside the Tezos Systems title, promotes
  the live NFT feed doorway into the right-side navigation, and turns mainnet
  age into a first-screen statement with years/days/hours/minutes plus a
  `mainnet age · since 2018` label. The counter measures elapsed time
  since launch, not an availability percentage or incident ledger. Active baker
  count, finality, staked share, and issuance rate remain in theme-matched stat
  pills.
  On the September 17 UTC mainnet anniversary, the continuity statement switches to
  a congratulatory anniversary message while preserving the live counter.
  Imminent or newly crossed network milestones make the runtime glow and add a
  compact linked marker immediately to the right of the uptime/year counter,
  while remaining visually subordinate to the larger mainnet continuity counter;
  the marker opens Network Pulse or the most relevant Chamber while the continuity
  statement still opens Protocol Anthology.
  Clicking a stat pill opens that metric's historical stats surface.
- The Network Health Chamber contains the fuller Mainnet Continuity panel with
  the same chain-age and upgrade-history context, explicitly separated from
  availability monitoring.
- Tezos X Governance Chamber with direct `#l2chamber` access and visible L2
  Governance labeling,
  live FAST, SLOW, and Sequencer track status sourced from TzKT contract
  discovery, storage, bigmaps, and recent historical proposal submissions, plus
  official-track and TzKT links for action/audit. The dashboard card keeps
  compact track chips visible even when all tracks are idle, keeps its open
  control clear of those chips, computes period countdowns from the current
  head block, and the open chamber now includes track rules, track memory, and
  a merged submission/vote timeline for each L2 governance track. Active
  proposal and Promotion views lead with the complete represented-baker receipt
  ledger in first-to-latest order. Every row shows its ballot or upvote, exact
  UTC receipt time and level, matching L1-period voting power, individual and
  cumulative quorum contribution, and the receipt that crossed quorum. Shared
  voting-key calls are expanded into the baker accounts they represent and every
  row retains its operation link for audit.
- Tezos X Chamber with direct `#tezosx` access, atomic L2 TVL, daily
  transactions, gas, addresses, grouped Blockscout transaction tape rows, and
  DefiLlama protocol TVL sourced from current Etherlink rails. The open chamber
  also layers in 30-day TVL/transaction/active-address direction with
  quiet-state fallbacks, TzKT smart-rollup anchor metadata, gas oracle detail,
  and top tokens by holders when those upstream feeds are available.
- Network Pulse Chamber with direct `#pulse` and `/pulse/` access. It gathers
  consensus, economy, governance, network activity, ecosystem, and adjacent
  chamber signals into one categorized live card field while keeping the
  original inline stat sections available through `#section=...` deep links.
- Capital Chamber with direct `#capital` and `/capital/` access. Four sourced
  views organize the cross-layer capital picture without pretending their
  unlike metrics share one definition: **One System** (`?view=system`) connects
  Tezos and Etherlink activity, TVL, stablecoins, protocols, and Octez
  development; **Markets** (`?view=markets`) compares XTZ in USD, BTC, and ETH
  and exposes exchange-market snapshots; **Assets** (`?view=assets`)
  separates public registry discoveries from issuer-confirmed xU3O8 evidence;
  and **Art** (`?view=art`) presents OBJKT-indexed sales, mints, collections,
  buyers, and artists. Shared 30D, 3M, 6M, 1Y, and 2Y controls disable ranges
  that the source snapshot cannot honestly supply. The browser reads one
  same-origin generated snapshot, refreshes it only while the room and tab are
  visible, and keeps its per-source status, timestamp, coverage, and methodology
  visible instead of making a third-party request fan-out when the room opens.

  Capital's limits are part of the product contract. Tezos transaction history
  is a truncated 30-day count of applied TzKT operations, including indexed
  internal calls, and is not labeled as equivalent to an Etherlink EVM
  transaction. Stablecoin USD totals keep canonical and bridged components
  separate because bridge double counting remains possible. CoinGecko exchange
  rows are capped at 100; comprehensive CEX net flows are not calculated without
  audited exchange-wallet clusters. Public RWA registry rows do not imply issuer
  verification; only xU3O8 carries its issuer proof receipt, its Blockscout
  transfer detail is a recent/current truncated view, and the exact xU3O8 versus
  SRUUF return spread remains unavailable without licensed SRUUF closes. OBJKT
  coverage can be a capped most-recent prefix and does not prove every historical
  or independent marketplace. The development view covers 28 days of the
  canonical Octez `master` branch only, counts distinct author-name strings rather
  than verified identities, and is not a measure of all Tezos development.
  Comprehensive community/X/podcast composites remain explicitly unavailable
  until licensed coverage and a versioned deduplication/sentiment methodology
  exist.
- Staking Chamber with direct `#staking` and `/stake/` access, while the existing
  `/staking/` guide remains the explanatory staking page. Its narrow launcher
  keeps one latest applied stake and one latest applied unstake strictly over
  10,000 tez visible. The opened room shows the canonical current staking ratio,
  seven-day direction, threshold-scoped 24-hour gross/net flow, a cursor-scanned
  persistent incremental history of qualifying TzKT receipts, local address
  search, filtered CSV export, and full per-mover stake/unstake trails with
  Ledger Flow and TzKT links. The archive resumes from per-action high-water
  marks instead of rebuilding the same history on every visit. It uses each operation's processed
  `amount`; `requestedAmount`, finalize operations, rewards, slashes, and baker
  autostaking are not presented as new user staking decisions.
- Tezos Maxis Chamber with direct `#maxis` and `/maxis/` access, organized into
  four rooms: **Maxis**, **Season**, **Passport**, and **Champions**. **Maxis is
  the default canonical identity layer**: its scannable all-lane overview answers
  who holds each objective crown using that lane's honest natural clock, such as
  all-time Transaction, all-time-active Governance, live Staking, rolling
  Art/DeFi, or cross-lane Unicorn breadth. These unlike clocks are labeled
  prominently and are never blended or relabeled as one time window. The
  full-width homepage launcher keeps the current lane holders readable and
  treats the active protocol season as a smaller race pulse rather than
  replacing the enduring Maxis view.
- Season is the protocol-bounded game layer, beginning with Ushuaia. Its end is the next known
  activation, or honestly remains open-ended while that activation is
  unscheduled. A circular selector appears only in room contexts where choosing
  a season changes the displayed result. One-lane progressive disclosure keeps
  the active race, podium, ranks four through ten, nearest challenger, an
  actionable primary-metric guarantee plus a clearly labeled conservative
  score-vector path, rank movement, cutoff, and trajectory Honors readable.
  Crown metrics remain objective standings; climb, debut, consistency, and
  comeback Honors are a separate game layer.
  A manifest or summary fetch failure renders as a scoped unavailable state
  with retry affordance; it must never masquerade as an empty or pre-season
  result.
- Governance deliberately has three distinct clocks: the canonical Maxis crown
  uses all-time participation among currently active delegates, the current
  governance-period context explains whether an actionable vote exists now, and
  the protocol-season lane is an episodic race that may honestly be quiet. An
  empty seasonal interval never erases or replaces the enduring Governance Maxi.
  `data/maxis-careers.json` independently reconstructs every applied ballot and
  proposal against the complete voting-period ledger, exposing lifetime actions,
  participated periods, longest/current ballot-period streaks, last activity,
  and current active-delegate rank without changing any frozen season evaluator.
- L2 Governance is a second, independent all-time-active crown. A represented
  baker earns one participation unit for each distinct completed official
  Etherlink FAST, SLOW, or Sequencer proposal/Promotion window in which the
  complete TzKT governance big-map state contains that baker. Extra proposal
  upvotes, authored proposals, ballot choice, voting power, and repeated
  receipts never multiply the window score. The official Etherlink
  `/api/{track}/pastPeriods` ledgers define the canonical production windows;
  TzKT big-map inventories and every key in the matching participant maps prove
  applied participation. Identity comes from the represented baker stored in
  those maps, never the transaction sender, so a delegated voting key remains
  attributed to its baker. Career records retain inactive bakers, while the
  crown ranks only the complete current active-delegate set by distinct windows,
  then track breadth, Promotion windows, receipt count, recency, and address.
  `data/maxis-l2-governance.json` and its Passport career card remain outside
  the immutable v2 protocol-season evaluator: they do not alter Season,
  Season Unicorn, frozen Passport shards, or Champions.
- Maxi Passport is the address-level progression view. It accepts an explicit
  address, a `.tez` name or subdomain, or the saved My Tezos address without
  changing that saved identity. Domain lookups prefer the configured forward
  address and fall back to the domain owner only when no valid address is set,
  then canonicalize the Passport route to the resolved account. The view
  separates enduring career badges, bests, and crown history from
  current-season lanes, near misses, supported streaks, and progress toward Season
  Unicorn. The career ledger loads this address's independently verified shard
  from every season in the manifest, preserving repeated receipts by season and
  deriving cross-season high-water marks without comparing raw scores across
  changed rulesets. Stable badge thresholds and the moving “pass #10” cutoff are
  deliberately distinct; repeatable achievements carry season-scoped IDs so
  later protocol seasons do not overwrite earlier receipts. My Tezos exposes a
  direct Passport handoff for the active saved address.
- The canonical Maxis room reads the generated `data/maxis-leaders.json`
  lane-native-clock snapshot plus the independently integrity-checked
  `data/maxis-l2-governance.json` crown. Champions reads finalized protocol-season
  archives and preserves past winners, exposing the champion address and score,
  Ledger Flow trail, source receipt, final standings, and frozen rules for each
  result. At activation the new season opens at
  once while the prior season spends at least 24 hours concurrently in a
  non-champion settling state, then receives one exact-boundary rebuild under
  its frozen evaluator; temporary active leaders never receive permanent
  champion badges and there is no rollover board blackout. Current season data is indexed by
  `data/maxis/manifest.json`, with frozen rules and standings under
  `data/maxis/seasons/<season-id>/` and deep Passport coverage split across 64
  deterministic `00`–`3f` address shards. Every lane publishes its method and
  per-source completeness receipt; a lane that cannot be measured exhaustively
  renders as unavailable rather than promoting a sampled winner. Curated app
  lanes use `data/maxis-contracts.json`, and same-season Unicorn breadth never
  mixes activity from different protocol windows. Transaction Maxi uses a
  season-owned, strict-ID resumable accumulator with a fixed exclusive block
  boundary and replacement tail; its raw TzKT count must reconcile before the
  lane can publish. Long scans checkpoint into a signed
  `transaction-state.building.json` sidecar without changing the last published
  manifest, summary, or Passport shards; only a complete reconciled scan is
  atomically promoted to `transaction-state.json`. Neither file is a browser
  payload.
- Network Health Chamber with direct `#health` access, recent block cadence,
  consensus round, missed attestation, missed baking-right detail, TzKT cyclic
  cycle-time drift, TzKT-reported Octez baker version distribution by baking
  power, a full-width Teztale observer-reception histogram plus exact
  two-thirds/90% arrival and validation-to-quorum timing credited to Nomadic
  Labs, live current-cycle address-level Nakamoto coefficients at strict
  one-third and two-thirds thresholds, dated Chainspect/Edinburgh EDI/CoinClear
  reports with their original methods intact, print/tweet-ready coefficient
  cards that retain the address-versus-operator caveat, and a compact saved My Tezos
  baker summary. Its Chambers card spans two
  tiles and includes compact block-power bars plus a deduped throttled 1,000+
  XTZ live activity tape; the open chamber refreshes on the block cadence with
  in-place row updates instead of a full rerender, and now adds incident memory,
  cycle timing, Octez versions, period telemetry, network-load, and Consensus
  Lens panels.
- Ledger Flow Chamber with direct `#ledger-flow` and `/ledger-flow/` access,
  plus address-scoped hashes such as `#ledger-flow=tz1...`. It resolves tz/KT
  accounts and `.tez` names including subdomains, queries TzKT account
  transaction history, and
  renders an SVG transfer diagram with separate sent, received, and first-in
  colors, amount-weighted connection strength, My Tezos account links, and
  compact TzKT pills.
- Tezos Domains Chamber with direct `#domains` and `/domains/` access, backed by
  the Tezos Domains GraphQL API. Its default Chambers card is a full-width
  bottom strip, not paired with any other chamber, and its chamber lookup checks
  individual `.tez` names for availability, owner, expiry, offers, auctions,
  and recent activity while still surfacing fresh registrations, renewals,
  reverse-record moves, transfers, live auctions, sell offers, buy offers, and
  names nearing expiration.
- Price bar, cycle pulse, daily briefing, rewards tracker, and price
  intelligence.
- First-screen command deck built for retrieval: the top of the page moves from
  live cycle/market data to `Tezos Systems`, a clickable
  `Running on <current protocol>` Protocol History launcher, a live
  block-health ticker, then a pure command bar before Chambers. The former
  command-deck protocol ribbon stays retired so protocol history access is not
  repeated in a third first-screen surface. The bar accepts
  Tezos addresses, `.tez` names, protocol names, block levels, block hashes,
  operation hashes, KT1 contracts, and slash commands. Opening it exposes every
  grouped canonical destination plus runtime actions such as Share, Export,
  Shortcuts, Changelog, and the external TzSafe recovery path. Maxis lane and
  direct chain-comparison intents keep their exact room state. While active, the
  command bar switches the page into a focused search mode that pushes Chambers
  into a barely-visible background layer; on mobile it becomes a contained
  command sheet with a one-line shortcut rail that collapses after typing. The
  compact `What's hot today` live pulse
  sits above Chambers as a horizontally scrolling strip for non-obvious daily
  signals instead of repeating the header's cycle, baker, staking, or security
  facts. Quiet, curious, headliner, peacock, and historic tiers give stronger
  stories progressively larger and more distinctive cards, while September 17
  UTC still leads with the uptime anniversary.
  Pace-aware milestone cards normally appear only within the final 14 days and
  are hard-capped at 30 days before a target; newly crossed milestones remain
  celebratory for 72 hours. Generated catalog receipts make that window shared
  across visitors, target block timestamps provide exact block-height timing,
  and bounded local observation remains only as a fallback. Each milestone card
  can open the existing branded
  image-share composer with milestone-specific promotional tweet styles.
  Internal routes open My Tezos, baker profiles, protocol lore/history,
  Chambers, themes, calculator, comparisons, leaderboard, whale/giant feeds,
  NFT lookup, History, Network Snapshot, and native account/contract/operation/
  block receipt views. `js/core/site-map.js` is the discovery source of truth:
  it owns featured search chips/defaults, relevance-ranked destinations and
  subfeature intents, sitemap metadata, the complete grouped footer map, and
  semantic next-step relationships. The same manifest also declares hash/path
  aliases, canonical share/copy routes, nested Maxis/compare/widget views, and
  the public crawl set, so those surfaces cannot quietly become parallel route
  catalogs. Exact intent ranks before broad keyword matches; Maxis Season,
  Passport, Champions, and lane queries preserve their room state, and pasted
  addresses or `.tez` names also expose a scoped Maxi Passport path. Baker-name
  searches hydrate from active leaderboard data, while TzKT remains available
  from native receipts as an audit trail. Blank search stays intentionally
  compact with eight useful starting points; the `All 47` chip explicitly opens
  the complete manifest directory without making every search session begin in
  an atlas.
- Protocol History Chamber with direct `#protocol-history` access, backed by
  `data/protocol-data.json` and `data/protocol-debates.json`. It preserves the
  protocol timeline, individual protocol lore modals, share capture, and impact
  views while keeping proposal history out of the first-visitor hero path. The
  Chambers entry presents this as a Protocol Anthology: a current chapter,
  lore/impact/memory facets, and recent protocol spines that open into a
  current-first fold-out archive.
  Human-facing upgrade totals use `js/core/protocol-count.js`: Paris C remains
  visible as a protocol-history chapter and DAL follow-up, but it is not counted
  as a separate self-amendment total, so public upgrade counts show 21 while the
  archive still has 22 protocol records.
- The compact Tezos Loop Console near the bottom of the dashboard starts from
  a wallet, baker, contract, collectible, governance, or market intent without
  repeating those six recipes as a second card grid. Its primary destination
  and semantic next steps resolve through the canonical site map, so newly
  added rooms enter the loop without another hand-maintained catalog.
- The footer renders Dashboard plus every canonical Story Room, Live Room,
  Account Room, live signal, guide, tool, and culture/feed destination instead
  of a handpicked subset. Crawlable comparison/widget pages and the core Maxis
  rooms appear as nested views under their parent destination. The Dashboard
  keeps that atlas expanded; standalone pages preserve it behind a local
  `Browse all 47 destinations` disclosure. Expanded Chambers add four semantic
  next steps, and native Network Pulse and Staking now use the same four-link
  model plus quiet Chambers/search exits. Full internal routes prevent modal
  stacks during room-to-room navigation.
- Tezos L1 Governance for live and historical amendment voting, including a
  current-stage chronological ballot feed and the bottom historical vote log
  sourced from `data/governance-votes.json`. The command deck does not carry a
  separate governance prompt; live and quiet governance context lives
  in the Tezos L1 Governance card and modal. The Tezos L1 Governance card refreshes every 60 seconds
  and expands during active ballot periods to show proposal name, time left,
  quorum, supermajority, and ballot context; during Adoption it expands with a
  no-ballot runway explanation and activation timing. The opened L1 governance panel renders
  live vote instrumentation before the process explainer and includes a
  phase-aware current-state panel for quiet proposal/cooldown/adoption moments,
  proposal intel, quorum/non-voter gap analysis, and a vote share capture
  button.
- Governance Alert strip above Chambers during Proposal, Exploration, or
  Promotion only. It turns a saved My Tezos baker into a visible vote/upvote
  check with Chamber, RSS, My Tezos, and optional browser-reminder actions; it
  stays hidden outside active voting windows.
- Liquidity Baking dashboard tile and monitor with EMA state, a compact latest
  baker vote tape on the tile, recent block votes, latest baker votes,
  contextual help, protocol-history lore, EMA threshold meter and auto-scaled
  trend sparkline, 6-second open-monitor refreshes, and 60-second
  dashboard-tile refreshes. The open monitor also
  shows sampled EMA drift/forecasting, a history strip, vote-change feed, and
  top baker signals when no baker is saved.
- tz4 Adoption Chamber with a wide Chambers tile for latest completed switches
  and pending activations, plus baker-count and baking-power adoption readouts,
  current baker BLS/tz4 status, saved-baker highlighting/share, first-switch
  timing, projection to 50%, largest holdouts, visible monthly switch-count
  momentum, power milestones, top-10 first movers, and a capped Baker Status
  table with a Show all control.
- ctez End of Life with direct `#ctez` access, a corner gift-tray launcher, a
  collapsed Recovery tools Explore entry, a native Tezos.Systems My Ovens
  summary/detail console,
  Octez.Connect pairing, TzKT contract storage and big-map discovery for ovens
  owned by the connected wallet, read-only address inspection that does not
  replace the saved wallet, and wallet-reviewed one-batch close requests that
  burn outstanding ctez before withdrawing tez when both legs are needed,
  remain disabled until the connected wallet matches the inspected owner.
  Purple Matter/community fallback links and signing-safety reminders remain
  available for users recovering tez from old ctez ovens.
- TzSafe Recovery as an external stewardship entry in the corner gift tray and
  Explore's collapsed Recovery tools group, linking to
  `https://tzsafe.tez.page/` for the community fork and legacy KT1 multisig
  migration path while new multisig setups move toward protocol-native accounts.
- My Tezos drawer and My Baker lookup, including live drawer-open stats refresh,
  live baker signal refresh, baker Octez version status coloring, baker
  performance, latest LB vote state, Octez.Connect wallet sync, and recent baker
  delegator/staker activity.
- Baker leaderboard, staking calculator, chain comparison, whale feed, sleeping
  giants, HEN NFT/profile mode, TzSafe Recovery, changelog, share captures, and
  embeddable widgets. The leaderboard marks the saved baker, separates open
  delegation-room affordances from scarcer earned descriptors, and shares
  guild-style cards with live proof seals. The
  calculator opens with a 1,000 XTZ starting amount, live APY context, protocol
  timing for first-payout copy, animated results, and private-by-default
  projection sharing. Cycle whispers only announce a real cycle advance near
  the beginning of the cycle.

Useful deep links include:

- `#my-baker=...`
- `/tz1...`, `/name.tez`, or `/sub.name.tez` to resolve directly into My Tezos
- `#baker=...`
- `#calculator`
- `#compare`
- `#leaderboard`
- `#whales`
- `#giants`
- `#history`
- `#protocol-history`
- `#protocol=Ushuaia`
- `#theme=...`
- `#section=...`
- `#price`
- `#chambers`
- `#pulse`
- `#capital`
- `#staking`
- `#maxis`
- `#l2chamber`
- `#tezosx`
- `#health`
- `#chamber`
- `#lb`
- `#lb-tile`
- `#tz4`
- `#ledger-flow` or `#ledger-flow=tz1...`
- `#domains` or `#domains=name.tez`
- `#ctez`

Public share routes are also available at `/my/`, `/chamber/`, `/pulse/`, `/capital/`, `/stake/`, `/maxis/`, `/health/`,
`/tezosx/`, `/l2chamber/`, `/tz4/`, `/lb/`, `/ledger-flow/`, `/domains/`, and
`/ctez/`.
These routes carry unique Open Graph metadata and hydrate the corresponding
live dashboard room at the clean URL.
`/feed.xml` exposes the generated governance RSS feed for relay bots.
The governance SEO page also funnels high-intent searches into `/chamber/`,
`/my/`, and `/feed.xml` for live vote checks and syndication.

## Data Sources

| Source | Purpose |
|--------|---------|
| TzKT `https://api.tzkt.io/v1` | Chain stats, delegates, baker Octez software/version telemetry, blocks, operations, account transfer flow, governance, accounts, Maxis account/delegate ranks and recognized app calls, Etherlink governance contract discovery/storage/bigmaps, ctez oven discovery, and Capital's Tezos counters and 30-day transaction-operation series |
| Octez RPC `https://eu.rpc.tez.capital` | Issuance, supply, constants, cycle/head metadata |
| Official Octez mainnet RPC `https://tezos-mainnet.octez.io` | Current-cycle baking-power distribution used for Network Health's live one-third and two-thirds address coefficients |
| Teztale `https://teztale-server-mainnet-ro-prd.octez.tech` | Consensus timing lens for Network Health, including earliest-observer, endorsing-power-weighted reception distributions, exact two-thirds and 90% arrival thresholds, validation-to-quorum phases, and observer count; Teztale is by Nomadic Labs |
| `data/nakamoto-sources.json` | Same-origin dated ledger of Chainspect, Edinburgh EDI, CoinClear, and explicitly marked Chainspect-derived historical reports; scheduled server-side refresh avoids third-party browser CORS limits |
| CoinGecko | XTZ price, market cap, 24h change, volume, USD/BTC/ETH histories, exchange ticker snapshots, and public RWA token mappings |
| Tezos Domains GraphQL | Domain/reverse-record lookups plus live events, auctions, offers, buy offers, and 30-day expiration pressure |
| OBJKT APIs | HEN mode's live Teia + OBJKT feed, collector and creator profile stats, Maxis 30-day buyer/artist ranks, and Capital's source-bounded art-economy history |
| Supabase REST | Historical Tezos snapshots via public anon client config |
| DefiLlama `https://api.llama.fi` | Tezos and Etherlink TVL, protocol, stablecoin, and public RWA registry histories; DefiLlama currently indexes Tezos X as Etherlink |
| Etherlink Blockscout `https://explorer.etherlink.com/api/v2` and stats service | Tezos X chamber transaction, address, gas, and block stats plus Capital's current counters, daily activity, and xU3O8 token receipts |
| Uranium.io issuer documentation | Issuer-confirmed xU3O8 contract and decimals used by the Capital proofbook |
| GitLab public API | Capital's 28-day canonical Octez `master`-branch commit activity |
| `data/capital-snapshot.json` | Same-origin generated Capital dataset with stable content hash and per-source URLs, endpoint receipts, status, timestamps, coverage, truncation, and unavailable-methodology records |
| Etherlink JSON-RPC `https://node.mainnet.etherlink.com` | Tezos X chamber RPC head and gas fallback |
| Etherlink governance `https://governance.etherlink.com/governance` | Official FAST, SLOW, and Sequencer action pages linked from the read-only chamber |
| Octez.Connect `@tezos-x/octez.connect-sdk` via `https://esm.sh` | Lazy browser wallet pairing and ctez/My Tezos account actions |

Live staking ratio and APY surfaces use TzKT `statistics/current` totals for
`totalOwnStaked + totalExternalStaked`, paired with TzKT `totalSupply`. Octez
RPC still supplies issuance, constants, cycle/head metadata, and fallback values
when TzKT stats are unavailable.

The core statistics payload also exposes TzKT's all-time transaction operation
count as `totalTransactions`, which feeds the pace-aware transaction milestone.

Visitor-side TzKT fetches are paced in the browser by `js/core/tzkt-throttle.js`
at six request starts per second. Request deadlines begin when a queued call
actually leaves the throttle, so time spent waiting for the shared budget does
not consume the upstream fetch timeout. This shim is installed by the dashboard,
SEO landing pages, standalone compare pages, and TzKT-backed widgets so embeds
do not bypass the visitor-side request budget. The core API helper also honors
TzKT `429` Retry-After responses and shares the current governance-period
snapshot across dashboard consumers.

Generated distribution surfaces now have one orchestration path:
`npm run refresh:generated` refreshes governance vote/report/feed artifacts,
pretty Chamber route pages, `sitemap.xml`, root and per-Chamber share images,
crawlable compare content, generated CSS bundles, the milestone catalog, and
the Maxis artifact family plus `data/capital-snapshot.json`. It also refreshes
the reproducible Chainspect and
Edinburgh EDI rows in `data/nakamoto-sources.json`; normal pre-commit runs only
validate that ledger, while scheduled/full runs preserve last-known-good data
if a third-party parser is temporarily unavailable. `npm run refresh:nakamoto`
forces that source refresh directly. `npm run refresh:maxis` forces both the canonical
lane-native-clock Maxis snapshot and the protocol-season manifest, active-season
summary, frozen rules, transaction checkpoint, and non-empty Passport shards.
`npm run refresh:maxis-careers` refreshes the separate exact all-history L1
Governance career artifact; `npm run check:maxis-careers` validates its source
receipts and content hash without a network scan.
`npm run refresh:maxis-l2-governance` rebuilds the independent L2 career and
all-time-active crown from official canonical period ledgers plus complete TzKT
big-map receipts; `npm run check:maxis-l2-governance` validates its coverage,
reconstructed standings, and stable content hash without a network scan.
Normal pre-commit runs
validate committed Maxis artifacts without rescanning chain activity, while
scheduled/full generated runs refresh the L2 career before the remaining Maxis
family and stage its artifact when requested. After a protocol change, the ending
season waits concurrently with the new active board through the declared
24-hour source-settlement guard and is rebuilt to the exact activation boundary
before becoming an immutable archive; its
published rules and champions must not drift during later refreshes. Passport
shards are addressed independently so a declared shard fetch failure produces
a local Passport error rather than blanking the canonical Maxis board, current
Season, or other addresses; a bucket declared empty is an honest no-activity state.
Snapshot time lives in the summary rather than every Passport file, so an
unchanged shard preserves its exact bytes and SHA-256 receipt across refreshes.
Each active season also carries a recomputable UTF-8 serialization budget
receipt. Auditable rules, summary, and state stay pretty-printed while high-volume
Passport shards use stable compact JSON with raw SHA-256 receipts. The
transaction state may not exceed 16 MiB, any Passport shard may not exceed 1
MiB, and rules + summary + state + shards may not exceed 64 MiB. If the
complete Transaction Passport tree would cross those limits, that lane is
withheld and the other exhaustive lanes publish from the already collected
source data rather than silently truncating wallets.

`npm run refresh:capital` manually rebuilds the Capital snapshot from its
documented public sources. `npm run check:capital` performs a network-free check
of the committed schema, byte envelope, source receipts, required explicit
unavailable methodologies, and stable content hash. Each source refresh is
independent: a failed source preserves that section's last-known-good values as
`stale`, or publishes an explicit `unavailable` section when no prior values
exist. Scheduled/full generated runs refresh and optionally stage the snapshot;
normal pre-commit runs validate the committed artifact without contacting every
provider. The browser consumes that artifact and never silently upgrades stale
or partial coverage into a current, comprehensive claim.
The evaluator used by a settling season must remain executable and unchanged
until close; a future scoring upgrade must live in a separately versioned
evaluator rather than reinterpreting an old season through new code. Finalized
archives validate and render against their own frozen lane catalog, not the
current evaluator's category constants.
The milestone generator is cadence-gated: scheduled runs refresh it after 14
days, while pre-commit runs refresh it after 100 commits, whichever happens
first. `npm run refresh:milestones` forces a manual refresh. The browser consumes
the generated thresholds plus unexpired crossing receipts and falls back to its
shared base catalog when the manifest is unavailable. The pre-commit hook runs
the same orchestrator in
commit mode so fast-moving generated outputs update with each normal commit.
`.github/workflows/refresh-governance-surfaces.yml` runs the full scheduled mode
and commits only when generated outputs change.

The Supabase anon key in `js/core/config.js` is public client configuration, not
a secret. Browser fetch domains must be allowed by the CSP in `index.html`.
Tracked schema changes live in `supabase/migrations/`; apply them in Supabase
before collector code that writes new columns is deployed. The GitHub Actions
collector should use a service-role or equivalent server-side secret for
`SUPABASE_KEY`; the browser anon key should remain read-only under RLS.
`.github/workflows/collect-data.yml` writes the 2-hour global `tezos_history`
row, while `.github/workflows/collect-chamber-history.yml` writes 30-minute
market, Network Health, Tezos X, and governance-period snapshots.
The History modal reads those domain tables directly for Chamber trend charts
plus expanded `tezos_history` fields such as total staked, APY, tz4 power,
protocol issuance, and Liquidity Baking EMA. It starts with a captured-signal
digest so the extra rows become plain-language status for tz4 power, staking,
Liquidity Baking, market, Network Health, Tezos X, and governance before the
full chart grid. Chamber entry cards and expanded economy cards use the `📊`
stats control to open their matching historical series where capture exists,
and the modal shows a compact capture-status strip for the latest global,
market, health, Tezos X, and governance rows.
`scripts/backfill-supabase-history.mjs` can repair old `tezos_history` rows
after schema expansion by using each row's timestamp to pull historical TzKT
statistics and archival Octez issuance/Liquidity Baking state. Run it through
the manual `Backfill Supabase History` GitHub Action so it can use the
service-role `SUPABASE_KEY`; it defaults to dry-run mode and intentionally
leaves older tz4 power fields blank because TzKT exposes baker power as current
delegate state rather than a reliable historical snapshot.
`npm run check:supabase:freshness` verifies that the latest global history row
is less than three hours old and each 30-minute domain table is less than
90 minutes old.

## Local Development

```bash
git clone https://github.com/Primate411/tezos.systems.git
cd tezos.systems
npm ci
npm run install-hooks
npm run serve
# Open http://localhost:9000
```

The lockfile is tracked so fresh clones can use `npm ci`. Repo Playwright
callers use `scripts/lib/playwright-browser.cjs`, which tries Playwright's
bundled Chromium first and falls back to a local Chrome/Chromium-family browser.
Set `BROWSER_EXECUTABLE_PATH` only when you need to force a specific executable.

The README guard reads staged files. If package/tooling, hook, handoff docs,
smoke-test, config, theme, app-shell, service-worker, SEO, widget, or
standalone-page contracts change without `README.md` staged, pre-commit fails
with the affected files and reasons. If you audit a change and README truly
does not need an update, commit with `SKIP_README_GUARD=1`.

Common commands:

```bash
npm run build:css
npm run refresh:generated
npm run refresh:capital
npm run check:capital
npm run refresh:milestones
npm run refresh:maxis
npm run check:maxis
npm run refresh:maxis-careers
npm run check:maxis-careers
npm run refresh:maxis-l2-governance
npm run check:maxis-l2-governance
npm run routes:chambers
npm run og:chambers
npm run bake:compare
npm run refresh:governance
npm run guard:readme
npm run check:readme
npm run check:supabase
npm run check:supabase:freshness
npm run backfill:supabase
npm test
npm run test:static
npm run test:smoke
npm run test:smoke:list
npm run test:smoke:headed
npm run test:smoke:strict
npm run test:smoke:live
node tests/smoke.mjs --only app-shell,route-crawl
node tests/smoke.mjs --base-url http://127.0.0.1:9000 --only governance-lb
```

`QA.md` has the pre-deploy checklist and manual visual pass.

## Testing

`npm test` runs:

- `npm run test:static`: JSON validity, generated governance freshness, local
  asset references, cache-stamp alignment, CSP domains, selector contracts,
  chamber card control spacing, chamber share-capture contracts, share composer
  and Network Moment capture contracts, launch-date wording, module import
  sanity, historical chart pagination and
  render-performance settings, LB-aware issuance contracts, CSS freshness,
  lockfile/tooling, and shared hook checks.
- `npm run test:smoke`: a Playwright browser run against a throwaway local
  server by default. It uses mocked live-data endpoints for deterministic
  feature flows.

Current smoke suites:

- `first-visit-tour`
- `app-shell`
- `tzkt-throttle`
- `dashboard-desktop`
- `dashboard-mobile`
- `my-tezos-baker-activity`
- `my-tezos-live-signal`
- `my-tezos-drawer-live-refresh`
- `my-tezos-wallet-connect`
- `octez-connect-sdk-loader`
- `my-tezos-baker-capacity`
- `my-tezos-staker-rewards`
- `my-tezos-delegator-rewards`
- `my-tezos-address-switch`
- `my-tezos-subdomain-input`
- `my-tezos-proposal-attribution`
- `my-tezos-deep-link-override`
- `tezlink`
- `network-health`
- `staking-chamber` (covers the narrow latest stake/unstake tape, strict >10K
  boundary, complete applied-operation scan, current ratio, flow summaries,
  mover trails, receipts, `/stake/`, and preservation of the `/staking/` guide)
- `ledger-flow`
- `maxis-domain-passport` (covers normalized `.tez` names, multi-label owner
  fallback, canonical resolved routes, unresolved names, KT1 rejection, and
  unchanged My Tezos state)
- `maxis` (covers the default all-lane Maxis overview, full-width launcher composition and chip containment across desktop/tablet/mobile geometry, room-aware protocol-season selector, Maxis/Season/Passport/Champions views, scoped load failures and finalization phases, career-plus-season address progression, Champion/rank receipts, and Ledger Flow handoff)
- `tezos-domains`
- `ctez`
- `governance-lb` (covers Chamber current-stage/historical vote ordering, paired Chambers card layout, fixed Chamber footer geometry, Tezos X Governance card geometry and rollover timing, Tezos X direction fallbacks, LB tile latest-vote tape, LB auto-scaled EMA trend, tz4 card preview/month bars/holdout wrapping, and mobile vote-row geometry)
- `ux-regressions`
- `quiet-refresh` (covers passive Hot Today, nested-scroll, focus, selection,
  in-flow status anchoring, and open-chamber refresh stability)
- `feature-workflows` (covers all sparkline card latest values, history, share, and optional feature flows)
- `share-actions` (covers share modal copy, editable X post text, optional handle persistence, download, native share, Network Moment image cards, and mobile photo fallback buttons)
- `info-modals`
- `themes`
- `widget-builder`
- `hen-mode`
- `route-formatting`
- `route-crawl`

Run `npm run test:smoke:list` for the current suite descriptions.

## Deployment, Hooks, And Versioning

Deploy by pushing `main`; GitHub Pages serves the committed files as-is.

Before deploying JS, CSS, or data-dependency changes, review cache and version
metadata:

- `index.html` serves `css/styles.min.css?v=...` and `js/core/app.js?v=...`.
- `sw.js` uses `CACHE_NAME = 'tezos-systems-v...'`.
- Current aligned shell cache stamp: `v451`, including hero search, theme
  bundles, and the Leaderboard, Ledger Flow, Network Pulse, and Staking Chamber lazy CSS loaders.
- Current Tezos Domains lazy CSS stamp: `v318`.
- `version.json` is stamped by `.githooks/pre-commit`.
- The pre-commit hook runs the README guard, refreshes commit-relevant generated
  surfaces, runs focused README contract checks, then stamps version metadata.

New clones must run `npm run install-hooks` once so `core.hooksPath` points at
`.githooks`. Using `git commit --no-verify` skips the refresh/stamp hook and can
deploy stale metadata.

Important version model:

- `version.json` is pre-commit stamped, so its `commit` value points at the
  parent/pre-commit `HEAD`.
- `build` predicts the commit count after the commit being created and is the
  useful deployed-version handle.
- The footer fetches `version.json` with `cache: 'no-store'` and also fetches
  the latest GitHub `main` commit at runtime.
- `sw.js` treats `/version.json` as network-first and same-origin shell assets
  as network-first with cache fallback.
- Cross-origin API responses bypass Cache Storage and failed requests surface
  as unavailable instead of replaying stale telemetry as current.

## Governance Data

Use `npm run refresh:governance` before touching governance or protocol data.
It updates:

- `data/governance-votes.json`
- `data/governance-refresh-report.json`
- `feed.xml`

The refresh report blocks when an accepted/current protocol is missing curated
lore in `data/protocol-data.json`. Accepted protocol entries should keep
technical facts sourced from official Octez/changelog material and present the
community debate fairly.

## Standalone Pages And Widgets

SEO and standalone pages:

- `staking/`
- `governance/`
- `bakers/`
- `hen/`
- `compare/`
- `compare/tezos-vs-ethereum.html`
- `compare/tezos-vs-solana.html`
- `compare/tezos-vs-cardano.html`
- `compare/tezos-vs-algorand.html`

These pages, the welcome page, HEN gateway, 404 page, and widget builder all
render contextual next steps plus a collapsed, on-demand copy of the complete
manifest-backed footer map. Contextual recommendations stay visible; the atlas
does not consume the page until a visitor requests it.
The staking, governance, and baker guides keep their shared navigation on one
desktop row and collapse it into a contained `Explore` disclosure on mobile.
Primary dashboard, Chamber, guide, HEN, comparison, welcome, and 404 templates
also expose a skip link, while static dashboard modal shells carry dialog names
and modal state before JavaScript initializes.
Comparison rails live outside `#compare-content` so static and browser-side
comparison regeneration cannot erase them.

Widgets:

- `widgets/runtime.js` is the shared embed runtime and catalog. Raw widget
  pages import it for theme defaults, endpoint URLs, TzKT pacing, fetch
  retry/cache behavior, refresh sanitization, formatting helpers, and tracked
  dashboard attribution links.
- `widgets/baker-count.html`
- `widgets/block-height.html`
- `widgets/staking-ratio.html`
- `widgets/price.html`
- `widgets/protocol.html`
- `widgets/governance.html`
- `widgets/combo.html`
- `widgets/baker-card.html`
- `widgets/builder.html`

The builder renders its widget type buttons, theme swatches, combo-stat
checkboxes, preview URLs, and embed snippets from `widgets/runtime.js`. The
combo widget supports baker count, XTZ price, block height, staking ratio,
current protocol, cycle, head freshness, and tz4 baking-power adoption, capped
to four stats per embed. Builder iframe and Markdown-link snippets add widget
UTM params. Raw widgets retain visible Tezos Systems attribution but do not load
third-party analytics in an embedding site; the first-party builder can still
measure its own copy actions. Builder copy success uses the site-owner language
and heartbeat affordance from the dashboard polish pass.

## SEO And Analytics

- `robots.txt` allows major AI crawlers and points at `sitemap.xml`.
- `sitemap.xml` is generated from the canonical sitemap metadata and nested
  intents in `js/core/site-map.js` by
  `scripts/refresh-generated-surfaces.mjs`. Chamber route generation remains a
  separate distribution concern, and static checks require its canonical
  routes to agree with the site map.
- `index.html` includes CSP, Open Graph/Twitter metadata, and JSON-LD.
- `.well-known/ai-plugin.json` describes the current live/historical data model
  using the canonical September 17, 2018 mainnet date and avoids stale
  two-minute refresh claims. It points to the site-owned read-only OpenAPI
  document; `.well-known/security.txt` publishes private reporting routes.
- GoatCounter is used for privacy-friendly analytics: `tezsys.goatcounter.com`.
  The shared initializer also exposes loop events for share actions,
  governance-alert actions, and widget-builder copy events. Embeddable raw
  widgets do not load GoatCounter in third-party pages.
- Shared PNG/tweet/native share flows rewrite Tezos Systems links with campaign
  params, keep X copy editable in the modal, and can persist an optional handle
  for card credit; the History modal has a direct `#history` copy control plus
  tracked share copy.

## Gotchas

- Service worker cache can hide changes during QA. Hard refresh or unregister
  the service worker if local behavior looks stale.
- A newly installed service worker waits until the visible Update action is
  accepted before taking control, preventing a mid-session HTML/module split.
  Offline navigations deliberately render `offline.html`; the shell/runtime
  cache is an asset accelerator, not an offline copy of live telemetry.
- `index.html` serves `css/styles.min.css`; editing only `css/styles.css` is
  not enough for deploy.
- Share captures are fragile around chart rendering, gradient text, canvas
  conversion, and word spacing. Test them visually after share or theme work.
- Theme support lives in multiple files, and newer themes may fall back in some
  components if their color maps are not updated.
- TzKT filters can be surprising; some whale and sleeping-giant amount filters
  are intentionally done client-side.
- TzKT requests are queued per browser tab or widget iframe at six starts per
  second. TzKT limits by visitor IP, so several open dashboard tabs or embed
  iframes can still add up; expect a small delay when several feature modules
  ask for live TzKT data at once.
- Tezos mainnet launch copy should use September 17, 2018. June 2018 refers to
  fundraiser genesis, not the mainnet launch date used by the app.
- Adding a new network source requires a CSP update in `index.html`.

## License

Except where a file or directory expressly states otherwise, the original
source code and repository-authored documentation in this repository are
available under the [Mozilla Public License 2.0](LICENSE). The package license
identifier is `MPL-2.0`; the project attribution and scope notice live in
[NOTICE](NOTICE).

MPL-2.0 is file-level copyleft. You may use, modify, and distribute the covered
work, including as part of a larger work. When you distribute covered source or
executable forms, modified covered files must remain available under MPL-2.0,
the corresponding covered source must be available, and the license and
attribution notices must remain intact. Separate new files in a larger work may
use other terms.

Third-party software, fonts, API-sourced data, images, trademarks, service
marks, and logos remain under their respective terms. MPL-2.0 does not grant a
right to use contributor branding except as needed to identify and attribute
the project.

The Tezos Network Statistics dataset advertised in the site's structured data
is separately offered under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
only for original selection, arrangement, and commentary to the extent
Primate owns those rights. Underlying facts and third-party API data remain
subject to their source terms.

Tezos Systems is built by Primate, a co-founding member of
[Tez Capital](https://tez.capital). The Tez Capital brand is represented
through that affiliation, and Tez Capital provides RPC infrastructure used by
the site. The copyright notice in [NOTICE](NOTICE) identifies the repository's
current copyright holder.

Some earlier revisions carried MIT or ISC declarations. This section governs
the current distribution and does not purport to rewrite the terms under which
historical copies were received.

## Credits

- Data: [TzKT](https://tzkt.io), CoinGecko, Tezos Domains, OBJKT, and Supabase.
- Built by: [Primate](https://x.com/BakingBenjamins), a co-founding member
  of [Tez Capital](https://tez.capital).
- RPC infrastructure: [Tez Capital](https://tez.capital).

Built for the Tezos ecosystem.
