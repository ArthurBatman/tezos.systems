const home = {
    id: 'home',
    title: 'Dashboard',
    href: '/',
    group: 'Home',
    detail: 'Live Tezos dashboard, command search, Chambers, widgets, and My Tezos',
    keywords: ['tezos systems', 'dashboard', 'home', 'live stats', 'chambers']
};

export const SITE_MAP = [
    home,
    {
        id: 'my-tezos',
        title: 'My Tezos',
        href: '/#my-tezos',
        hash: '#my-tezos',
        group: 'Tools',
        detail: 'Make a wallet or .tez name the center of a personal Tezos dashboard',
        keywords: ['wallet', 'account', 'portfolio', 'rewards', 'baker', 'identity', 'my baker'],
        starter: 1,
        searchChip: { label: 'Wallet or .tez', order: 1 }
    },
    {
        id: 'anthology',
        title: 'Protocol Anthology',
        href: '/anthology/',
        hash: '#protocol-history',
        group: 'Story Rooms',
        detail: 'Self-amendment lore, upgrade arc, debates, and zero-fork history',
        keywords: ['protocol history', 'upgrades', 'self amendment', 'archive', 'lore', 'history']
    },
    {
        id: 'chamber',
        title: 'Tezos L1 Governance',
        href: '/chamber/',
        hash: '#chamber',
        group: 'Story Rooms',
        detail: 'Current vote room, quorum, baker ballots, and governance context',
        keywords: ['governance', 'vote', 'proposal', 'chamber', 'ballot', 'quorum']
    },
    {
        id: 'pulse',
        title: 'Network Pulse',
        href: '/pulse/',
        hash: '#pulse',
        group: 'Live Rooms',
        detail: 'Consensus, economy, market, governance, activity, and ecosystem cards in one live chamber',
        keywords: ['network pulse', 'live stats', 'consensus', 'economy', 'activity', 'market', 'what is hot today', "what's hot today", 'hot today', 'network moments'],
        starter: 2,
        searchChip: { label: '/pulse', order: 2 }
    },
    {
        id: 'staking-chamber',
        title: 'Staking Chamber',
        href: '/stake/',
        hash: '#staking',
        group: 'Live Rooms',
        detail: 'Large stake and unstake moves, current staking share, and the complete >10K history',
        keywords: ['staking chamber', 'stake', 'unstake', 'stakers', 'staking ratio', 'large stake', 'staking moves', '/stake'],
        starter: 3,
        searchChip: { label: '/stake', order: 3 },
        fresh: true
    },
    {
        id: 'maxis',
        title: 'Tezos Maxis',
        href: '/maxis/',
        hash: '#maxis',
        group: 'Live Rooms',
        detail: 'Canonical Tezos crowns, protocol-season races, career Passports, and permanent Champions',
        keywords: ['maxis', 'maxi', 'on-chain crowns', 'all time', 'live', 'protocol season', 'maxi passport', 'passport', 'champions', 'leaderboard', 'art', 'collector', 'mint', 'defi', 'gaming', 'governance', 'staking', 'unicorn'],
        starter: 4,
        searchChip: { label: '/maxis', order: 4 },
        fresh: true
    },
    {
        id: 'health',
        title: 'Network Health',
        href: '/health/',
        hash: '#health',
        group: 'Live Rooms',
        detail: 'Blocks, Nakamoto coefficients, consensus timing, Octez versions, missed rights, and the Teztale lens',
        keywords: ['health', 'blocks', 'consensus', 'octez', 'teztale', 'nakamoto', 'nakamoto coefficient', 'decentralization', 'one third', 'two thirds'],
        starter: 5,
        searchChip: { label: '/health', order: 5 }
    },
    {
        id: 'liquidity-baking',
        title: 'Liquidity Baking',
        href: '/lb/',
        hash: '#lb',
        group: 'Live Rooms',
        detail: 'LB votes, OFF-vote EMA, subsidy state, and liquidity lore',
        keywords: ['lb', 'liquidity', 'ema', 'subsidy', 'liquidity baking'],
        starter: 6
    },
    {
        id: 'tezosx',
        title: 'Tezos X',
        href: '/tezosx/',
        hash: '#tezosx',
        group: 'Live Rooms',
        detail: 'Etherlink TVL, transaction tape, gas oracle, and L2 activity',
        keywords: ['tezos x', 'etherlink', 'l2', 'tezlink']
    },
    {
        id: 'l2-governance',
        title: 'Tezos X Governance',
        href: '/l2chamber/',
        hash: '#l2chamber',
        group: 'Live Rooms',
        detail: 'Etherlink FAST, SLOW, sequencer, and governance contract tracks',
        keywords: ['etherlink governance', 'l2 governance', 'fast', 'slow', 'sequencer']
    },
    {
        id: 'tz4',
        title: 'tz4 Adoption',
        href: '/tz4/',
        hash: '#tz4',
        group: 'Live Rooms',
        detail: 'BLS consensus keys, pending switches, adoption power, and holdouts',
        keywords: ['tz4', 'bls', 'consensus keys', 'baker adoption']
    },
    {
        id: 'ledger-flow',
        title: 'Ledger Flow',
        href: '/ledger-flow/',
        hash: '#ledger-flow',
        group: 'Account Rooms',
        detail: 'Transfer paths around any Tezos account: sent, received, and first funding',
        keywords: ['ledger flow', 'transfers', 'account flow', 'graph', 'wallet history'],
        searchChip: { label: '/flow', order: 7 }
    },
    {
        id: 'domains',
        title: 'Tezos Domains',
        href: '/domains/',
        hash: '#domains',
        group: 'Account Rooms',
        detail: '.tez lookup, live registrations, auctions, offers, and expiry pressure',
        keywords: ['domains', '.tez', 'identity', 'names', 'domain lookup'],
        searchChip: { label: '/domains', order: 6 },
        fresh: true
    },
    {
        id: 'ctez',
        title: 'ctez Oven Guide',
        href: '/ctez/',
        hash: '#ctez',
        group: 'Account Rooms',
        detail: 'Find and close legacy ctez ovens safely through wallet-reviewed steps',
        keywords: ['ctez', 'oven', 'withdraw', 'legacy recovery']
    },
    {
        id: 'price',
        title: 'XTZ Market Watch',
        href: '/#price',
        hash: '#price',
        group: 'Live Signals',
        detail: 'Live XTZ price, market context, predictions, and local alerts',
        keywords: ['price', 'xtz price', 'market cap', 'price intelligence', 'market watch']
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
        keywords: ['what is hot today', "what's hot today", 'hot today', 'live pulse', 'network moments', 'milestones']
    },
    {
        id: 'staking',
        title: 'Staking Guide',
        href: '/staking/',
        group: 'Guides',
        detail: 'Delegation, direct staking, reward timing, and APY context',
        keywords: ['staking', 'delegate', 'rewards', 'apy', 'how to stake']
    },
    {
        id: 'governance-guide',
        title: 'Governance Guide',
        href: '/governance/',
        group: 'Guides',
        detail: 'How Tezos self-amendment works, live voting, and governance RSS',
        keywords: ['governance guide', 'voting', 'self-amending', 'how governance works']
    },
    {
        id: 'bakers-guide',
        title: 'Bakers Directory Guide',
        href: '/bakers/',
        group: 'Guides',
        detail: 'Browse active bakers and learn how to choose a delegation lane',
        keywords: ['bakers', 'validators', 'delegation', 'directory', 'choose baker']
    },
    {
        id: 'compare',
        title: 'Chain Compare Guide',
        href: '/compare/',
        group: 'Guides',
        detail: 'Tezos compared with Ethereum, Solana, Cardano, and Algorand',
        keywords: ['compare', 'ethereum', 'solana', 'cardano', 'algorand', 'tezos versus', 'tezos vs']
    },
    {
        id: 'calculator',
        title: 'Rewards Calculator',
        href: '/#calculator',
        hash: '#calculator',
        group: 'Tools',
        detail: 'Estimate delegation, staking, baker income, and first payout timing',
        keywords: ['calculator', 'rewards', 'yield', 'apy', '/calculator']
    },
    {
        id: 'leaderboard',
        title: 'Baker Leaderboard',
        href: '/#leaderboard',
        hash: '#leaderboard',
        group: 'Tools',
        detail: 'Rank active bakers and find candidates with open delegation room',
        keywords: ['leaderboard', 'baker', 'validator', 'capacity', '/leaderboard']
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
        keywords: ['widgets', 'widget builder', 'embed', 'block height widget', 'price widget', 'staking widget', 'baker widget']
    },
    {
        id: 'hen',
        title: 'HEN Live Feed',
        href: '/?hen=1',
        paths: ['/hen/'],
        group: 'Culture & Feeds',
        detail: 'Teia and OBJKT collecting surface with live NFT context',
        keywords: ['hen', 'teia', 'objkt', 'nft', 'art', 'collecting', 'live mints', '/nfts']
    },
    {
        id: 'feed',
        title: 'Governance RSS',
        href: '/feed.xml',
        group: 'Culture & Feeds',
        detail: 'Generated governance RSS for proposals, periods, and outcomes',
        keywords: ['rss', 'feed', 'governance alerts']
    }
];

