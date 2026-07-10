# Implementation Plan — Tezos Maxis Chamber (`/maxis/`)

## Outcome

Turn Tezos Maxis from a static wall of winners into a protocol-season game that
rewards movement, breadth, and repeat participation without weakening the hard
on-chain truth of its crowns.

Every Tezos protocol activation starts a new Maxis season. The active season
begins at that protocol's exact activation boundary and ends at the next exact
activation boundary. When the next activation has not been scheduled, the UI
must say that the season ends when the next protocol activates; it must not
invent a date or countdown. Past seasons become permanent champion archives.

The chamber remains inspectable rather than reputation-driven: no manually
picked personalities, no opaque score, no identity merging, and no chain-wide
winner when a source only exposes a sample. Every standing must say what was
measured, under which frozen rules, over which protocol window, and with what
source completeness.

## Product contract

### Four rooms, four jobs

| Room | Purpose | Truth contract |
| --- | --- | --- |
| **Season** | The active protocol's lane races, rank movement, cutoff pressure, and Honors | Only activation-bounded activity measured under this season's frozen rules |
| **Passport** | One address's badges, lanes, near misses, supported streaks, personal bests, and path to Unicorn | Stable address identity; badges use frozen thresholds while rank cutoffs remain visibly live |
| **Crown Hall** | Hard objective leaders whose natural clocks are live, rolling, or all-time | Reads the legacy mixed-clock snapshot and never relabels it as season performance |
| **Champions** | Finalized winners and Honors from completed protocol seasons | Archives are immutable after a season transition |

Season is the default room. The homepage launcher is a compact season doorway,
not a mini copy of every leaderboard. Passport, Crown Hall, and Champions stay
one interaction away through the chamber room tabs and shareable URL state.

### Protocol-season boundary

- Resolve the current protocol and its exact activation level/time from the
  generated governance/protocol truth surfaces. Use protocol lore dates only as
  a documented fallback when the exact activation receipt is unavailable.
- Keep the protocol number separate from the Maxis season ordinal. A protocol
  being the 25th upgrade does not imply that 24 historical Maxis seasons exist.
- A current season with no known successor has `end: null` and honest
  open-ended copy. Add a countdown only after a successor activation is known.
- Freeze the scoring, tie-break, badge, lane, and taxonomy versions at season
  creation. Later refreshes update standings, not the ruleset.
- At the next activation, open/reset the new active season immediately while
  the ending season moves concurrently into a non-champion `settling` state for
  at least 24 hours so lagging OBJKT/TzKT indexes can converge. Then rebuild the
  old season once through the exact exclusive activation boundary under its
  frozen evaluator, hash its summary and Passport shards, and never rewrite its
  champions on later runs. The new live board must not disappear while the old
  archive settles.
- Keep the ending evaluator executable and unchanged until settlement closes.
  A future scoring upgrade needs a versioned evaluator module so the old and new
  seasons can be evaluated concurrently; it may not reinterpret the old rules
  through newer code.
- Do not backfill a historic protocol season unless its activation-bounded data
  can be reproduced exhaustively under a declared ruleset. An empty Champions
  room is more truthful than invented history.

### Season lanes

The rules artifact declares every lane, its score vector, tie-breakers, source,
and availability. A lane may be present but unavailable when exhaustive source
coverage cannot be proven.

