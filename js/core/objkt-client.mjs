import { createSourceReceipt } from './my-tezos-models.mjs';
import {
    initMyTezosRequestBrokerVisibility,
    myTezosRequestBroker
} from './my-tezos-request-broker.mjs';
import { normalizeObjktHolding } from '../features/my-tezos-collection-model.mjs';

export const OBJKT_GRAPHQL_URL = 'https://data.objkt.com/v3/graphql';
export const MY_TEZOS_COLLECTION_PAGE_SIZE = 100;

const RICH_QUERY = `query MyTezosCollection($addresses: [String!]!, $rowLimit: Int!, $offset: Int!) {
  holder(where: {address: {_in: $addresses}}, limit: 10, order_by: {address: asc}) {
    address alias tzdomain twitter description logo
  }
  token_holder(where: {holder_address: {_in: $addresses}, quantity: {_gt: "0"}}, order_by: {last_incremented_at: desc}, limit: $rowLimit, offset: $offset) {
    holder_address last_incremented_at quantity
    token {
      token_id fa_contract name thumbnail_uri pk supply lowest_ask flag metadata_status content_rating
      fa { name contract collection_id logo }
      creators { creator_address holder { address alias tzdomain } }
    }
  }
  token_creator(where: {creator_address: {_in: $addresses}}, order_by: {token_pk: desc}, limit: $rowLimit, offset: $offset) {
    creator_address token_pk
    token {
      token_id fa_contract name thumbnail_uri pk supply lowest_ask flag metadata_status content_rating
      fa { name contract collection_id logo }
      creators { creator_address holder { address alias tzdomain } }
    }
  }
}`;

const SAFE_QUERY = `query MyTezosCollectionFallback($addresses: [String!]!, $rowLimit: Int!, $offset: Int!) {
  holder(where: {address: {_in: $addresses}}, limit: 10, order_by: {address: asc}) {
    address alias tzdomain twitter description logo
  }
  token_holder(where: {holder_address: {_in: $addresses}, quantity: {_gt: "0"}}, order_by: {last_incremented_at: desc}, limit: $rowLimit, offset: $offset) {
    holder_address last_incremented_at quantity
    token {
      token_id fa_contract name thumbnail_uri pk supply lowest_ask
      fa { name contract collection_id logo }
    }
  }
  token_creator(where: {creator_address: {_in: $addresses}}, order_by: {token_pk: desc}, limit: $rowLimit, offset: $offset) {
    creator_address token_pk
    token {
      token_id fa_contract name thumbnail_uri pk supply lowest_ask
      fa { name contract collection_id logo }
    }
  }
}`;

async function postGraphql(query, variables, signal) {
    initMyTezosRequestBrokerVisibility();
    const payload = await myTezosRequestBroker.request(OBJKT_GRAPHQL_URL, {
        provider: 'objkt',
        priority: 'visible',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        responseType: 'json',
        retries: 2,
        signal,
        cache: 'no-store'
    });
    if (payload?.errors?.length) throw new Error(payload.errors[0]?.message || 'Objkt returned a GraphQL error');
    return payload?.data || {};
}

export async function fetchObjktCollectionPage(addresses, {
    offset = 0,
    limit = MY_TEZOS_COLLECTION_PAGE_SIZE,
    signal
} = {}) {
    const unique = Array.from(new Set((Array.isArray(addresses) ? addresses : []).map(String).filter(Boolean))).slice(0, 10);
    if (!unique.length) return { profiles: [], holdings: [], complete: true, receipt: null };
    const variables = {
        addresses: unique,
        rowLimit: Math.max(1, Math.min(250, Number(limit) || MY_TEZOS_COLLECTION_PAGE_SIZE)),
        offset: Math.max(0, Number(offset) || 0)
    };
    let data;
    let warnings = [];
    try {
        data = await postGraphql(RICH_QUERY, variables, signal);
    } catch (error) {
        warnings = [`Rich metadata unavailable: ${error.message || error}`];
        data = await postGraphql(SAFE_QUERY, variables, signal);
    }

    const profiles = [];
    const holdings = [];
    const collectedRows = Array.isArray(data?.token_holder) ? data.token_holder : [];
    const createdRows = Array.isArray(data?.token_creator) ? data.token_creator : [];
    const profileByAddress = new Map((Array.isArray(data?.holder) ? data.holder : []).map((holder) => [
        holder.address,
        {
            address: holder.address,
            alias: holder.alias || holder.tzdomain || null,
            tzdomain: holder.tzdomain || null,
            twitter: holder.twitter || null,
            description: holder.description || null,
            logo: holder.logo || null,
            collectedLoaded: 0,
            createdLoaded: 0
        }
    ]));
    for (const row of collectedRows) {
        const ownerAddress = row.holder_address;
        const holding = normalizeObjktHolding(row, ownerAddress, 'collected');
        if (holding) holdings.push(holding);
        const profile = profileByAddress.get(ownerAddress);
        if (profile) profile.collectedLoaded += 1;
    }
    for (const row of createdRows) {
        const ownerAddress = row.creator_address;
        const holding = normalizeObjktHolding(row, ownerAddress, 'created');
        if (holding) holdings.push(holding);
        const profile = profileByAddress.get(ownerAddress);
        if (profile) profile.createdLoaded += 1;
    }
    profiles.push(...profileByAddress.values());
    const complete = collectedRows.length < variables.rowLimit && createdRows.length < variables.rowLimit;

    const receipt = createSourceReceipt({
        provider: 'Objkt',
        sourceUrl: OBJKT_GRAPHQL_URL,
        cursor: complete ? null : String(variables.offset + variables.rowLimit),
        coverage: {
            state: complete ? 'complete' : 'partial',
            pages: 1,
            items: holdings.length
        },
        confidence: 'exact',
        warnings
    });
    return {
        profiles,
        holdings: holdings.map((holding) => ({ ...holding, sourceReceipt: receipt })),
        complete,
        nextOffset: complete ? null : variables.offset + variables.rowLimit,
        receipt
    };
}
