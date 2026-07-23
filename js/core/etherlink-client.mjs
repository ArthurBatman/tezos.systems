import { API_URLS } from './config.js';
import {
    findMyTezosContractRule,
    loadMyTezosContractRegistry
} from './my-tezos-contract-registry.mjs';
import {
    createActivity,
    createSourceReceipt,
    myTezosAccountKey,
    normalizeEtherlinkAddress
} from './my-tezos-models.mjs';
import {
    initMyTezosRequestBrokerVisibility,
    myTezosRequestBroker
} from './my-tezos-request-broker.mjs';
import {
    friendlyEtherlinkMethod,
    hexWeiToXtz,
    isClassifiedEtherlinkMethod,
    weiToXtz
} from '../features/my-tezos-tezosx-model.mjs';

export const LINKED_ETHERLINK_ACCOUNTS_KEY = 'tezos-systems-linked-etherlink-accounts-v1';

function explorerRequest(path, { signal, priority = 'visible' } = {}) {
    initMyTezosRequestBrokerVisibility();
    return myTezosRequestBroker.request(`${API_URLS.tezlinkExplorer}${path}`, {
        provider: 'blockscout',
        priority,
        signal,
        retries: 3,
        responseType: 'json',
        cache: 'no-store'
    });
}

function rpcRequest(body, { signal, priority = 'interactive' } = {}) {
    initMyTezosRequestBrokerVisibility();
    return myTezosRequestBroker.request(API_URLS.tezlinkRpc, {
        provider: 'etherlinkRpc',
        priority,
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        retries: 3,
        responseType: 'json',
        cache: 'no-store'
    });
}

export async function fetchEtherlinkNativeBalances(addresses, { signal } = {}) {
    const unique = Array.from(new Set((Array.isArray(addresses) ? addresses : [])
        .map(normalizeEtherlinkAddress)
        .filter(Boolean)));
    const requests = unique.map((address, index) => ({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'eth_getBalance',
        params: [address, 'latest']
    }));
    if (!requests.length) return [];
    const payload = await rpcRequest(requests, { signal });
    const rows = Array.isArray(payload) ? payload : [payload];
    const byId = new Map(rows.map((row) => [Number(row?.id), row]));
    return unique.map((address, index) => {
        const result = byId.get(index + 1)?.result;
        const available = typeof result === 'string';
        return {
            address,
            nativeXtz: available ? hexWeiToXtz(result) : null,
            nativeAvailable: available,
            receipt: createSourceReceipt({
            provider: 'Etherlink RPC',
            sourceUrl: API_URLS.tezlinkRpc,
            coverage: { state: available ? 'complete' : 'partial', pages: 1, items: available ? 1 : 0 },
            confidence: 'exact'
        })
        };
    });
}

export async function fetchEtherlinkAccountOverview(address, { signal } = {}) {
    const normalized = normalizeEtherlinkAddress(address);
    if (!normalized) throw new Error('Invalid Etherlink address');
    const info = await explorerRequest(`/addresses/${normalized}`, { signal });
    return {
        address: normalized,
        nativeXtz: info?.coin_balance == null ? null : weiToXtz(info.coin_balance),
        transactions: Number(info?.transactions_count) || 0,
        tokenTransfers: Number(info?.token_transfers_count) || 0,
        gasUsed: Number(info?.gas_usage_count) || 0,
        isContract: Boolean(info?.is_contract),
        contractName: info?.name || info?.metadata?.name || null,
        lastActivity: info?.last_activity_time || info?.last_activity || null,
        receipt: createSourceReceipt({
            provider: 'Blockscout',
            sourceUrl: `https://explorer.etherlink.com/address/${normalized}`,
            coverage: {
                state: 'complete',
                pages: 1,
                items: 1
            },
            confidence: 'exact'
        })
    };
}

function normalizeTokenBalance(item) {
    const token = item?.token || {};
    const decimals = Number(token.decimals ?? item?.decimals);
    const raw = Number(item?.value ?? item?.amount) || 0;
    return {
        contract: String(token.address_hash || token.address || item?.token_address || ''),
        symbol: String(token.symbol || item?.symbol || 'TOKEN'),
        name: String(token.name || item?.name || token.symbol || 'Token'),
        decimals: Number.isFinite(decimals) ? decimals : 0,
        rawBalance: String(item?.value ?? item?.amount ?? '0'),
        balance: raw / (10 ** (Number.isFinite(decimals) ? decimals : 0)),
        type: String(token.type || item?.type || 'ERC-20')
    };
}