| Lane | Season question | Candidate score contract |
| --- | --- | --- |
| Transaction Maxi | Who generated the most qualifying user activity during this protocol? | Successful top-level implicit-sender calls in the activation window, aggregated through a strict-ID resumable checkpoint and published only after its fixed block boundary reconciles to TzKT's raw count |
| Collector Maxi | Who collected most broadly? | Qualified purchases, artists collected, and volume, with the exact tuple declared |
| Art Maxi | Which artist reached collectors most effectively? | Qualified sales, unique collectors, and collector spread |
| Mint Maxi | Who shipped successful new work? | Season-created tokens with a positive-price primary creator sale to an independent collector, then distinct mints, collectors, and editions sold |
| DeFi Maxi | Who used Tezos finance most broadly? | Distinct reviewed apps first, then successful top-level calls and recognized contracts |
| Gaming Maxi | Who played across the reviewed game set? | Distinct reviewed games first, then successful calls |
| Governance Maxi | Who kept showing up? | Qualifying ballots and proposals inside the protocol window, plus evidence-backed participation continuity |
| Staking Growth Maxi | Who increased stake most during the season? | Applied stake minus unstake operations in the protocol window; not the absolute live-stake crown |
| Delegation Maxi | Which baker retained new in-season assignments? | Latest in-season baker changes that remain assigned with positive liquid balance at the snapshot or exact close; not marketing attribution |
| Liquidity Maxi | Who touched liquidity most broadly? | Recognized contracts and apps reached through reviewed positive-supply entrypoints, then successful calls; amount and duration are not inferred |
| Bridge Maxi | Who moved between Tezos L1 and Etherlink? | Canonical, direction-aware bridge events only; unavailable when identity or round trips cannot be measured cleanly |
| Builder Maxi | Who deployed things people actually used? | Contract deployments plus independently verified post-deploy activity |
| Unicorn | Who crossed the most lanes this season? | Breadth across available lanes from this one season and one ruleset only |

Social Proof remains an off-chain Passport badge or clearly separate share
counter. It never contributes to an on-chain crown or Unicorn score.

### Ranking, movement, and gap rules

- Count successful qualifying activity only. Exclude burn/null/system accounts,
  failed or backtracked operations, and contracts represented as people unless
  the lane explicitly ranks contracts.
- Publish deterministic score vectors and tie-breakers: primary components,
  secondary components, most recent qualifying activity, then lexicographic
  raw code-point address order.
- Calculate rank delta only against the previous complete snapshot from the
  same season and rules version. A first appearance is `new`/debut, not a climb
  from an invented prior rank.
- Show the leader, nearest challenger, current top-ten cutoff, and the user's
  distance to that cutoff. If passing a rank depends on multiple tuple fields,
  publish the frozen vector path as conservative, not as a live minimum. Show
  “need +N to guarantee” only when strictly exceeding that primary component is
  genuinely sufficient regardless of the remaining tie-breakers.
- Keep objective crown standings separate from trajectory Honors. Honors may
  include highest same-season climb, first-time top ten, consistency, most
  diversified wallet, new collector, new artist, and—after at least two real
  seasons—Comeback.
- A participation streak is evidence, not decoration. Count only observed
  qualifying days/cycles/snapshots and do not infer continuity across missing
  source periods.

### Identity, badges, and Passport

- The Tezos address is the stable identity. A Tezos Domains name or TzKT alias
  is display metadata; aliases never merge two addresses or replace the raw
  address in receipts.
- Accept explicit Passport addresses and the saved My Tezos address. An
  explicit `?address=` view must not overwrite the saved My Tezos identity.
- Treat implicit accounts and `KT1` contracts honestly. If a contract Passport
  is unsupported, explain that limitation instead of attributing its activity
  to a manager wallet.
- Define badge thresholds in the season's frozen `rules.json`. Badge progress
  such as “72% to Collector Maxi” must remain stable when rank #10 changes.
- Active rank one is provisional standings state, not a permanent crown badge.
  Mint a season-specific champion badge only from the settled final rebuild.
- Display the live top-ten cutoff separately as a near miss: “+37 mints to
  guarantee #10,” “+420 ꜩ to guarantee #10,” or a clearly labeled conservative
  frozen-vector path when a scalar minimum cannot be proven.
- Passport shows active lanes, qualifying badges, supported streaks, personal
  bests, current ranks, near misses, and same-season Unicorn breadth. Missing or
  unavailable lanes contribute neither progress nor penalties.
- My Tezos exposes a direct Passport link for the active saved address and hides
  or returns it to an empty search state when no address is saved.

## Data architecture

### 1. Generated artifact family

Exhaustive aggregation belongs in `scripts/refresh-maxis-data.mjs`, not in every
visitor's browser. The browser reads this generated hierarchy:

