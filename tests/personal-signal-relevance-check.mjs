import assert from 'node:assert/strict';
import {
    describePersonalSignalRelevance,
    rankSignalsByPersonalRelevance
} from '../js/core/personal-signal-relevance.mjs';

const data = {
    fullAddress: 'tz1PersonalSignalTest1111111111111111111',
    bakerAddr: 'tz1BakerSignalTest111111111111111111111',
    bakerName: 'Signal Baker',
    apyRate: 5.75,
    xtzPrice: 1.25,
    story: {
        proposalsInjected: 1,
        bakerProposalsInjected: 2,
        nftAssetsCollected: 8,
        domainAlias: 'signal.tez',
        daysSinceJoin: 900,
        joinedEra: 'Jakarta',
        creatorStats: { totalCreated: 12 }
    }
};
const portfolio = { total: 500, staked: 125 };
const context = {
    data,
    portfolio,
    stats: { totalBakers: 412 },
    xtzPrice: 1.25,
    linkedEtherlinkAccounts: 2
};

assert.equal(
    describePersonalSignalRelevance({ category: 'security' }, context),
    'Your baker is one of 412 active bakers.',
    'security relevance should require and name the loaded active-baker set'
);
assert.equal(
    describePersonalSignalRelevance({ category: 'ecosystem' }, context),
    'You joined 900 days ago, in the Jakarta era.',
    'ecosystem relevance should use the loaded account tenure and era'
);
assert.equal(
    describePersonalSignalRelevance({ category: 'etherlink' }, context),
    'You have 2 explicitly linked Etherlink accounts.',
    'Etherlink relevance should count only explicitly linked accounts'
);
assert.equal(
    describePersonalSignalRelevance({ category: 'lb' }, context),
    'Subsidy changes affect the issuance side of your 5.75% APY context.',
    'Liquidity Baking relevance should use APY context without claiming an LB holding'
);
assert.equal(
    describePersonalSignalRelevance({ category: 'whales', valueXtz: 10_000 }, context),
    'This move is 20× your current XTZ balance.',
    'whale relevance should compare a numeric move with the loaded balance'
);
assert.equal(
    describePersonalSignalRelevance({ category: 'volume' }, context),
    'Your creator history includes 12 assets on Tezos.',
    'volume relevance should stay tied to proven creator history'
);

for (const category of ['tz4', 'maxis']) {
    assert.equal(
        describePersonalSignalRelevance({ category }, context),
        '',
        `${category} relevance must stay silent until per-account evidence is loaded`
    );
}

for (const [signal, sparseContext] of [
    [{ category: 'security' }, { data: { bakerAddr: data.bakerAddr }, stats: {} }],
    [{ category: 'ecosystem' }, { data: { story: { daysSinceJoin: 900 } } }],
    [{ category: 'etherlink' }, { data, linkedEtherlinkAccounts: 0 }],
    [{ category: 'lb' }, { data: {} }],
    [{ category: 'whales' }, { portfolio, data }],
    [{ category: 'volume' }, { data: { story: {} } }]
]) {
    assert.equal(
        describePersonalSignalRelevance(signal, sparseContext),
        '',
        `${signal.category} relevance must stay silent when its proof field is missing`
    );
}

const ranked = rankSignalsByPersonalRelevance([
    { id: 'general-headliner', category: 'network', score: 500 },
    { id: 'personal-ecosystem', category: 'ecosystem', score: 10 },
    { id: 'personal-security', category: 'security', score: 100 },
    { id: 'general-secondary', category: 'network', score: 200 }
], context);

assert.deepEqual(
    ranked.map(signal => signal.id),
    ['personal-security', 'personal-ecosystem', 'general-headliner', 'general-secondary'],
    'proven personal signals should form the first tier and retain score order within their tier'
);

const unpersonalized = rankSignalsByPersonalRelevance([
    { id: 'low', category: 'network', score: 10 },
    { id: 'high', category: 'network', score: 100 }
], {});
assert.deepEqual(
    unpersonalized.map(signal => signal.id),
    ['high', 'low'],
    'no-address ranking should preserve ordinary score order'
);

console.log('ok - personal signal relevance and ranking semantics');