function normalizeNft(item, accountKey) {
    const token = item?.token || item;
    const contract = String(token?.address_hash || token?.address || item?.token_address || '');
    const tokenId = String(item?.id ?? item?.token_id ?? token?.token_id ?? '');
    return {
        id: `holding:l2:${accountKey}:${contract}:${tokenId}`,
        accountKey,
        layer: 'l2',
        kind: 'collected',
        contract,
        tokenId,
        quantity: Number(item?.value ?? item?.quantity) || 1,
        name: String(item?.metadata?.name || token?.name || `Token #${tokenId}`),
        thumbnail: String(item?.image_url || item?.metadata?.image || ''),
        collection: { name: String(token?.name || token?.symbol || 'Etherlink NFT'), contract, logo: '' },
        creators: [],
        activeAskMutez: 0,
        spam: false,
        metadataState: item?.metadata ? 'available' : 'missing',
        updatedAt: Date.now()
    };
}

function normalizeTransaction(tx, address, contractRule = null) {
    const normalized = normalizeEtherlinkAddress(address);
    const from = normalizeEtherlinkAddress(tx?.from?.hash || tx?.from);
    const to = normalizeEtherlinkAddress(tx?.to?.hash || tx?.to);
    const direction = from === normalized && to === normalized
        ? 'self'
        : from === normalized
            ? 'out'
            : to === normalized
                ? 'in'
                : 'neutral';
    const hash = String(tx?.hash || '');
    const explorerName = tx?.to?.name || tx?.to?.metadata?.name || null;
    const contractName = contractRule?.label || explorerName;
    const fee = Number(tx?.fee?.value ?? tx?.fee) || 0;
    const method = String(tx?.method || '').toLowerCase();
    const recognizedSwap = contractRule?.kind === 'dex' && contractRule.entrypoints.includes(method);
    const classified = Boolean(contractRule) || isClassifiedEtherlinkMethod(tx?.method);
    return createActivity({
        id: `blockscout:${normalized}:${hash || tx?.block_number || tx?.timestamp}`,
        accountKey: myTezosAccountKey('l2', normalized),
        layer: 'l2',
        kind: tx?.method ? 'contract-call' : 'xtz-transfer',
        direction,
        timestamp: tx?.timestamp,
        levelOrBlock: tx?.block_number,
        operationHash: hash,
        groupKey: hash,
        status: tx?.status || 'unknown',
        amount: Number(tx?.value) || 0,
        asset: { type: 'xtz', symbol: 'XTZ', decimals: 18 },
        counterparties: [
            { address: from, alias: tx?.from?.name || null, role: 'from' },
            { address: to, alias: contractName, role: 'to' }
        ].filter((party) => party.address && party.address !== normalized),
        confidence: classified ? 'classified' : 'exact',
        summary: recognizedSwap
            ? `Recognized swap · ${contractRule.label}`
            : friendlyEtherlinkMethod(tx?.method, contractName),
        sourceReceipts: [createSourceReceipt({
            provider: 'Blockscout',
            sourceUrl: hash ? `https://explorer.etherlink.com/tx/${hash}` : `https://explorer.etherlink.com/address/${normalized}`,
            blockLevel: tx?.block_number,
            coverage: { state: 'partial', pages: 1, items: 1 },
            confidence: classified ? 'classified' : 'exact',
            warnings: [
                ...(explorerName && !contractRule ? [`Explorer label: ${explorerName}`] : []),
                ...(contractRule?.sourceUrl ? [`Classification source: ${contractRule.sourceUrl}`] : [])
            ]
        })],
        feeWei: fee
    });
}

function normalizeTokenTransfer(transfer, address) {
    const normalized = normalizeEtherlinkAddress(address);
    const from = normalizeEtherlinkAddress(transfer?.from?.hash || transfer?.from);
    const to = normalizeEtherlinkAddress(transfer?.to?.hash || transfer?.to);
    const token = transfer?.token || {};
    const tokenType = String(token?.type || transfer?.token_type || '').toUpperCase();
    const isNft = tokenType === 'ERC-721' || tokenType === 'ERC-1155';
    const decimals = Number(transfer?.total?.decimals ?? token?.decimals);
    const rawAmount = String(transfer?.total?.value ?? transfer?.value ?? '0');
    const direction = from === normalized && to === normalized
        ? 'self'
        : from === normalized
            ? 'out'
            : to === normalized
                ? 'in'
                : 'neutral';
    const hash = String(transfer?.transaction_hash || '');
    const symbol = String(token?.symbol || token?.name || (isNft ? 'NFT' : 'TOKEN'));
    const verb = direction === 'in' ? 'Received' : direction === 'out' ? 'Sent' : 'Moved';
    return createActivity({
        id: `blockscout-transfer:${normalized}:${hash}:${transfer?.log_index ?? transfer?.index ?? symbol}`,
        accountKey: myTezosAccountKey('l2', normalized),
        layer: 'l2',
        kind: isNft ? 'nft-transfer' : 'token-transfer',
        direction,
        timestamp: transfer?.timestamp,
        levelOrBlock: transfer?.block_number,
        operationHash: hash,
        groupKey: hash || `blockscout-transfer:${transfer?.log_index ?? transfer?.timestamp}`,
        status: 'applied',
        amount: Number(rawAmount) || 0,
        asset: {
            type: isNft ? 'nft' : 'erc20',
            symbol,
            contract: String(token?.address_hash || ''),
            tokenId: transfer?.token_id == null ? null : String(transfer.token_id),
            decimals: Number.isFinite(decimals) ? decimals : 0
        },
        counterparties: [
            { address: from, alias: transfer?.from?.name || null, role: 'from' },
            { address: to, alias: transfer?.to?.name || null, role: 'to' }
        ].filter((party) => party.address && party.address !== normalized),
        confidence: 'exact',
        summary: `${verb} ${symbol}`,
        sourceReceipts: [createSourceReceipt({
            provider: 'Blockscout',
            sourceUrl: hash ? `https://explorer.etherlink.com/tx/${hash}` : `https://explorer.etherlink.com/address/${normalized}`,
            blockLevel: transfer?.block_number,
            coverage: { state: 'partial', pages: 1, items: 1 },
            confidence: 'exact'
        })]
    });
}