```text
data/
├── maxis-leaders.json
│   # Legacy mixed-clock objective leaders used only by Crown Hall
└── maxis/
    ├── manifest.json
    │   # Schema/rules versions, active season, season index, shard algorithm
    └── seasons/<season-id>/
        ├── summary.json
        │   # Boundary, telemetry, lane standings, deltas, gaps, Honors, receipts
        ├── rules.json
        │   # Frozen lane scores, tie-breakers, badge thresholds, taxonomy version
        ├── transaction-state.json
        │   # Last complete generator-only aggregate, fixed boundary/cursor, replacement tail, and integrity receipt
        ├── transaction-state.building.json
        │   # Optional signed resume sidecar; never referenced as publishable data
        └── passports/
            └── 00.json .. 3f.json
                # Deterministic address buckets; only non-empty shards need emission
```

`manifest.json` is the small entry point. Season and Crown Hall views do not
fetch Passport shards or the transaction checkpoint. Passport deterministically maps an address into one of
64 hexadecimal buckets and fetches only that shard. A missing selected shard is
an honest no-activity result when the manifest declares that bucket empty. A
fetch, parse, or integrity failure for a declared non-empty shard is a local
Passport error with retry; it must not blank the season summary, another shard,
Crown Hall, or Champions.

The active summary may change as a season advances. `rules.json` must not.
Finalized season summaries and rules are immutable archive inputs for
Champions. Regeneration must compare existing archive content and fail rather
than silently rewriting it.

Transaction aggregation is season-owned and resumable because a full protocol
window can exceed a safe per-run in-memory row set. It scans a fixed
`level.ge`/`level.lt` boundary in strict ascending ID order, filters applied
top-level implicit-sender activity client-side, reconciles a replacement tail,
and proves the completed raw-row total against the same fixed TzKT count. A
building, corrupt, over-budget, or count-mismatched state cannot publish a
winner. Partial scheduled runs may commit only the signed building sidecar while
leaving the last published manifest, summary, and shard hashes untouched; the
sidecar is atomically promoted only after reconciliation. Exact close performs a
fresh full-boundary replay after settlement.

The complete UTF-8 season envelope is measured before any published files
advance. Rules, summary, and state remain pretty-printed for auditability;
Passport shards use stable compact JSON and raw SHA-256 receipts so indentation
does not consume the season budget. Transaction state is capped at 16 MiB, each
Passport shard at 1 MiB, and rules + summary + state + all shards at 64 MiB. If Transaction-only
Passports would exceed that envelope, the retained source result is rebuilt with
Transaction explicitly unavailable; other complete lanes remain publishable and
no eligible Transaction wallet is silently dropped.

### 2. Snapshot and progression records

Each complete refresh retains enough same-season prior state to derive:

- rank and score movement under the same rules version;
- first-time entries and first-time top-ten Honors;
- leader/challenger and top-ten cutoff gaps;
- stable badge progression against frozen thresholds;
- personal bests and evidence-backed streaks;
- same-season lane breadth for Unicorn.

Do not compare scores across changed rules. If the data needed for a trend was
not retained, mark the trend unavailable rather than reconstructing it from a
current aggregate.

### 3. Completeness receipts and unavailable states

Every source collector and derived lane publishes an inspectable receipt with
its source, query/window semantics, pagination or cursor totals, observed
record/watermark bounds, taxonomy/rules version, and one of `complete`,
`partial`, `unavailable`, or `error` plus a reason. A crown, Honor, rank delta,
badge, cutoff, or Unicorn credit may be published only from complete qualifying
coverage.

Pagination must follow the source's accepted page limit rather than a larger
local constant. In particular, an OBJKT endpoint that caps a response at 500
must be requested and advanced in 500-row pages; a 500-row response to a
1,000-row request is not proof that pagination is finished. Deterministic tests
cover multiple full pages followed by a short final page.

If an authoritative source cannot support exhaustive activation-window
coverage at reasonable cost, narrow and relabel the method or publish the lane
as unavailable. Never turn the first page, a top-account sample, or a
recognizable contract subset into an unqualified “most on Tezos” claim.

