const home = {
    id: 'home',
    title: 'Dashboard',
    href: '/',
    paths: ['/landing.html'],
    group: 'Home',
    detail: 'Live Tezos dashboard, command search, Chambers, widgets, and My Tezos',
    keywords: ['tezos systems', 'dashboard', 'home', 'live stats', 'chambers'],
    sitemap: { changefreq: 'hourly', priority: '1.0' }
};

export const SITE_MAP = [
    home,
    {
        id: 'chambers',
        title: 'Tezos Chambers',
        href: '/#chambers',
        hash: '#chambers',
        group: 'Tools',
        detail: 'Browse every focused Tezos room from one live dashboard suite',
        keywords: ['chambers', 'all chambers', 'rooms', 'feature rooms']
    },
    {
        id: 'my-tezos',
        title: 'My Tezos',
        href: '/#my-tezos',
        hash: '#my-tezos',
        hashAliases: ['#my-baker'],
        group: 'Tools',
        detail: 'Make a wallet or .tez name the center of a personal Tezos dashboard',
        keywords: ['wallet', 'account', 'portfolio', 'rewards', 'rewards tracker', 'baker', 'baker report card', 'operator health', 'personal brief', 'wallet connect', 'identity', 'my baker'],
        starter: 1,
        searchChip: { label: 'Wallet or .tez', order: 1 }
    },
    {
        id: 'anthology',
        title: 'Protocol Anthology',
        href: '/anthology/',
        hash: '#protocol-history',
        hashAliases: ['#protocol'],
        group: 'Story Rooms',
        detail: 'Self-amendment lore, upgrade arc, debates, and the documented amendment record',
        keywords: ['protocol history', 'upgrades', 'self amendment', 'archive', 'lore', 'history'],
        sitemap: { changefreq: 'daily', priority: '0.9' }
    },
    {
        id: 'chamber',
        title: 'Tezos L1 Governance',
        href: '/chamber/',
        hash: '#chamber',
        hashAliases: ['#the-chamber'],
        group: 'Story Rooms',
        detail: 'Current vote room, quorum, baker ballots, and governance context',
        keywords: ['governance', 'vote', 'proposal', 'chamber', 'ballot', 'quorum'],
        sitemap: { changefreq: 'hourly', priority: '0.9' }
    },
    {
        id: 'pulse',
        title: 'Network Pulse',
        href: '/pulse/',
        hash: '#pulse',
        hashAliases: ['#network-pulse'],
        group: 'Live Rooms',
        detail: 'Consensus, economy, market, governance, activity, and ecosystem cards in one live chamber',
        keywords: ['network pulse', 'live stats', 'daily briefing', 'cycle pulse', 'consensus', 'economy', 'activity', 'market', 'what is hot today', "what's hot today", 'hot today', 'network moments'],
        starter: 2,
        searchChip: { label: '/pulse', order: 2 },
        sitemap: { changefreq: 'hourly', priority: '0.9' }
    },
    {
        id: 'staking-chamber',
        title: 'Staking Chamber',
        href: '/stake/',
        hash: '#staking',
        hashAliases: ['#stake'],
        group: 'Live Rooms',
        detail: 'Large stake and unstake moves, current staking share, and the complete >10K history',
        keywords: ['staking chamber', 'stake', 'unstake', 'stakers', 'staking ratio', 'large stake', 'staking moves', '/stake'],
        starter: 3,
        searchChip: { label: '/stake', order: 3 },
        fresh: true,
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'maxis',
        title: 'Tezos Maxis',
        href: '/maxis/',
        hash: '#maxis',
        hashAliases: ['#tezos-maxis'],
        group: 'Live Rooms',
        detail: 'Canonical Tezos crowns, protocol-season races, career Passports, and permanent Champions',
        keywords: ['maxis', 'maxi', 'on-chain crowns', 'all time', 'live', 'protocol season', 'maxi passport', 'passport', 'champions', 'leaderboard', 'art', 'collector', 'mint', 'defi', 'gaming', 'governance', 'staking', 'unicorn'],
        searchIntents: [
            { id: 'maxis-season', title: 'Tezos Maxis Season', href: '/maxis/?view=season', detail: 'Open the current protocol-season races, moving ranks, cut lines, and honors', keywords: ['maxis season', 'tezos maxis season', 'protocol season'], directory: true },
            { id: 'maxis-passport', title: 'Maxi Passport', href: '/maxis/?view=passport', detail: 'Open address-bound career stamps and current protocol-season progress', keywords: ['maxi passport', 'maxis passport', 'passport'], directory: true },
            { id: 'maxis-champions', title: 'Tezos Maxis Champions', href: '/maxis/?view=champions', detail: 'Open permanent finalized protocol-season winners and frozen receipts', keywords: ['maxis champions', 'maxi champions', 'champions'], directory: true },
            { id: 'maxis-unicorn', title: 'Unicorn Maxi', href: '/maxis/?lane=unicorn', seasonHref: '/maxis/?view=season&lane=unicorn', seasonTitle: 'Unicorn Maxi Season', seasonDetail: 'Open the protocol-season cross-lane Unicorn race', detail: 'Open the cross-lane Unicorn crown board', keywords: ['unicorn maxi', 'unicorn crown', 'unicorn season'] },
            { id: 'maxis-staking', title: 'Staking Maxi', href: '/maxis/?lane=staking', seasonHref: '/maxis/?view=season&lane=staking', seasonTitle: 'Staking Maxi Season', seasonDetail: 'Open the protocol-season Staking Maxi race', detail: 'Open the live Staking Maxi crown board', keywords: ['staking maxi', 'staking crown', 'staking season'] },
            { id: 'maxis-governance', title: 'Governance Maxi', href: '/maxis/?lane=governance', seasonHref: '/maxis/?view=season&lane=governance', seasonTitle: 'Governance Maxi Season', seasonDetail: 'Open the protocol-season Governance Maxi race', detail: 'Open the all-time-active Governance Maxi board', keywords: ['governance maxi', 'governance crown', 'governance season'] },
            { id: 'maxis-collector', title: 'Collector Maxi', href: '/maxis/?lane=collector', seasonHref: '/maxis/?view=season&lane=collector', seasonTitle: 'Collector Maxi Season', seasonDetail: 'Open the protocol-season Collector Maxi race', detail: 'Open the Collector Maxi crown board', keywords: ['collector maxi', 'collector crown', 'collector season'] },
            { id: 'maxis-artist', title: 'Art Maxi', href: '/maxis/?lane=artist', seasonHref: '/maxis/?view=season&lane=artist', seasonTitle: 'Art Maxi Season', seasonDetail: 'Open the protocol-season Art Maxi race', detail: 'Open the Art Maxi crown board', keywords: ['art maxi', 'artist maxi', 'art crown', 'art season'] },
            { id: 'maxis-minter', title: 'Mint Maxi', href: '/maxis/?lane=minter', seasonHref: '/maxis/?view=season&lane=minter', seasonTitle: 'Mint Maxi Season', seasonDetail: 'Open the protocol-season Mint Maxi race', detail: 'Open the Mint Maxi crown board', keywords: ['mint maxi', 'minter maxi', 'mint crown', 'mint season'] },
            { id: 'maxis-defi', title: 'DeFi Maxi', href: '/maxis/?lane=defi', seasonHref: '/maxis/?view=season&lane=defi', seasonTitle: 'DeFi Maxi Season', seasonDetail: 'Open the protocol-season DeFi Maxi race', detail: 'Open the DeFi Maxi crown board', keywords: ['defi maxi', 'defi crown', 'defi season'] },
            { id: 'maxis-transaction', title: 'Transaction Maxi', href: '/maxis/?lane=transaction', seasonHref: '/maxis/?view=season&lane=transaction', seasonTitle: 'Transaction Maxi Season', seasonDetail: 'Open the protocol-season Transaction Maxi race', detail: 'Open the all-time Transaction Maxi crown board', keywords: ['transaction maxi', 'transactions maxi', 'transaction crown', 'transaction season'] },
            { id: 'maxis-gaming', title: 'Gaming Maxi', href: '/maxis/?lane=gaming', seasonHref: '/maxis/?view=season&lane=gaming', seasonTitle: 'Gaming Maxi Season', seasonDetail: 'Open the protocol-season Gaming Maxi race', detail: 'Open the Gaming Maxi crown board', keywords: ['gaming maxi', 'gaming crown', 'gaming season'] },
            { id: 'maxis-delegation', title: 'Delegation Maxi Season', href: '/maxis/?view=season&lane=delegation', detail: 'Open the protocol-season Delegation Maxi race', keywords: ['delegation maxi', 'delegation crown', 'delegation season'] },
            { id: 'maxis-liquidity', title: 'Liquidity Maxi Season', href: '/maxis/?view=season&lane=liquidity', detail: 'Open the protocol-season Liquidity Maxi race', keywords: ['liquidity maxi', 'liquidity crown', 'liquidity season'] },
            { id: 'maxis-bridge', title: 'Bridge Maxi Season', href: '/maxis/?view=season&lane=bridge', detail: 'Open the protocol-season Bridge Maxi race', keywords: ['bridge maxi', 'bridge crown', 'bridge season'] },
            { id: 'maxis-builder', title: 'Builder Maxi Season', href: '/maxis/?view=season&lane=builder', detail: 'Open the protocol-season Builder Maxi race', keywords: ['builder maxi', 'builder crown', 'builder season'] }
        ],
        starter: 4,
        searchChip: { label: '/maxis', order: 4 },
        fresh: true,
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'health',
        title: 'Network Health',
        href: '/health/',
        hash: '#health',
        hashAliases: ['#network-health'],
        group: 'Live Rooms',
        detail: 'Blocks, Nakamoto coefficients, consensus timing, Octez versions, missed rights, and the Teztale lens',
        keywords: ['health', 'blocks', 'finality', 'attestation power', 'missed attestations', 'missed blocks', 'round zero', 'round 0', 'consensus', 'consensus lens', 'pre quorum', 'quorum timing', 'validation delay', 'application delay', 'reception histogram', 'octez', 'octez versions', 'version adoption', 'teztale', 'native explorer', 'operation receipt', 'block receipt', 'missed rights', 'nakamoto', 'nakamoto coefficient', 'quorum control coefficient', 'decentralization', 'one third', 'two thirds'],
        starter: 5,
        searchChip: { label: '/health', order: 5 },
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'liquidity-baking',
        title: 'Liquidity Baking',
        href: '/lb/',
        hash: '#lb',
        hashAliases: ['#liquidity-baking', '#lb-tile', '#liquidity-baking-tile'],
        group: 'Live Rooms',
        detail: 'LB votes, OFF-vote EMA, subsidy state, and liquidity lore',
        keywords: ['lb', 'liquidity', 'ema', 'subsidy', 'liquidity baking'],
        starter: 6,
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'tezosx',
        title: 'Tezos X',
        href: '/tezosx/',
        paths: ['/tezlink/'],
        hash: '#tezosx',
        hashAliases: ['#tezlink'],
        group: 'Live Rooms',
        detail: 'Etherlink TVL, transaction tape, gas oracle, and L2 activity',
        keywords: ['tezos x', 'etherlink', 'l2', 'tezlink'],
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'l2-governance',
        title: 'Tezos X Governance',
        href: '/l2chamber/',
        hash: '#l2chamber',
        hashAliases: ['#etherlink-governance', '#etherlink-gov', '#etherlink'],
        group: 'Live Rooms',
        detail: 'Etherlink FAST, SLOW, sequencer, and governance contract tracks',
        keywords: ['etherlink governance', 'l2 governance', 'fast', 'slow', 'sequencer'],
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'tz4',
        title: 'tz4 Adoption',
        href: '/tz4/',
        hash: '#tz4',
        hashAliases: ['#tz4-adoption'],
        group: 'Live Rooms',
        detail: 'BLS consensus keys, pending switches, adoption power, and holdouts',
        keywords: ['tz4', 'bls', 'consensus keys', 'baker adoption'],
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'ledger-flow',
        title: 'Ledger Flow',
        href: '/ledger-flow/',
        hash: '#ledger-flow',
        hashAliases: ['#flow'],
        group: 'Account Rooms',
        detail: 'Transfer paths around any Tezos account: sent, received, and first funding',
        keywords: ['ledger flow', 'transfers', 'account flow', 'graph', 'wallet history'],
        searchChip: { label: '/flow', order: 7 },
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'domains',
        title: 'Tezos Domains',
        href: '/domains/',
        hash: '#domains',
        hashAliases: ['#tezos-domains'],
        group: 'Account Rooms',
        detail: '.tez lookup, live registrations, auctions, offers, and expiry pressure',
        keywords: ['domains', '.tez', 'identity', 'names', 'domain lookup'],
        searchChip: { label: '/domains', order: 6 },
        fresh: true,
        sitemap: { changefreq: 'hourly', priority: '0.8' }
    },
    {
        id: 'ctez',
        title: 'ctez Oven Exit',
        href: '/ctez/',
        hash: '#ctez',
        hashAliases: ['#ctez-oven', '#ctez-guide'],
        group: 'Account Rooms',
        detail: 'Find and close legacy ctez ovens safely through wallet-reviewed steps',
        keywords: ['ctez', 'ctez oven exit', 'ctez oven guide', 'ctez end of life', 'oven', 'withdraw', 'legacy recovery'],
        sitemap: { changefreq: 'monthly', priority: '0.7' }
    },
    {
        id: 'price',
        title: 'XTZ Market Watch',
        href: '/#price',
        hash: '#price',
        group: 'Live Signals',
        detail: 'Live XTZ price, market context, predictions, and local alerts',
        keywords: ['price', 'xtz price', 'market cap', 'price intelligence', 'price alerts', 'market watch']
    },
    {
        id: 'whales',
        title: 'Large Tez Transfers',
        href: '/#whales',
        hash: '#whales',
        group: 'Live Signals',
        detail: 'Transfers, stakes, and delegations over 1,000 tez as they land',
        keywords: ['whales', 'large transfers', 'mini whale', 'transfer feed']
    },
    {
        id: 'giants',
        title: 'Dormant Wallet Movement',
        href: '/#giants',
        hash: '#giants',
        group: 'Live Signals',
        detail: 'Large inactive wallets moving again after long quiet periods',
        keywords: ['giants', 'sleeping giants', 'dormant wallets', 'awakenings']
    },
    {
        id: 'hot-today',
        title: "What's Hot Today",
        href: '/#hot-today',
        hash: '#hot-today',
        group: 'Live Signals',
        detail: 'The ranked live pulse of unusual Tezos movement, milestones, and Network Moments',
        keywords: ['what is hot today', "what's hot today", 'hot today', 'live pulse', 'daily briefing', 'network moments', 'network milestones', 'milestones']
    },
    {
        id: 'staking',
        title: 'Staking Guide',
        href: '/staking/',
        group: 'Guides',
        detail: 'Delegation, direct staking, reward timing, and APY context',
        keywords: ['staking', 'delegate', 'rewards', 'apy', 'how to stake'],
        sitemap: { changefreq: 'daily', priority: '0.9' }
    },
    {
        id: 'governance-guide',
        title: 'Governance Guide',
        href: '/governance/',
        group: 'Guides',
        detail: 'How Tezos self-amendment works, live voting, and governance RSS',
        keywords: ['governance guide', 'voting', 'self-amending', 'how governance works'],
        sitemap: { changefreq: 'daily', priority: '0.9' }
    },
    {
        id: 'bakers-guide',
        title: 'Bakers Directory Guide',
        href: '/bakers/',
        group: 'Guides',
        detail: 'Browse active bakers and learn how to choose a delegation lane',
        keywords: ['bakers', 'validators', 'delegation', 'directory', 'choose baker'],
        sitemap: { changefreq: 'daily', priority: '0.9' }
    },
    {
        id: 'compare',
        title: 'Chain Compare Guide',
        href: '/compare/',
        group: 'Guides',
        detail: 'Tezos compared with Ethereum, Solana, Cardano, and Algorand',
        keywords: ['compare', 'ethereum', 'solana', 'cardano', 'algorand', 'tezos versus', 'tezos vs'],
        searchIntents: [
            { id: 'compare-ethereum', title: 'Tezos vs Ethereum', href: '/compare/tezos-vs-ethereum.html', detail: 'Open the sourced Tezos and Ethereum comparison', keywords: ['tezos vs ethereum', 'tezos versus ethereum', 'ethereum comparison'], sitemap: { changefreq: 'daily', priority: '0.9' } },
            { id: 'compare-solana', title: 'Tezos vs Solana', href: '/compare/tezos-vs-solana.html', detail: 'Open the sourced Tezos and Solana comparison', keywords: ['tezos vs solana', 'tezos versus solana', 'solana comparison'], sitemap: { changefreq: 'daily', priority: '0.9' } },
            { id: 'compare-cardano', title: 'Tezos vs Cardano', href: '/compare/tezos-vs-cardano.html', detail: 'Open the sourced Tezos and Cardano comparison', keywords: ['tezos vs cardano', 'tezos versus cardano', 'cardano comparison'], sitemap: { changefreq: 'daily', priority: '0.9' } },
            { id: 'compare-algorand', title: 'Tezos vs Algorand', href: '/compare/tezos-vs-algorand.html', detail: 'Open the sourced Tezos and Algorand comparison', keywords: ['tezos vs algorand', 'tezos versus algorand', 'algorand comparison'], sitemap: { changefreq: 'daily', priority: '0.9' } }
        ],
        sitemap: { changefreq: 'daily', priority: '0.8' }
    },
    {
        id: 'calculator',
        title: 'Rewards Calculator',
        href: '/#calculator',
        hash: '#calculator',
        group: 'Tools',
        detail: 'Estimate delegation, staking, baker income, and first payout timing',
        keywords: ['calculator', 'rewards calculator', 'staking rewards estimator', 'yield', 'apy', '/calculator']
    },
    {
        id: 'leaderboard',
        title: 'Baker Leaderboard',
        href: '/#leaderboard',
        hash: '#leaderboard',
        hashAliases: ['#baker'],
        group: 'Tools',
        detail: 'Rank active bakers and find candidates with open delegation room',
        keywords: ['leaderboard', 'baker leaderboard', 'baker directory', 'baker', 'validator', 'capacity', '/leaderboard']
    },
    {
        id: 'history',
        title: 'Cycle History',
        href: '/#history',
        hash: '#history',
        group: 'Tools',
        detail: 'Rewind core Tezos metrics across cycles and open historical charts',
        keywords: ['history', 'historical data', 'charts', 'cycles', '/history']
    },
    {
        id: 'snapshot',
        title: 'Network Snapshot',
        href: '/#snapshot',
        hash: '#snapshot',
        group: 'Tools',
        detail: 'Generate a shareable State of Tezos weekly network snapshot',
        keywords: ['network snapshot', 'state of tezos', 'weekly snapshot', 'share card']
    },
    {
        id: 'live-compare',
        title: 'Live Chain Comparison',
        href: '/#compare',
        hash: '#compare',
        group: 'Tools',
        detail: 'Compare live Tezos valuation, staking, activity, and cost metrics',
        keywords: ['live compare', 'comparison', 'compare chains', '/compare']
    },
    {
        id: 'widgets',
        title: 'Embed Widgets',
        href: '/widgets/builder.html',
        group: 'Tools',
        detail: 'Build embeddable Tezos Systems stats for another site',
        keywords: ['widgets', 'tezos widgets', 'widget builder', 'embed', 'block height widget', 'price widget', 'staking widget', 'baker widget', 'protocol widget', 'governance widget', 'combo widget'],
        searchIntents: [
            { id: 'widget-baker-count', title: 'Baker Count Widget', href: '/widgets/baker-count.html', detail: 'Open the live active-baker embed', keywords: ['baker count widget', 'active bakers embed'], sitemap: { changefreq: 'daily', priority: '0.5' } },
            { id: 'widget-price', title: 'XTZ Price Widget', href: '/widgets/price.html', detail: 'Open the live XTZ price and 24-hour change embed', keywords: ['price widget', 'xtz price embed'], sitemap: { changefreq: 'hourly', priority: '0.5' } },
            { id: 'widget-block-height', title: 'Block Height Widget', href: '/widgets/block-height.html', detail: 'Open the live Tezos head-block embed', keywords: ['block height widget', 'block ticker embed'], sitemap: { changefreq: 'hourly', priority: '0.5' } },
            { id: 'widget-staking-ratio', title: 'Staking Ratio Widget', href: '/widgets/staking-ratio.html', detail: 'Open the live Tezos staking-ratio embed', keywords: ['staking ratio widget', 'staking gauge embed'], sitemap: { changefreq: 'daily', priority: '0.5' } },
            { id: 'widget-protocol', title: 'Protocol Widget', href: '/widgets/protocol.html', detail: 'Open the current Tezos protocol embed', keywords: ['protocol widget', 'current protocol embed'], sitemap: { changefreq: 'daily', priority: '0.5' } },
            { id: 'widget-governance', title: 'Governance Widget', href: '/widgets/governance.html', detail: 'Open the current Tezos voting-period embed', keywords: ['governance widget', 'voting period embed'], sitemap: { changefreq: 'daily', priority: '0.5' } },
            { id: 'widget-baker-card', title: 'Baker Card Widget', href: '/widgets/baker-card.html', detail: 'Open the address-configurable baker report embed', keywords: ['baker card widget', 'baker report embed'], sitemap: { changefreq: 'daily', priority: '0.5' } },
            { id: 'widget-combo', title: 'Combo Strip Widget', href: '/widgets/combo.html', detail: 'Open the configurable multi-stat Tezos embed', keywords: ['combo widget', 'multi stat embed', 'stats strip'], sitemap: { changefreq: 'daily', priority: '0.5' } }
        ],
        sitemap: { changefreq: 'monthly', priority: '0.6' }
    },
    {
        id: 'hen',
        title: 'HEN Live Feed',
        href: '/hen/',
        paths: ['/hen/', '/hen/index.html'],
        hashAliases: ['#nfts'],
        group: 'Culture & Feeds',
        detail: 'Teia and OBJKT collecting surface with live NFT context',
        keywords: ['hen', 'hen teia collecting', 'hen / teia collecting', 'teia', 'objkt', 'nft', 'art', 'collecting', 'live mints', '/nfts'],
        sitemap: { changefreq: 'daily', priority: '0.7' }
    },
    {
        id: 'feed',
        title: 'Governance RSS',
        href: '/feed.xml',
        group: 'Culture & Feeds',
        detail: 'Generated governance RSS for proposals, periods, and outcomes',
        keywords: ['rss', 'feed', 'governance alerts'],
        sitemap: { changefreq: 'hourly', priority: '0.5' }
    }
];

