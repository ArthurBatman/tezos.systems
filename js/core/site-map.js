const home = {
    id: 'home',
    title: 'Dashboard',
    href: '/',
    group: 'Home',
    detail: 'Live Tezos dashboard, command search, chambers, widgets, and My Tezos',
    keywords: ['tezos systems', 'dashboard', 'home', 'live stats']
};

export const SITE_MAP = [
    home,
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
        keywords: ['governance', 'vote', 'proposal', 'chamber']
    },
    {
        id: 'health',
        title: 'Network Health',
        href: '/health/',
        hash: '#health',
        group: 'Live Rooms',
        detail: 'Blocks, consensus timing, Octez versions, missed rights, and Teztale lens',
        keywords: ['health', 'blocks', 'consensus', 'octez', 'teztale']
    },
    {
        id: 'liquidity-baking',
        title: 'Liquidity Baking',
        href: '/lb/',
        hash: '#lb',
        group: 'Live Rooms',
        detail: 'LB votes, OFF-vote EMA, subsidy state, and liquidity lore',
        keywords: ['lb', 'liquidity', 'ema', 'subsidy']
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
        keywords: ['etherlink governance', 'l2 governance', 'fast', 'slow']
    },
    {
        id: 'tz4',
        title: 'tz4 Adoption',
        href: '/tz4/',
        hash: '#tz4',
        group: 'Live Rooms',
        detail: 'BLS consensus keys, pending switches, adoption power, and holdouts',
        keywords: ['tz4', 'bls', 'consensus keys']
    },
    {
        id: 'ledger-flow',
        title: 'Ledger Flow',
        href: '/ledger-flow/',
        hash: '#ledger-flow',
        group: 'Account Rooms',
        detail: 'Transfer paths around any Tezos account: sent, received, first funding',
        keywords: ['ledger flow', 'transfers', 'account flow', 'graph']
    },
    {
        id: 'domains',
        title: 'Tezos Domains',
        href: '/domains/',
        hash: '#domains',
        group: 'Account Rooms',
        detail: '.tez lookup, live registrations, auctions, offers, and expiry pressure',
        keywords: ['domains', '.tez', 'identity', 'names']
    },
    {
        id: 'ctez',
        title: 'ctez Oven Guide',
        href: '/ctez/',
        hash: '#ctez',
        group: 'Account Rooms',
        detail: 'Find and close ctez ovens safely through wallet-reviewed steps',
        keywords: ['ctez', 'oven', 'withdraw']
    },
    {
        id: 'staking',
        title: 'Staking Guide',
        href: '/staking/',
        group: 'Guides',
        detail: 'Delegation, direct staking, reward timing, and APY context',
        keywords: ['staking', 'delegate', 'rewards', 'apy']
    },
    {
        id: 'governance-guide',
        title: 'Governance Guide',
        href: '/governance/',
        group: 'Guides',
        detail: 'How Tezos self-amendment works, live voting, and governance RSS',
        keywords: ['governance guide', 'voting', 'self-amending']
    },
    {
        id: 'bakers-guide',
        title: 'Bakers Directory',
        href: '/bakers/',
        group: 'Guides',
        detail: 'Browse active bakers and learn how to choose a delegation lane',
        keywords: ['bakers', 'validators', 'delegation', 'leaderboard']
    },
    {
        id: 'compare',
        title: 'Chain Compare',
        href: '/compare/',
        group: 'Guides',
        detail: 'Tezos compared with Ethereum, Solana, Cardano, and Algorand',
        keywords: ['compare', 'ethereum', 'solana', 'cardano', 'algorand']
    },
    {
        id: 'hen',
        title: 'HEN Live Feed',
        href: '/hen/',
        group: 'Culture',
        detail: 'Teia and OBJKT collecting surface with live NFT context',
        keywords: ['hen', 'teia', 'objkt', 'nft', 'art']
    },
    {
        id: 'widgets',
        title: 'Embed Widgets',
        href: '/widgets/builder.html',
        group: 'Tools',
        detail: 'Build embeddable Tezos Systems stats for another site',
        keywords: ['widgets', 'embed', 'builder']
    },
    {
        id: 'calculator',
        title: 'Rewards Calculator',
        href: '/#calculator',
        hash: '#calculator',
        group: 'Tools',
        detail: 'Estimate delegation, staking, baker income, and first payout timing',
        keywords: ['calculator', 'rewards', 'yield', 'apy']
    },
    {
        id: 'leaderboard',
        title: 'Baker Leaderboard',
        href: '/#leaderboard',
        hash: '#leaderboard',
        group: 'Tools',
        detail: 'Rank active bakers and find candidates with open delegation room',
        keywords: ['leaderboard', 'baker', 'validator', 'capacity']
    },
    {
        id: 'feed',
        title: 'Governance RSS',
        href: '/feed.xml',
        group: 'Feeds',
        detail: 'Generated governance RSS for proposals, periods, and outcomes',
        keywords: ['rss', 'feed', 'governance alerts']
    }
];

export const SITE_MAP_NAV_GROUPS = ['Guides', 'Story Rooms', 'Live Rooms', 'Account Rooms', 'Tools'];

export function findSiteMapEntry(id) {
    return SITE_MAP.find((entry) => entry.id === id) || null;
}

export function siteMapSearchText(entry) {
    return [
        entry.title,
        entry.detail,
        entry.group,
        entry.href,
        entry.hash,
        ...(entry.keywords || [])
    ].filter(Boolean).join(' ').toLowerCase();
}

export function searchSiteMap(query) {
    const raw = String(query || '').trim().toLowerCase();
    if (!raw) return SITE_MAP.filter((entry) => ['home', 'anthology', 'health', 'staking', 'bakers-guide'].includes(entry.id));
    const bare = raw.replace(/^\//, '');
    return SITE_MAP.filter((entry) => {
        const haystack = siteMapSearchText(entry);
        return haystack.includes(raw) || haystack.includes(bare);
    });
}

export function siteMapGroup(label) {
    return SITE_MAP.filter((entry) => entry.group === label);
}