### 4. Curated app taxonomy

`data/maxis-contracts.json` keeps reviewed DeFi/Gaming app alias patterns and
positive-liquidity entrypoint classifications outside the scorer. At season
creation the generator resolves those patterns against TzKT, then freezes the
exact address-to-app map, observed alias, provenance, role, and entrypoint
constraints into `rules.json`.

The generator rejects invalid resolved addresses, missing provenance,
accidental duplicates, and undeclared category collisions. A contract with
multiple legitimate roles declares each role explicitly, while operation and
Unicorn aggregation deduplicate the same event according to the frozen season
rules. Unknown or unlabeled contracts remain unknown.

### 5. Freshness and fallback

- Render the last valid manifest and summary immediately when available.
- Show generated time, exact protocol start, known end or open-ended activation
  language, and per-source receipt status.
- Mark stale artifacts after the declared threshold while keeping their last
  valid results visible.
- Keep prior in-place room, season, lane, Passport address, focus, and scroll
  state during a background refresh.
- Present missing manifest, missing summary, missing shard, unavailable lane,
  first-season archive, and total-error states separately.

## Chamber implementation

### Circular season selector

Use a Maxis-scoped version of the compact circular tray interaction already in
the app shell; do not reuse global IDs. The toggle is at least 44×44 px, names
the selected protocol season, exposes expanded/controls state, and opens:

- a right-opening season menu on desktop;
- a contained popover anchored below the circular toggle on mobile;
- `menu`/`menuitemradio` semantics with the active item checked;
- Arrow Up/Down, Home/End, Enter/Space, outside-click/tap, and focus return;
- layered Escape behavior: first Escape closes the selector, the next closes
  the chamber.

The selector lists only real generated seasons. It must not manufacture earlier
season ordinals from the protocol count.

### Season-first progressive disclosure

The Season room shows:

1. protocol-season identity, start/end truth, freshness, current leader, and
   nearest challenger;
2. a compact horizontal lane rail;
3. one selected lane with a top-three podium and compact ranks four through ten;
4. exact score method, rank deltas, guaranteed cutoff target, conservative
   frozen-vector path, completeness receipt, and an
   expandable action/receipt menu per row;
5. trajectory Honors below the objective standings.

Avoid rendering every top ten at once. Preserve Ledger Flow, My Tezos, primary
source, and share-receipt actions behind progressive row disclosure. Respect
reduced-motion preferences for the selector orbit, podium arrival, rank
movement, and badge progress.

### Routing and handoffs

Canonical in-room state is shareable without requiring a hash:

- `/maxis/?view=season&season=<id>&lane=<lane>`;
- `/maxis/?view=passport&address=<tz-or-KT1>`;
- `/maxis/?view=crown&lane=<lane>`;
- `/maxis/?view=champions&season=<id>`.

Unknown query values fall back safely without discarding valid room state. The
homepage card opens the current Season. My Tezos opens the saved address's
Passport. Ranked addresses retain exact Ledger Flow, My Tezos, and primary
source handoffs.

## Testing

### Deterministic data tests

Fixtures cover:

- exact protocol activation boundaries and honest unknown-next-activation end;
- frozen rules and archive immutability across refresh/season transition;
- success/failure filtering, deduplication, and taxonomy collisions;
- primary/secondary/recency/raw-address tie-break ordering, guaranteed primary
  targets, and conservative tuple-path certainty labels;
- rank delta only within the same season/rules and `new` entry semantics;
- stable badge thresholds versus a moving top-ten cutoff;
- repeatable achievements use season-scoped IDs so the same top-ten, streak, or
  Unicorn badge can be earned and preserved in more than one protocol season;
- evidence-backed streaks and first-season Comeback suppression;
- same-season Unicorn breadth with unavailable lanes excluded;
- 64-bucket address sharding, unique Passport membership, and independent shard
  failure;
- source pagination with two full 500-row pages and one short final page;
- resumable Transaction aggregation matches a one-pass result, rejects
  duplicate/non-increasing cursors, and stays inside the frozen boundary;
