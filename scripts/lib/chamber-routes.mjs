export const CHAMBER_ROUTES = [
  {
    slug: 'my',
    hash: '#my-tezos',
    title: 'My Tezos - Personal Wallet and Baker Dashboard',
    shortTitle: 'My Tezos',
    description: 'Make a wallet or .tez name the center of a personal Tezos dashboard for rewards, roles, baker health, activity, and account journeys.',
    eyebrow: 'Personal Tezos',
    accent: '#45e0c8'
  },
  {
    slug: 'anthology',
    imageSlug: 'chamber',
    hash: '#protocol-history',
    title: 'Protocol Anthology - Tezos Self-Amendment Story',
    shortTitle: 'Protocol Anthology',
    description: 'Read the Tezos self-amendment archive: protocol lore, upgrade debates, impact views, and the tracked history of one adopted protocol path.',
    eyebrow: 'Protocol Archive',
    accent: '#45e0c8'
  },
  {
    slug: 'chamber',
    hash: '#chamber',
    title: 'Tezos L1 Governance - Tezos Governance Vote Room',
    shortTitle: 'Tezos L1 Governance',
    description: 'Track live Tezos L1 governance votes, quorum, supermajority, baker ballots, and proposal context.',
    eyebrow: 'L1 Governance',
    accent: '#00d4ff'
  },
  {
    slug: 'pulse',
    hash: '#pulse',
    title: 'Network Pulse Chamber - Tezos Live Stats Field',
    shortTitle: 'Network Pulse',
    description: 'Scan Tezos consensus, economy, governance, activity, ecosystem, and adjacent chamber signals in one live card field.',
    eyebrow: 'Live Stats',
    accent: '#38bdf8'
  },
  {
    slug: 'capital',
    hash: '#capital',
    title: 'Capital Chamber - Tezos and Etherlink Economy',
    shortTitle: 'Capital Chamber',
    description: 'Inspect cross-layer Tezos and Etherlink activity, markets, ecosystem assets, real-world assets, and art-economy intelligence with sourced receipts.',
    eyebrow: 'Cross-Layer Economy',
    accent: '#f49ad1'
  },
  {
    slug: 'stake',
    hash: '#staking',
    title: 'Staking Chamber - Large Tezos Stake and Unstake Moves',
    shortTitle: 'Staking Chamber',
    description: 'Track large Tezos stake and unstake operations, the current staking share, and the complete history above 10,000 tez.',
    eyebrow: 'Stake / Unstake',
    accent: '#a78bfa'
  },
  {
    slug: 'maxis',
    hash: '#maxis',
    title: 'Tezos Maxis - On-Chain Crowns, Seasons, and Passports',
    shortTitle: 'Tezos Maxis',
    description: 'Spot Tezos activity leaders on their honest natural clocks, race through protocol seasons, inspect a wallet Maxi Passport, and trace every crown in Ledger Flow.',
    eyebrow: 'On-Chain Crowns',
    accent: '#f5c451'
  },
  {
    slug: 'health',
    hash: '#health',
    title: 'Network Health Chamber - Tezos Consensus Status',
    shortTitle: 'Network Health',
    description: 'Watch Tezos consensus power, recent blocks, missed rights, network load, and operator health signals.',
    eyebrow: 'Consensus',
    accent: '#47d18c'
  },
  {
    slug: 'tezosx',
    hash: '#tezosx',
    title: 'Tezos X Chamber - Etherlink Activity Monitor',
    shortTitle: 'Tezos X',
    description: 'Follow Etherlink activity, L1 anchors, gas signals, TVL direction, and L2 token concentration.',
    eyebrow: 'Etherlink L2',
    accent: '#a855f7'
  },
  {
    slug: 'tezlink',
    canonicalSlug: 'tezosx',
    imageSlug: 'tezosx',
    hash: '#tezosx',
    title: 'Tezos X Chamber - Etherlink Activity Monitor',
    shortTitle: 'Tezos X',
    description: 'Follow Etherlink activity, L1 anchors, gas signals, TVL direction, and L2 token concentration.',
    eyebrow: 'Etherlink L2',
    accent: '#a855f7',
    robots: 'noindex, follow'
  },
  {
    slug: 'l2chamber',
    hash: '#l2chamber',
    title: 'Tezos X Governance - Etherlink L2 Governance Monitor',
    shortTitle: 'Tezos X Governance',
    description: 'Track Etherlink L2 governance contracts, track rules, proposal timelines, and quiet-state discovery.',
    eyebrow: 'L2 Governance',
    accent: '#ff9f43'
  },
  {
    slug: 'tz4',
    hash: '#tz4',
    title: 'tz4 Adoption Chamber - Tezos BLS Consensus Keys',
    shortTitle: 'tz4 Adoption',
    description: 'Monitor Tezos bakers moving to tz4/BLS consensus keys, pending queues, power milestones, and switch momentum.',
    eyebrow: 'Consensus Keys',
    accent: '#45e0c8'
  },
  {
    slug: 'lb',
    hash: '#lb',
    title: 'Liquidity Baking Chamber - Tezos LB EMA Monitor',
    shortTitle: 'Liquidity Baking',
    description: 'Watch the Tezos Liquidity Baking OFF-vote EMA, subsidy state, baker vote flow, and threshold risk.',
    eyebrow: 'Liquidity Baking',
    accent: '#f5b84b'
  },
  {
    slug: 'ledger-flow',
    hash: '#ledger-flow',
    title: 'Ledger Flow - Tezos Account Transfer Diagram',
    shortTitle: 'Ledger Flow',
    description: 'Map Tezos account transfer paths with sent, received, first-funding, and amount-weighted connections.',
    eyebrow: 'Account Flows',
    accent: '#4dd4ff'
  },
  {
    slug: 'domains',
    hash: '#domains',
    title: 'Tezos Domains Chamber - Live .tez Name Market',
    shortTitle: 'Tezos Domains',
    description: 'Track fresh .tez registrations, renewals, expiring names, auctions, offers, and reverse-record identity moves.',
    eyebrow: '.tez Identity',
    accent: '#38e8d3'
  },
  {
    slug: 'ctez',
    hash: '#ctez',
    title: 'ctez Oven Guide - Withdraw Tez From ctez Ovens',
    shortTitle: 'ctez Oven Guide',
    description: 'Find a ctez oven, burn outstanding ctez, and withdraw tez safely through Better Call Dev.',
    eyebrow: 'ctez Exit Guide',
    accent: '#38bdf8'
  }
];

export function routeUrl(route) {
  return `https://tezos.systems/${route.canonicalSlug || route.slug}/`;
}

export function routeImage(route) {
  return `https://tezos.systems/og/${route.imageSlug || route.canonicalSlug || route.slug}.png`;
}