export const SITE_MAP_NAV_GROUPS = [
    'Home',
    'Story Rooms',
    'Live Rooms',
    'Account Rooms',
    'Live Signals',
    'Guides',
    'Tools',
    'Culture & Feeds'
];

export const SITE_MAP_RELATIONS = {
    home: ['chambers', 'pulse', 'my-tezos', 'maxis'],
    chambers: ['pulse', 'staking-chamber', 'health', 'maxis'],
    'my-tezos': ['domains', 'ledger-flow', 'maxis', 'calculator'],
    anthology: ['chamber', 'governance-guide', 'health', 'pulse'],
    chamber: ['anthology', 'liquidity-baking', 'l2-governance', 'governance-guide'],
    pulse: ['health', 'hot-today', 'staking-chamber', 'maxis'],
    'staking-chamber': ['ledger-flow', 'leaderboard', 'staking', 'calculator'],
    maxis: ['ledger-flow', 'domains', 'hen', 'my-tezos'],
    health: ['pulse', 'tz4', 'bakers-guide', 'staking-chamber'],
    'liquidity-baking': ['chamber', 'pulse', 'staking', 'health'],
    tezosx: ['l2-governance', 'pulse', 'compare', 'health'],
    'l2-governance': ['tezosx', 'chamber', 'anthology', 'pulse'],
    tz4: ['health', 'bakers-guide', 'pulse', 'staking-chamber'],
    'ledger-flow': ['my-tezos', 'domains', 'ctez', 'whales'],
    domains: ['my-tezos', 'ledger-flow', 'maxis', 'hen'],
    ctez: ['my-tezos', 'ledger-flow', 'staking', 'pulse'],
    price: ['live-compare', 'history', 'pulse', 'snapshot'],
    whales: ['ledger-flow', 'staking-chamber', 'giants', 'pulse'],
    giants: ['ledger-flow', 'whales', 'pulse', 'history'],
    'hot-today': ['pulse', 'health', 'staking-chamber', 'maxis'],
    staking: ['staking-chamber', 'calculator', 'bakers-guide', 'ledger-flow'],
    'governance-guide': ['chamber', 'anthology', 'feed', 'my-tezos'],
    'bakers-guide': ['leaderboard', 'health', 'tz4', 'staking'],
    compare: ['pulse', 'health', 'anthology', 'staking-chamber'],
    calculator: ['staking', 'staking-chamber', 'bakers-guide', 'leaderboard'],
    leaderboard: ['bakers-guide', 'health', 'tz4', 'my-tezos'],
    history: ['pulse', 'health', 'price', 'anthology'],
    snapshot: ['pulse', 'history', 'widgets', 'price'],
    'live-compare': ['compare', 'pulse', 'health', 'price'],
    widgets: ['pulse', 'snapshot', 'price', 'home'],
    hen: ['maxis', 'my-tezos', 'domains', 'ledger-flow'],
    feed: ['chamber', 'governance-guide', 'anthology', 'my-tezos']
};