- unchanged Passport content preserves shard bytes and hashes across snapshots;
- non-adjacent protocol jumps fail closed, and frozen archives validate from
  their own lane catalog rather than the current evaluator's categories;
- partial, unavailable, stale, and category-empty behavior.

CI uses local fixtures and schema checks rather than requiring live network
results.

### Route and interaction coverage

Static and smoke coverage proves:

- `/maxis/` carries canonical/OG metadata and hydrates the Season room with an
  empty hash;
- all four rooms and room/season/lane/address URLs survive refresh and back;
- the selector's keyboard, touch, focus, and two-layer Escape contract;
- only one Season lane is expanded, with podium, ranks four to ten, gaps,
  deltas, Honors, receipts, and row actions intact;
- explicit Passport addresses do not mutate the saved My Tezos address;
- saved, explicit, raw implicit, `KT1`, and no-address Passport states;
- Crown Hall reads the mixed-clock legacy artifact only;
- Champions renders immutable archives and the single-season empty state;
- fresh, stale, unavailable lane, missing summary, missing shard, and total
  error states remain honest and isolated;
- Ledger Flow receives the selected address and external sources do not close
  the chamber unexpectedly;
- scroll lock, focus return, retry, 44 px touch targets, and no mobile
  horizontal escape.

### Browser QA

Follow the exhaustive Maxis matrix in `QA.md`: all 14 themes across desktop
`1440x1000` and `1280x900`, mobile `390x844`, `375x812`, and `360x720`, and all
four rooms. The matrix also covers selector focus/Escape behavior, every
Passport identity mode, fresh/stale/missing-shard/single-season fixtures, and
service-worker freshness.

## Implementation order

1. Preserve unrelated worktree edits and record the existing mixed-clock Crown
   Hall behavior.
2. Validate source page limits and activation-window feasibility lane by lane.
3. Add frozen season rules, deterministic rank/gap/badge helpers, receipts, and
   address sharding.
4. Generate and validate the manifest, current summary/rules, Passport shards,
   and legacy Crown Hall snapshot.
5. Build the four-room chamber, circular selector, one-lane Season board, and
   Passport progression surface.
6. Wire shareable route state, My Tezos Passport handoff, search/site map,
   generated routes, cache stamps, README, QA, and changelog.
7. Add deterministic/static/smoke coverage, then run the full suite.
8. Complete the exhaustive theme/viewport/room browser matrix and fix visible
   regressions.
9. Audit every acceptance condition before finalizing the season artifact.

## Acceptance gate

The protocol-season chamber is complete only when every visible crown, Honor,
delta, gap, badge, cutoff, and Unicorn contribution is reproducible from its
published frozen rules and complete source receipts; current-season end copy is
honest; Passport identity never mutates or merges unexpectedly; Crown Hall
remains mixed-clock; archives are immutable; failures stay isolated; all tests
pass; and the full `QA.md` matrix survives without clipped or inaccessible UI.

## Implementation status — 2026-07-09

The original nine-board snapshot remains available as **Crown Hall**, preserving
its hard objective winners and mixed all-time/live/rolling clocks without
pretending they form one season. The protocol-season expansion adds the Season,
Passport, and Champions rooms around it.

The active season is activation-bounded and rules-frozen. Season rendering uses
one-lane progressive disclosure with leader/challenger context, podium plus
ranks four through ten, guaranteed primary targets, conservative vector paths,
same-season movement, live cutoff pressure,
and separate trajectory Honors. Unicorn is recalculated from available lanes in
the same protocol window only. Stable Passport badges remain distinct from the
moving cutoff, and the My Tezos drawer hands its saved address directly into the
Passport without changing identity.

Generated data is split into a small manifest, per-season summary and frozen
rules, and deterministic `00`–`3f` Passport buckets. Finalized seasons become
immutable Champions archives. Per-source completeness receipts gate all
competitive output, while incomplete or infeasible lanes stay explicitly
unavailable. OBJKT mint pagination advances at the source-supported page size
so a capped first response can no longer be mistaken for complete coverage.