export const SITE_MAP_NAV_GROUPS = [
    'Story Rooms',
    'Live Rooms',
    'Account Rooms',
    'Live Signals',
    'Guides',
    'Tools',
    'Culture & Feeds'
];

export const SITE_MAP_RELATIONS = {
    home: ['pulse', 'my-tezos', 'staking-chamber', 'maxis'],
    'my-tezos': ['domains', 'ledger-flow', 'maxis', 'calculator'],
    anthology: ['chamber', 'governance-guide', 'health', 'pulse'],
    chamber: ['anthology', 'liquidity-baking', 'l2-governance', 'governance-guide'],
    pulse: ['health', 'staking-chamber', 'maxis', 'tezosx'],
    'staking-chamber': ['ledger-flow', 'leaderboard', 'staking', 'calculator'],
    maxis: ['ledger-flow', 'domains', 'hen', 'my-tezos'],
    health: ['pulse', 'tz4', 'bakers-guide', 'staking-chamber'],
    'liquidity-baking': ['chamber', 'pulse', 'staking', 'health'],
    tezosx: ['l2-governance', 'pulse', 'compare', 'health'],
    'l2-governance': ['tezosx', 'chamber', 'anthology', 'pulse'],
    tz4: ['health', 'bakers-guide', 'pulse', 'staking-chamber'],
    'ledger-flow': ['my-tezos', 'domains', 'maxis', 'whales'],
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
    snapshot: ['pulse', 'history', 'chamber', 'price'],
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

export function siteMapSearchText(entry) {
    return [
        entry.id,
        entry.title,
        entry.detail,
        entry.group,
        entry.href,
        entry.hash,
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

function siteMapSearchScore(entry, query) {
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

export function siteMapGroup(label) {
    return SITE_MAP.filter((entry) => entry.group === label);
}

export function siteMapStarters() {
    return SITE_MAP
        .filter((entry) => Number.isFinite(entry.starter))
        .sort((a, b) => a.starter - b.starter);
}

export function siteMapSearchChips() {
    return SITE_MAP
        .filter((entry) => entry.searchChip)
        .sort((a, b) => a.searchChip.order - b.searchChip.order)
        .map((entry) => ({
            id: entry.id,
            label: entry.searchChip.label,
            route: entry.hash || siteMapRoute(entry)
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
        const byHash = SITE_MAP.find((entry) => entry.hash === hash);
        if (byHash) return byHash;
    }
    return SITE_MAP.find((entry) => {
        const href = new URL(entry.href, 'https://tezos.systems');
        return href.pathname === pathname || (entry.paths || []).includes(pathname);
    }) || home;
}