export function findSiteMapEntry(id) {
    return SITE_MAP.find((entry) => entry.id === id) || null;
}

export function siteMapRoute(entry) {
    return entry?.href || '/';
}

export function siteMapCanonicalRoute(value) {
    if (value && typeof value === 'object') return siteMapRoute(value);
    const route = String(value || '').trim();
    if (!route) return '/';
    if (!route.startsWith('#')) return route;
    if (route.includes('=')) return `/${route}`;
    const hashKey = `#${route.replace(/^#/, '').split('=')[0]}`;
    const entry = SITE_MAP.find((candidate) => (
        candidate.hash === hashKey || (candidate.hashAliases || []).includes(hashKey)
    ));
    return entry ? siteMapRoute(entry) : `/${route}`;
}

export function siteMapSearchText(entry) {
    return [
        entry.id,
        entry.title,
        entry.detail,
        entry.group,
        entry.href,
        entry.hash,
        ...(entry.hashAliases || []),
        ...(entry.paths || []),
        ...(entry.keywords || [])
    ].filter(Boolean).join(' ').toLowerCase();
}

function normalizedSearchValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^\//, '')
        .replace(/[?#].*$/, '')
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ');
}

export function siteMapSearchScore(entry, query) {
    const q = String(query || '').trim().toLowerCase();
    const bare = q.replace(/^\//, '');
    const normalized = normalizedSearchValue(q);
    const title = normalizedSearchValue(entry.title);
    const id = normalizedSearchValue(entry.id);
    const href = String(entry.href || '').toLowerCase();
    const hash = String(entry.hash || '').toLowerCase().replace(/^#/, '');
    const keywords = (entry.keywords || []).map((keyword) => String(keyword).toLowerCase());
    const normalizedKeywords = keywords.map(normalizedSearchValue);
    const haystack = siteMapSearchText(entry);

    if (q === String(entry.href || '').toLowerCase() || q === String(entry.hash || '').toLowerCase()) return 120;
    if (q.startsWith('/') && hash === bare) return 118;
    if (normalized === title || normalized === id || normalized === hash) return 115;
    if (normalizedKeywords.includes(normalized)) return 110;
    if (href === `/${bare}` || href === `/${bare}/` || href === `/#${bare}`) return 105;
    if (title.startsWith(normalized) || id.startsWith(normalized)) return 90;
    if (normalizedKeywords.some((keyword) => keyword.startsWith(normalized))) return 85;
    if (title.includes(normalized) || id.includes(normalized)) return 75;
    if (haystack.includes(q) || haystack.includes(bare)) return 50;
    return 0;
}

export function searchSiteMap(query) {
    const raw = String(query || '').trim();
    if (!raw) return siteMapStarters();
    return SITE_MAP
        .map((entry, index) => ({ entry, index, score: siteMapSearchScore(entry, raw) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((item) => item.entry);
}

export function searchSiteMapIntents(query) {
    const raw = String(query || '').trim();
    if (!raw) return [];
    const wantsSeason = /\bseason\b/i.test(raw);
    const queryTokens = normalizedSearchValue(raw).split(' ').filter(Boolean);
    return SITE_MAP
        .flatMap((entry, parentIndex) => (entry.searchIntents || []).map((intent, intentIndex) => {
            const seasonVariant = wantsSeason && intent.seasonHref;
            return {
                ...intent,
                title: seasonVariant ? (intent.seasonTitle || intent.title) : intent.title,
                detail: seasonVariant ? (intent.seasonDetail || intent.detail) : intent.detail,
                group: intent.group || entry.group,
                parentId: entry.id,
                parentTitle: entry.title,
                href: seasonVariant ? intent.seasonHref : intent.href,
                parentIndex,
                intentIndex
            };
        }))
        .map((intent) => {
            const discriminantTokens = normalizedSearchValue(String(intent.id || '').replace(/^[^-]+-/, '')).split(' ').filter(Boolean);
            const intentTokens = [intent.id, intent.title, intent.detail, intent.group, ...(intent.keywords || [])]
                .flatMap((value) => normalizedSearchValue(value).split(' '))
                .filter(Boolean);
            const hasSpecificIntent = queryTokens.some((queryToken) => (
                queryToken.length >= 3
                && discriminantTokens.some((token) => token.startsWith(queryToken) || queryToken.startsWith(token))
            ));
            const coversEveryToken = queryTokens.every((queryToken) => intentTokens.some((token) => (
                token === queryToken
                || (queryToken.length >= 3 && (token.startsWith(queryToken) || queryToken.startsWith(token)))
            )));
            const score = Math.max(siteMapSearchScore(intent, raw), coversEveryToken ? 108 : 0);
            return { intent, score, hasSpecificIntent };
        })
        .filter(({ score, hasSpecificIntent }) => hasSpecificIntent && score >= 75)
        .sort((a, b) => b.score - a.score || a.intent.parentIndex - b.intent.parentIndex || a.intent.intentIndex - b.intent.intentIndex)
        .map(({ intent, score }) => ({ ...intent, searchScore: score }));
}

export function siteMapGroup(label) {
    return SITE_MAP.filter((entry) => entry.group === label);
}

export function siteMapStarters() {
    return SITE_MAP
        .filter((entry) => Number.isFinite(entry.starter))
        .sort((a, b) => a.starter - b.starter);
}

export function siteMapBrowseEntries() {
    return SITE_MAP
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => SITE_MAP_NAV_GROUPS.includes(entry.group))
        .sort((a, b) => (
            SITE_MAP_NAV_GROUPS.indexOf(a.entry.group) - SITE_MAP_NAV_GROUPS.indexOf(b.entry.group)
            || a.index - b.index
        ))
        .map(({ entry }) => entry);
}

export function siteMapDirectoryChildren(entryOrId) {
    const entry = typeof entryOrId === 'string' ? findSiteMapEntry(entryOrId) : entryOrId;
    if (!entry) return [];
    return (entry.searchIntents || [])
        .filter((intent) => intent.directory || intent.sitemap)
        .map((intent) => ({
            ...intent,
            group: intent.group || entry.group,
            parentId: entry.id,
            parentTitle: entry.title
        }));
}

export function siteMapBrowseIntents() {
    return siteMapBrowseEntries().flatMap((entry) => siteMapDirectoryChildren(entry));
}

export function siteMapSitemapEntries() {
    const seen = new Set();
    return SITE_MAP
        .flatMap((entry) => [
            ...(entry.sitemap ? [{
                id: entry.id,
                title: entry.title,
                href: entry.sitemap.href || entry.href,
                changefreq: entry.sitemap.changefreq,
                priority: entry.sitemap.priority
            }] : []),
            ...(entry.searchIntents || [])
                .filter((intent) => intent.sitemap)
                .map((intent) => ({
                    id: intent.id,
                    title: intent.title,
                    href: intent.sitemap.href || intent.href,
                    changefreq: intent.sitemap.changefreq,
                    priority: intent.sitemap.priority,
                    parentId: entry.id
                }))
        ])
        .filter((entry) => {
            if (!entry.href || seen.has(entry.href)) return false;
            seen.add(entry.href);
            return true;
        });
}

export function siteMapSearchChips() {
    return SITE_MAP
        .filter((entry) => entry.searchChip)
        .sort((a, b) => a.searchChip.order - b.searchChip.order)
        .map((entry) => ({
            id: entry.id,
            label: entry.searchChip.label,
            route: siteMapRoute(entry)
        }));
}

export function siteMapRelated(id, limit = 4) {
    const entry = findSiteMapEntry(id) || home;
    const explicit = (SITE_MAP_RELATIONS[entry.id] || [])
        .map(findSiteMapEntry)
        .filter(Boolean);
    const fallback = SITE_MAP.filter((candidate) => (
        candidate.id !== entry.id
        && candidate.group === entry.group
        && !explicit.some((item) => item.id === candidate.id)
    ));
    return [...explicit, ...fallback].slice(0, Math.max(0, limit));
}

export function findCurrentSiteMapEntry(locationLike = globalThis.location) {
    const pathname = String(locationLike?.pathname || '/').replace(/\/index\.html$/, '/');
    const search = String(locationLike?.search || '');
    const hash = String(locationLike?.hash || '');

    if (pathname.startsWith('/compare/')) return findSiteMapEntry('compare');
    if ((pathname === '/' || pathname === '/index.html') && new URLSearchParams(search).get('hen') === '1') {
        return findSiteMapEntry('hen');
    }
    if (pathname === '/' && hash) {
        const hashKey = `#${hash.replace(/^#/, '').split('=')[0]}`;
        const byHash = SITE_MAP.find((entry) => entry.hash === hashKey || (entry.hashAliases || []).includes(hashKey));
        if (byHash) return byHash;
    }
    const byEntryRoute = SITE_MAP.find((entry) => {
        const href = new URL(entry.href, 'https://tezos.systems');
        return href.pathname === pathname || (entry.paths || []).includes(pathname);
    });
    if (byEntryRoute) return byEntryRoute;

    return SITE_MAP.find((entry) => (entry.searchIntents || []).some((intent) => {
        const href = new URL(intent.href, 'https://tezos.systems');
        return href.pathname === pathname;
    })) || home;
}