export async function fetchEtherlinkAccountDetails(address, {
    signal,
    transactionCursor = null
} = {}) {
    const normalized = normalizeEtherlinkAddress(address);
    if (!normalized) throw new Error('Invalid Etherlink address');
    const transactionPage = transactionCursor?.transactions || transactionCursor;
    const cursorQuery = transactionPage
        ? `?${new URLSearchParams(transactionPage).toString()}`
        : '';
    const [txResult, tokenResult, nftResult, transferResult] = await Promise.allSettled([
        explorerRequest(`/addresses/${normalized}/transactions${cursorQuery}`, { signal }),
        explorerRequest(`/addresses/${normalized}/token-balances`, { signal }),
        explorerRequest(`/addresses/${normalized}/nft`, { signal }),
        explorerRequest(`/addresses/${normalized}/token-transfers`, { signal })
    ]);
    if ([txResult, tokenResult, nftResult, transferResult].every((result) => result.status === 'rejected')) {
        throw txResult.reason || new Error('Etherlink account details unavailable');
    }
    const txPayload = txResult.status === 'fulfilled' ? txResult.value : {};
    const tokenPayload = tokenResult.status === 'fulfilled' ? tokenResult.value : [];
    const nftPayload = nftResult.status === 'fulfilled' ? nftResult.value : {};
    const transferPayload = transferResult.status === 'fulfilled' ? transferResult.value : {};
    const accountKey = myTezosAccountKey('l2', normalized);
    const registry = await loadMyTezosContractRegistry();
    const transactions = (Array.isArray(txPayload?.items) ? txPayload.items : [])
        .map((tx) => normalizeTransaction(
            tx,
            normalized,
            findMyTezosContractRule(registry, 'l2', tx?.to?.hash || tx?.to)
        ));
    const transfers = (Array.isArray(transferPayload?.items) ? transferPayload.items : [])
        .map((transfer) => normalizeTokenTransfer(transfer, normalized));
    const activity = [...transactions, ...transfers]
        .sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id));
    const tokens = (Array.isArray(tokenPayload) ? tokenPayload : tokenPayload?.items || [])
        .map(normalizeTokenBalance)
        .filter((token) => /^ERC-20$/i.test(token.type) || token.type === '');
    const nfts = (Array.isArray(nftPayload?.items) ? nftPayload.items : Array.isArray(nftPayload) ? nftPayload : [])
        .map((item) => normalizeNft(item, accountKey));
    const nextPageParams = {
        transactions: txPayload?.next_page_params || null,
        transfers: transferPayload?.next_page_params || null,
        nfts: nftPayload?.next_page_params || null
    };
    return {
        transactions: activity,
        transactionRows: transactions,
        transfers,
        tokens,
        nfts,
        nextPageParams: Object.values(nextPageParams).some(Boolean) ? nextPageParams : null,
        receipt: createSourceReceipt({
            provider: 'Blockscout',
            sourceUrl: `https://explorer.etherlink.com/address/${normalized}`,
            cursor: txPayload?.next_page_params ? JSON.stringify(txPayload.next_page_params) : null,
            coverage: {
                state: [txResult, tokenResult, nftResult, transferResult].every((result) => result.status === 'fulfilled') ? 'complete' : 'partial',
                pages: 1,
                items: activity.length + tokens.length + nfts.length
            },
            confidence: 'exact',
            warnings: [
                ...(txResult.status === 'rejected' ? ['Transactions unavailable'] : []),
                ...(tokenResult.status === 'rejected' ? ['ERC-20 balances unavailable'] : []),
                ...(nftResult.status === 'rejected' ? ['NFT holdings unavailable'] : []),
                ...(transferResult.status === 'rejected' ? ['Token transfers unavailable'] : [])
            ]
        })
    };
}
