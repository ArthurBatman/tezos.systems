import { myTezosAccountKey } from '../core/my-tezos-models.mjs';

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeObjktHolding(raw, ownerAddress, kind = 'collected') {
    const token = raw?.token || raw;
    const contract = String(token?.fa_contract || token?.fa?.contract || '');
    const tokenId = String(token?.token_id ?? token?.pk ?? raw?.token_pk ?? '');
    if (!contract || !tokenId) return null;
    const creators = (Array.isArray(token?.creators) ? token.creators : [])
        .map((creator) => ({
            address: String(creator?.creator_address || creator?.holder?.address || ''),
            name: creator?.holder?.alias || creator?.holder?.tzdomain || null
        }))
        .filter((creator) => creator.address);
    const metadataState = String(token?.metadata_status || '');
    const contentRating = String(token?.content_rating || '');
    const flagValue = token?.flag;
    const flagged = flagValue === true
        || flagValue === 1
        || /^(?:true|1|spam|blocked|unsafe|explicit|nsfw)$/i.test(String(flagValue || ''))
        || /failed|invalid|blocked/i.test(metadataState)
        || /unsafe|explicit|spam/i.test(contentRating);
    return {
        id: `holding:l1:${ownerAddress}:${kind}:${contract}:${tokenId}`,
        accountKey: myTezosAccountKey('l1', ownerAddress),
        ownerAddress,
        layer: 'l1',
        kind,
        contract,
        tokenId,
        quantity: kind === 'created' ? number(token?.supply) : number(raw?.quantity || 1),
        name: String(token?.name || 'Untitled'),
        thumbnail: String(token?.thumbnail_uri || ''),
        collection: {
            name: String(token?.fa?.name || 'Unknown collection'),
            contract,
            logo: String(token?.fa?.logo || '')
        },
        creators,
        activeAskMutez: number(token?.lowest_ask),
        spam: flagged,
        metadataState: metadataState || (token?.name ? 'available' : 'missing'),
        lastChangedAt: Date.parse(raw?.last_incremented_at || raw?.timestamp || '') || null,
        updatedAt: Date.now()
    };
}

export function classifyObjktNftActivity({
    event = {},
    tzktTransfer = null,
    ownerAddress = ''
} = {}) {
    const eventType = String(event.type || event.event_type || '').toLowerCase();
    const eventHash = String(event.operationHash || event.ophash || '');
    const transferHash = String(tzktTransfer?.operationHash || tzktTransfer?.transactionId || tzktTransfer?.hash || '');
    const joined = Boolean(tzktTransfer && eventHash && transferHash && eventHash === transferHash);
    const from = String(tzktTransfer?.from?.address || tzktTransfer?.from || event.seller_address || '');
    const to = String(tzktTransfer?.to?.address || tzktTransfer?.to || event.buyer_address || '');
    const direction = to === ownerAddress ? 'in' : from === ownerAddress ? 'out' : 'neutral';
    if (joined && /sale|fulfill|purchase/.test(eventType)) {
        return {
            kind: direction === 'in' ? 'nft-purchase' : direction === 'out' ? 'nft-sale' : 'nft-transfer',
            direction,
            confidence: 'joined'
        };
    }
    if (joined && /mint/.test(eventType)) {
        return { kind: 'nft-mint', direction: direction === 'neutral' ? 'in' : direction, confidence: 'joined' };
    }
    if (tzktTransfer) {
        return { kind: 'nft-transfer', direction, confidence: 'exact' };
    }
    return { kind: 'nft-unknown', direction: 'neutral', confidence: 'unknown' };
}

export function aggregateCollectionHoldings(records) {
    const byAsset = new Map();
    for (const record of Array.isArray(records) ? records : []) {
        if (!record?.contract || record?.tokenId == null) continue;
        const key = `${record.kind}:${record.contract}:${record.tokenId}`;
        const existing = byAsset.get(key) || {
            ...record,
            id: `aggregate:${key}`,
            quantity: 0,
            ownerBreakdown: [],
            ownerAddresses: []
        };
        existing.quantity += number(record.quantity);
        existing.ownerBreakdown.push({
            address: record.ownerAddress,
            quantity: number(record.quantity)
        });
        if (!existing.ownerAddresses.includes(record.ownerAddress)) existing.ownerAddresses.push(record.ownerAddress);
        existing.spam = existing.spam || record.spam;
        byAsset.set(key, existing);
    }
    return [...byAsset.values()].sort((left, right) => (
        Number(right.updatedAt) - Number(left.updatedAt)
        || left.name.localeCompare(right.name)
    ));
}

export function collectionSummary(records) {
    const holdings = aggregateCollectionHoldings(records);
    const collected = holdings.filter((item) => item.kind === 'collected' && !item.spam);
    const created = holdings.filter((item) => item.kind === 'created' && !item.spam);
    const collections = new Set(collected.map((item) => item.collection?.contract || item.contract));
    const artists = new Set(collected.flatMap((item) => item.creators || []).map((creator) => creator.address).filter(Boolean));
    return {
        assets: collected.length,
        editions: collected.reduce((sum, item) => sum + number(item.quantity), 0),
        collections: collections.size,
        artists: artists.size,
        createdAssets: created.length,
        createdEditions: created.reduce((sum, item) => sum + number(item.quantity), 0),
        spam: holdings.filter((item) => item.spam).length,
        holdings
    };
}
