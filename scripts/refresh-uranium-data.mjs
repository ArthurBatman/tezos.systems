#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = 'data/uranium-snapshot.json';
const ENTRY_PATH = 'data/uranium-entry-summary.json';
const SNAPSHOT_FILE = path.join(ROOT, SNAPSHOT_PATH);
const ENTRY_FILE = path.join(ROOT, ENTRY_PATH);
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_ENTRY_BYTES = 24 * 1024;
const ENTRY_HISTORY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const TOKEN = '0x79052Ab3C166D4899a1e0DD033aC3b379AF0B1fD';
const TOKEN_LOWER = TOKEN.toLowerCase();
const IMPLEMENTATION = '0x45F8110Bc03C9396ccfBB07A16D58785bFd67F22';
const COMPANION_APP = '0xF02B8aE0D525157797414953103F67D9d4Ee6F0a';
const BLOCKSCOUT = 'https://explorer.etherlink.com';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const KRAKEN = 'https://api.kraken.com/0/public';
const DEFILLAMA = 'https://api.llama.fi';
const ETHERLINK_RPC = 'https://node.mainnet.etherlink.com';
const PROOF_PDF = 'https://storage.googleapis.com/rwa-prod-2379-pdfs/proof-of-reserves/proof-of-reserves.pdf';

const SOURCE_DEFINITIONS = Object.freeze({
  krakenMarket: {
    label: 'Kraken public market API',
    url: 'https://docs.kraken.com/api/docs/category/rest-api/market-data/',
    credit: 'XU3O8/USD pair metadata, ticker, OHLC, order book, and public trade tape',
    endpoints: [
      `${KRAKEN}/AssetPairs?pair=XU3O8USD`,
      `${KRAKEN}/Ticker?pair=XU3O8USD`,
      `${KRAKEN}/OHLC?pair=XU3O8USD&interval=1440`,
      `${KRAKEN}/Depth?pair=XU3O8USD&count=100`,
      `${KRAKEN}/Trades?pair=XU3O8USD`,
      `${KRAKEN}/Trades?pair=XU3O8USD&since=0`
    ]
  },
  krakenListing: {
    label: 'Kraken listing announcement',
    url: 'https://blog.kraken.com/product/asset-listings/xu3o8-is-available-for-trading',
    credit: 'Manual dated receipt that XU3O8 trading was announced live on Kraken',
    endpoints: ['https://blog.kraken.com/product/asset-listings/xu3o8-is-available-for-trading']
  },
  coinGecko: {
    label: 'CoinGecko',
    url: 'https://docs.coingecko.com/reference/introduction',
    credit: 'Uranium token quote, market history, supply, and venue-attributed tickers',
    endpoints: [
      `${COINGECKO}/coins/uranium`,
      `${COINGECKO}/coins/uranium/market_chart?vs_currency=usd&days=365&interval=daily`,
      `${COINGECKO}/coins/uranium/tickers`
    ]
  },
  blockscoutToken: {
    label: 'Etherlink Blockscout token API',
    url: `${BLOCKSCOUT}/token/${TOKEN}`,
    credit: 'xU3O8 token metadata, counters, top-holder page, and latest transfer page',
    endpoints: [
      `${BLOCKSCOUT}/api/v2/tokens/${TOKEN}`,
      `${BLOCKSCOUT}/api/v2/tokens/${TOKEN}/counters`,
      `${BLOCKSCOUT}/api/v2/tokens/${TOKEN}/holders`,
      `${BLOCKSCOUT}/api/v2/tokens/${TOKEN}/transfers`
    ]
  },
  blockscoutContracts: {
    label: 'Etherlink Blockscout verified contracts',
    url: `${BLOCKSCOUT}/address/${TOKEN}?tab=contract`,
    credit: 'Verified proxy lineage, implementation ABI capabilities, and separate companion app identity',
    endpoints: [
      `${BLOCKSCOUT}/api/v2/smart-contracts/${TOKEN}`,
      `${BLOCKSCOUT}/api/v2/smart-contracts/${IMPLEMENTATION}`,
      `${BLOCKSCOUT}/api/v2/smart-contracts/${COMPANION_APP}`
    ]
  },
  etherlinkRpc: {
    label: 'Etherlink mainnet RPC',
    url: 'https://docs.etherlink.com/network/network-information/',
    credit: 'Current read-only xU3O8 contract flags and total supply',
    endpoints: [ETHERLINK_RPC]
  },
  defiLlama: {
    label: 'DefiLlama',
    url: 'https://defillama.com/protocol/uranium.io',
    credit: 'Uranium.io protocol TVL and daily TVL history',
    endpoints: [`${DEFILLAMA}/protocol/uranium.io`]
  },
  uraniumOracle: {
    label: 'Uranium.io guide market price',
    url: 'https://uranium.io/',
    credit: 'Current issuer-published uranium guide market price',
    endpoints: ['https://uranium.io/', 'https://price.uranium.io/en']
  },
  uraniumIssuer: {
    label: 'Uranium.io issuer documentation',
    url: 'https://help.uranium.io/en/articles/10222888-how-is-price-discovery-carried-out',
    credit: 'Reviewed token, price-discovery, storage, and proof-statement semantics',
    endpoints: [
      'https://help.uranium.io/en/articles/10110492-what-is-xu3o8',
      'https://help.uranium.io/en/articles/10222931-how-much-uranium-does-1-xu3o8-represent-and-where-can-i-find-this-information',
      'https://help.uranium.io/en/articles/10222888-how-is-price-discovery-carried-out',
      'https://help.uranium.io/en/articles/10222933-what-does-the-guide-market-price-represent-and-how-does-it-differ-from-the-actual-spot-price',
      'https://help.uranium.io/en/articles/10222870-what-are-the-fees-associated-with-xu3o8-based-trading',
      'https://help.uranium.io/en/articles/10222871-can-i-redeem-physical-uranium',
      'https://help.uranium.io/en/articles/10222876-what-can-i-do-with-the-u3o8-that-i-hold',
      'https://help.uranium.io/en/articles/10711639-where-is-the-physical-uranium-ore-concentrate-u3o8-stored',
      'https://help.uranium.io/en/articles/10222923-what-is-the-contract-address',
      'https://uranium.io/en/proof-of-reserves',
      'https://uranium.io/MiCAR-whitepaper.pdf'
    ]
  },
  proofOfReserves: {
    label: 'Uranium.io proof statement',
    url: PROOF_PDF,
    credit: 'Issuer-linked Cameco contract balance statement; parsed as a dated statement, not described as an audit',
    endpoints: [PROOF_PDF]
  }
});

const SOURCE_ORDER = Object.keys(SOURCE_DEFINITIONS);

function hasFlag(name) {
  return process.argv.includes(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function contentHash(value) {
  const { contentHash: ignored, ...unsigned } = value || {};
  return sha256(JSON.stringify(stableValue(unsigned)));
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  const parsed = number(value);
  if (parsed === null) return null;
  const scale = 10 ** digits;
  return Math.round((parsed + Number.EPSILON) * scale) / scale;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isoDate(value) {
  return iso(value)?.slice(0, 10) || null;
}

function cleanError(error) {
  return String(error?.message || error || 'Unknown source error').replace(/\s+/g, ' ').slice(0, 500);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function request(url, { accept = 'application/json', body = null, headers = {}, method = 'GET' } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    let delay = Math.min(8_000, 500 * (2 ** attempt));
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: {
          Accept: accept,
          'User-Agent': 'tezos.systems Uranium snapshot refresher/1.0',
          ...headers
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`${new URL(url).origin}${new URL(url).pathname} returned HTTP ${response.status}`);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
        delay = Math.min(15_000, retryAfterMilliseconds(response.headers.get('retry-after')) ?? delay);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (/returned HTTP (?!429|5\d\d)/.test(error?.message || '')) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 3) await wait(delay);
  }
  throw new Error(`Request failed after four attempts: ${cleanError(lastError)}`);
}

async function requestJson(url, options) {
  return (await request(url, options)).json();
}

async function requestText(url) {
  return (await request(url, { accept: 'text/html,application/xhtml+xml' })).text();
}

async function requestBuffer(url) {
  return Buffer.from(await (await request(url, { accept: 'application/pdf' })).arrayBuffer());
}

function sourceReceipt(sourceKey, checkedAt, coverage = {}) {
  return {
    ...SOURCE_DEFINITIONS[sourceKey],
    retrievedAt: checkedAt,
    checkedAt,
    status: 'ok',
    error: null,
    coverage
  };
}

function failedReceipt(sourceKey, previous, checkedAt, error) {
  return {
    ...SOURCE_DEFINITIONS[sourceKey],
    retrievedAt: previous?.retrievedAt || null,
    checkedAt,
    status: previous ? 'stale' : 'unavailable',
    error: cleanError(error),
    coverage: previous?.coverage || {}
  };
}

async function attemptPart({ sourceKey, previousData, previousSources, checkedAt, emptyData, build }) {
  try {
    const result = await build();
    return { data: result.data, receipt: sourceReceipt(sourceKey, checkedAt, result.coverage) };
  } catch (error) {
    const priorReceipt = previousSources?.[sourceKey] || null;
    console.warn(`warn - ${sourceKey} failed; ${previousData ? 'preserving last-good data' : 'recording unavailable data'}: ${cleanError(error)}`);
    return {
      data: previousData ?? emptyData(),
      receipt: failedReceipt(sourceKey, priorReceipt, checkedAt, error)
    };
  }
}

function decimalString(rawValue, decimalsValue) {
  const raw = String(rawValue ?? '');
  const decimals = Number(decimalsValue);
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (!decimals) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function addressContext(value) {
  return {
    address: value?.hash || null,
    name: value?.name || null,
    isContract: Boolean(value?.is_contract),
    isVerifiedContract: Boolean(value?.is_verified)
  };
}

function krakenResult(payload) {
  assert(Array.isArray(payload?.error) && payload.error.length === 0, `Kraken error: ${(payload?.error || []).join('; ')}`);
  const value = payload?.result?.XU3O8USD;
  assert(value !== undefined, 'Kraken response is missing XU3O8USD');
  return value;
}

function normalizeKrakenTrade(row) {
  const timestamp = iso(number(row?.[2]) * 1000);
  return {
    tradeId: integer(row?.[6]),
    observedAt: timestamp,
    timestamp,
    priceUsd: number(row?.[0]),
    amount: number(row?.[1]),
    side: row?.[3] === 'b' ? 'buy' : row?.[3] === 's' ? 'sell' : null,
    orderType: row?.[4] === 'm' ? 'market' : row?.[4] === 'l' ? 'limit' : null
  };
}

function depthBand(levels, midpoint, percent) {
  return round(levels.reduce((sum, [price, volume]) => {
    const distance = midpoint ? Math.abs((price / midpoint) - 1) * 100 : Infinity;
    return distance <= percent ? sum + (price * volume) : sum;
  }, 0), 2);
}

async function buildKraken(previous) {
  const [pairRaw, tickerRaw, ohlcRaw, depthRaw, tradesRaw, firstTradesRaw] = await Promise.all([
    requestJson(`${KRAKEN}/AssetPairs?pair=XU3O8USD`),
    requestJson(`${KRAKEN}/Ticker?pair=XU3O8USD`),
    requestJson(`${KRAKEN}/OHLC?pair=XU3O8USD&interval=1440`),
    requestJson(`${KRAKEN}/Depth?pair=XU3O8USD&count=100`),
    requestJson(`${KRAKEN}/Trades?pair=XU3O8USD`),
    requestJson(`${KRAKEN}/Trades?pair=XU3O8USD&since=0`)
  ]);
  const pair = krakenResult(pairRaw);
  const ticker = krakenResult(tickerRaw);
  const ohlc = krakenResult(ohlcRaw);
  const depth = krakenResult(depthRaw);
  const trades = krakenResult(tradesRaw);
  const firstTrades = krakenResult(firstTradesRaw);
  assert(Array.isArray(ohlc) && Array.isArray(depth?.asks) && Array.isArray(depth?.bids) && Array.isArray(trades) && Array.isArray(firstTrades), 'Kraken returned malformed market data');

  const asks = depth.asks.map((row) => [number(row[0]), number(row[1]), iso(number(row[2]) * 1000)]).filter((row) => row[0] !== null && row[1] !== null);
  const bids = depth.bids.map((row) => [number(row[0]), number(row[1]), iso(number(row[2]) * 1000)]).filter((row) => row[0] !== null && row[1] !== null);
  const bestAsk = asks[0]?.[0] ?? null;
  const bestBid = bids[0]?.[0] ?? null;
  const midpoint = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const normalizedTrades = trades.map(normalizeKrakenTrade).filter((row) => row.observedAt && row.priceUsd !== null && row.amount !== null);
  const observedFirst = firstTrades.map(normalizeKrakenTrade).find((row) => row.tradeId === 1) || null;
  const firstTrade = observedFirst || previous?.firstTrade || null;
  const firstTradeAt = firstTrade?.observedAt || previous?.firstTradeAt || null;
  const marketObservedAt = new Date().toISOString();
  const lastUsd = number(ticker.c?.[0]);
  const openUsd = number(ticker.o);
  const volume24hTokens = number(ticker.v?.[1]);
  const vwapUsd24h = number(ticker.p?.[1]);

  return {
    data: {
      pair: {
        symbol: 'XU3O8USD',
        displayName: pair.wsname || 'XU3O8/USD',
        alternateName: pair.altname || null,
        websocketName: pair.wsname || null,
        base: pair.base || null,
        quote: pair.quote || null,
        priceDecimals: integer(pair.pair_decimals),
        lotDecimals: integer(pair.lot_decimals),
        orderMinimum: number(pair.ordermin),
        costMinimumUsd: number(pair.costmin),
        tickSizeUsd: number(pair.tick_size),
        status: pair.status || null,
        executionVenue: pair.execution_venue || null
      },
      ticker: {
        observedAt: marketObservedAt,
        lastUsd,
        lastPriceUsd: lastUsd,
        openUsd,
        highUsd24h: number(ticker.h?.[1]),
        lowUsd24h: number(ticker.l?.[1]),
        vwapUsd24h,
        volume24h: volume24hTokens,
        volume24hTokens,
        volume24hUsd: vwapUsd24h !== null && volume24hTokens !== null ? round(vwapUsd24h * volume24hTokens, 2) : null,
        change24hPct: lastUsd !== null && openUsd ? round(((lastUsd / openUsd) - 1) * 100, 4) : null,
        trades24h: integer(ticker.t?.[1]),
        askUsd: number(ticker.a?.[0]),
        bidUsd: number(ticker.b?.[0])
      },
      orderBook: {
        observedAt: marketObservedAt,
        bestBidUsd: bestBid,
        bestAskUsd: bestAsk,
        midpointUsd: round(midpoint, 6),
        spreadUsd: midpoint === null ? null : round(bestAsk - bestBid, 6),
        spreadPct: midpoint === null ? null : round(((bestAsk - bestBid) / midpoint) * 100, 6),
        depthUsd: {
          bidsWithinHalfPct: depthBand(bids, midpoint, 0.5),
          asksWithinHalfPct: depthBand(asks, midpoint, 0.5),
          bidsWithinOnePct: depthBand(bids, midpoint, 1),
          asksWithinOnePct: depthBand(asks, midpoint, 1),
          bidsWithinTwoPct: depthBand(bids, midpoint, 2),
          asksWithinTwoPct: depthBand(asks, midpoint, 2),
          fetchedBids: round(bids.reduce((sum, row) => sum + row[0] * row[1], 0), 2),
          fetchedAsks: round(asks.reduce((sum, row) => sum + row[0] * row[1], 0), 2)
        },
        bids: bids.slice(0, 25).map(([priceUsd, amount, observedAt]) => ({ priceUsd, amount, observedAt })),
        asks: asks.slice(0, 25).map(([priceUsd, amount, observedAt]) => ({ priceUsd, amount, observedAt }))
      },
      ohlcDaily: ohlc.map((row) => ({
        date: isoDate(number(row[0]) * 1000),
        openUsd: number(row[1]),
        highUsd: number(row[2]),
        lowUsd: number(row[3]),
        closeUsd: number(row[4]),
        vwapUsd: number(row[5]),
        volume: number(row[6]),
        trades: integer(row[7])
      })).filter((row) => row.date),
      ohlc: ohlc.map((row) => ({
        date: isoDate(number(row[0]) * 1000),
        timestamp: iso(number(row[0]) * 1000),
        openUsd: number(row[1]),
        highUsd: number(row[2]),
        lowUsd: number(row[3]),
        closeUsd: number(row[4]),
        vwapUsd: number(row[5]),
        volume: number(row[6]),
        trades: integer(row[7])
      })).filter((row) => row.date),
      recentTrades: normalizedTrades.slice(-50).reverse(),
      firstTradeAt,
      firstTrade,
      publicTapeCursor: String(tradesRaw?.result?.last || ''),
      note: 'The first-trade timestamp is the first trade currently observable on Kraken public market data, independent of the dated listing announcement.'
    },
    coverage: {
      pair: 'XU3O8/USD',
      ohlcIntervalMinutes: 1440,
      orderBookLevelsFetched: { bids: bids.length, asks: asks.length },
      orderBookLevelsRetained: { bids: Math.min(25, bids.length), asks: Math.min(25, asks.length) },
      publicTradesReturned: trades.length,
      firstTapeTradesReturned: firstTrades.length,
      firstPublicTradeIdObserved: observedFirst?.tradeId || null,
      recentTradesRetained: Math.min(50, normalizedTrades.length)
    }
  };
}

function historyRows(chart) {
  const rows = new Map();
  for (const [timestamp, value] of chart?.prices || []) {
    const key = String(timestamp);
    rows.set(key, { timestamp: iso(timestamp), date: isoDate(timestamp), priceUsd: number(value), marketCapUsd: null, volumeUsd: null });
  }
  for (const [timestamp, value] of chart?.market_caps || []) {
    const row = rows.get(String(timestamp));
    if (row) row.marketCapUsd = round(value, 2);
  }
  for (const [timestamp, value] of chart?.total_volumes || []) {
    const row = rows.get(String(timestamp));
    if (row) row.volumeUsd = round(value, 2);
  }
  return [...rows.values()]
    .filter((row) => row.timestamp && row.priceUsd !== null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-365);
}

async function buildCoinGecko() {
  const coinUrl = `${COINGECKO}/coins/uranium?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const historyUrl = `${COINGECKO}/coins/uranium/market_chart?vs_currency=usd&days=365&interval=daily&precision=full`;
  const tickersUrl = `${COINGECKO}/coins/uranium/tickers?include_exchange_logo=false&page=1&order=volume_desc&depth=true&dex_pair_format=symbol`;
  const [coin, chart, tickers] = await Promise.all([requestJson(coinUrl), requestJson(historyUrl), requestJson(tickersUrl)]);
  assert(coin?.id === 'uranium' && coin?.platforms?.etherlink?.toLowerCase() === TOKEN_LOWER, 'CoinGecko Uranium contract does not match the reviewed Etherlink token');
  assert(Array.isArray(chart?.prices) && chart.prices.length, 'CoinGecko returned no Uranium market history');
  assert(Array.isArray(tickers?.tickers), 'CoinGecko returned no ticker collection');
  const market = coin.market_data || {};
  const history = historyRows(chart);
  return {
    data: {
      coin: {
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        contract: coin.platforms.etherlink,
        marketCapRank: integer(coin.market_cap_rank),
        currentPriceUsd: number(market.current_price?.usd),
        marketCapUsd: round(market.market_cap?.usd, 2),
        fullyDilutedValuationUsd: round(market.fully_diluted_valuation?.usd, 2),
        volume24hUsd: round(market.total_volume?.usd, 2),
        high24hUsd: number(market.high_24h?.usd),
        low24hUsd: number(market.low_24h?.usd),
        change24hPct: round(market.price_change_percentage_24h, 4),
        change7dPct: round(market.price_change_percentage_7d, 4),
        change30dPct: round(market.price_change_percentage_30d, 4),
        change1yPct: round(market.price_change_percentage_1y, 4),
        allTimeHighUsd: number(market.ath?.usd),
        allTimeHighAt: iso(market.ath_date?.usd),
        allTimeLowUsd: number(market.atl?.usd),
        allTimeLowAt: iso(market.atl_date?.usd),
        circulatingSupply: number(market.circulating_supply),
        totalSupply: number(market.total_supply),
        maxSupply: number(market.max_supply),
        lastUpdated: iso(coin.last_updated)
      },
      priceHistoryUsd: history,
      venues: tickers.tickers.map((row) => ({
        market: row.market?.name || null,
        identifier: row.market?.identifier || null,
        base: row.base || null,
        target: row.target || null,
        last: number(row.last),
        lastUsd: number(row.converted_last?.usd),
        lastPriceUsd: number(row.converted_last?.usd),
        baseVolume: number(row.volume),
        volumeUsd: round(row.converted_volume?.usd, 2),
        volume24hUsd: round(row.converted_volume?.usd, 2),
        spreadPct: round(row.bid_ask_spread_percentage, 6),
        depthUpUsd: round(row.cost_to_move_up_usd, 2),
        depthDownUsd: round(row.cost_to_move_down_usd, 2),
        observedAt: iso(row.timestamp),
        lastTradedAt: iso(row.last_traded_at),
        isAnomaly: Boolean(row.is_anomaly),
        isStale: Boolean(row.is_stale),
        tradeUrl: /^https:\/\//.test(row.trade_url || '') ? row.trade_url : null
      })).filter((row) => row.identifier && row.lastUsd !== null)
    },
    coverage: {
      historyDaysRequested: 365,
      historyPoints: history.length,
      historyClock: 'CoinGecko daily UTC history; the final point may be the API latest observation rather than a completed UTC day.',
      tickerPage: 1,
      venuesReturned: tickers.tickers.length,
      venueRowsAreSourceAttributed: true,
      venueRowsDoNotImplyEndorsement: true
    }
  };
}

async function buildBlockscoutToken() {
  const base = `${BLOCKSCOUT}/api/v2/tokens/${TOKEN}`;
  const [token, counters, holders, transfers] = await Promise.all([
    requestJson(base),
    requestJson(`${base}/counters`),
    requestJson(`${base}/holders`),
    requestJson(`${base}/transfers`)
  ]);
  assert(token?.address_hash?.toLowerCase() === TOKEN_LOWER, 'Blockscout returned the wrong token');
  const decimals = integer(token.decimals);
  assert(decimals === 18, 'Blockscout xU3O8 decimals are not 18');
  const totalSupply = decimalString(token.total_supply, decimals);
  const supplyNumber = number(totalSupply);
  const topHolders = (holders?.items || []).slice(0, 50).map((row, index) => {
    const balance = decimalString(row.value, decimals);
    return {
      rank: index + 1,
      ...addressContext(row.address),
      balanceRaw: String(row.value || ''),
      balance,
      sharePct: supplyNumber ? round((number(balance) / supplyNumber) * 100, 6) : null
    };
  });
  const recentTransfers = (transfers?.items || []).slice(0, 50).map((row) => ({
    observedAt: iso(row.timestamp),
    timestamp: iso(row.timestamp),
    blockNumber: integer(row.block_number),
    transactionHash: row.transaction_hash || null,
    logIndex: integer(row.log_index),
    method: row.method || null,
    amountRaw: String(row.total?.value || ''),
    amount: decimalString(row.total?.value, row.total?.decimals ?? decimals),
    amountTokens: number(decimalString(row.total?.value, row.total?.decimals ?? decimals)),
    from: addressContext(row.from),
    fromAddress: row.from?.hash || null,
    to: addressContext(row.to),
    toAddress: row.to?.hash || null
  })).filter((row) => row.observedAt && row.transactionHash);
  return {
    data: {
      clock: {
        tokenObservedAt: new Date().toISOString(),
        latestTransferAt: recentTransfers[0]?.observedAt || null
      },
      token: {
        address: token.address_hash,
        name: token.name,
        symbol: token.symbol,
        type: token.type,
        decimals,
        totalSupplyRaw: String(token.total_supply || ''),
        totalSupply,
        holdersCount: integer(token.holders_count),
        exchangeRateUsd: number(token.exchange_rate),
        volume24hUsd: round(token.volume_24h, 2),
        circulatingMarketCapUsd: round(token.circulating_market_cap, 2),
        reputation: token.reputation || null
      },
      counters: {
        holders: integer(counters?.token_holders_count),
        transfers: integer(counters?.transfers_count)
      },
      topHolders,
      recentTransfers
    },
    coverage: {
      topHolderRows: topHolders.length,
      topHoldersComplete: false,
      topHoldersNote: 'First Blockscout holder page only; address labels are context, not ownership proof.',
      recentTransferRows: recentTransfers.length,
      recentTransfersComplete: false,
      recentTransfersNote: 'Latest Blockscout transfer page only; methods and labels are indexed context.'
    }
  };
}

async function buildBlockscoutContracts() {
  const endpoint = `${BLOCKSCOUT}/api/v2/smart-contracts`;
  const [proxy, implementation, app] = await Promise.all([
    requestJson(`${endpoint}/${TOKEN}`),
    requestJson(`${endpoint}/${IMPLEMENTATION}`),
    requestJson(`${endpoint}/${COMPANION_APP}`)
  ]);
  const lineage = proxy?.implementations || [];
  assert(proxy?.is_verified && lineage.some((row) => row.address_hash?.toLowerCase() === IMPLEMENTATION.toLowerCase()), 'Verified xU3O8 implementation lineage is missing');
  assert(implementation?.is_verified && implementation?.name === 'ERC20PoolToken', 'Verified xU3O8 implementation ABI is missing');
  assert(app?.is_verified && app?.name === 'UraniumRefinery', 'Verified UraniumRefinery companion app is missing');
  const functions = new Set((implementation.abi || []).filter((item) => item.type === 'function').map((item) => item.name));
  const appFunctions = [...new Set((app.abi || []).filter((item) => item.type === 'function').map((item) => item.name))].sort();
  return {
    data: {
      clock: { contractsObservedAt: new Date().toISOString() },
      tokenControl: {
        proxyAddress: TOKEN,
        proxyName: proxy.name || null,
        proxyType: proxy.proxy_type || null,
        verified: Boolean(proxy.is_verified),
        implementationAddress: IMPLEMENTATION,
        implementationName: implementation.name || null,
        implementationVerified: Boolean(implementation.is_verified),
        capabilities: {
          pausable: functions.has('pause') && functions.has('unpause') && functions.has('paused'),
          mintable: functions.has('mint'),
          burnable: functions.has('burn'),
          wipeable: functions.has('wipe'),
          kycConfigurable: functions.has('setKYCableStatus') && functions.has('isKYCable'),
          blacklistConfigurable: functions.has('setBlacklistableStatus') && functions.has('isBlacklistable'),
          upgradeable: functions.has('upgradeToAndCall'),
          documentHashRegistry: functions.has('updateDocumentHashes') && functions.has('getDocumentHash'),
          roleBasedAccess: functions.has('grantRole') && functions.has('revokeRole')
        },
        note: 'Capabilities are verified-ABI surface area, not evidence that a privileged action occurred.'
      },
      companionApp: {
        address: COMPANION_APP,
        name: app.name,
        verified: Boolean(app.is_verified),
        functions: appFunctions,
        tokenControl: false,
        note: 'UraniumRefinery is a separate verified companion app and is not presented as the xU3O8 token controller.'
      }
    },
    coverage: { proxyVerified: true, implementationVerified: true, companionAppVerified: true }
  };
}

async function rpcCall(selector) {
  const payload = await requestJson(ETHERLINK_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: selector, method: 'eth_call', params: [{ to: TOKEN, data: selector }, 'latest'] })
  });
  assert(!payload?.error && /^0x[0-9a-f]+$/i.test(payload?.result || ''), `Etherlink RPC eth_call ${selector} failed`);
  return BigInt(payload.result);
}

async function buildRpcState() {
  const [kycable, blacklistable, paused, totalSupply, decimals] = await Promise.all([
    rpcCall('0xe29f5bff'),
    rpcCall('0xb319031c'),
    rpcCall('0x5c975abb'),
    rpcCall('0x18160ddd'),
    rpcCall('0x313ce567')
  ]);
  return {
    data: {
      observedAt: new Date().toISOString(),
      blockTag: 'latest',
      kycable: kycable !== 0n,
      blacklistable: blacklistable !== 0n,
      paused: paused !== 0n,
      decimals: Number(decimals),
      totalSupplyRaw: totalSupply.toString(),
      totalSupply: decimalString(totalSupply.toString(), Number(decimals))
    },
    coverage: { calls: ['isKYCable', 'isBlacklistable', 'paused', 'totalSupply', 'decimals'], blockTag: 'latest' }
  };
}

async function buildDefiLlama() {
  const payload = await requestJson(`${DEFILLAMA}/protocol/uranium.io`);
  assert(payload?.name === 'Uranium.io' && payload?.category === 'RWA', 'DefiLlama returned the wrong Uranium.io protocol');
  const history = (payload.tvl || []).map((row) => ({
    date: isoDate(number(row.date) * 1000),
    timestamp: iso(number(row.date) * 1000),
    tvlUsd: round(row.totalLiquidityUSD, 2)
  })).filter((row) => row.timestamp && row.tvlUsd !== null).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-365);
  assert(history.length, 'DefiLlama returned no Uranium.io TVL history');
  const currentTvlUsd = round(payload.currentChainTvls?.Etherlink ?? history.at(-1).tvlUsd, 2);
  const priorTvlUsd = history.length > 1 ? history.at(-2).tvlUsd : null;
  return {
    data: {
      clock: { observedAt: history.at(-1).timestamp, latestTvlAt: history.at(-1).timestamp },
      id: String(payload.id || ''),
      name: payload.name,
      category: payload.category,
      chain: payload.chain || null,
      chains: payload.chains || [],
      symbol: payload.symbol || null,
      url: /^https:\/\//.test(payload.url || '') ? payload.url : null,
      description: payload.description || null,
      currentTvlUsd,
      change24hPct: priorTvlUsd ? round(((currentTvlUsd / priorTvlUsd) - 1) * 100, 4) : null,
      dailyTvlUsd: history,
      history: history.map((row) => ({ date: row.date, timestamp: row.timestamp, valueUsd: row.tvlUsd, value: row.tvlUsd }))
    },
    coverage: { dailyRowsRetained: history.length, chain: 'Etherlink', methodology: payload.methodology || null }
  };
}

async function buildOracle() {
  const html = await requestText('https://uranium.io/');
  const matches = [...html.matchAll(/\\"price\\":([0-9]+(?:\.[0-9]+)?)/g)].map((match) => number(match[1])).filter((value) => value > 1 && value < 1_000);
  assert(matches.length, 'Uranium.io homepage did not expose a parseable guide price');
  const unique = [...new Set(matches)];
  assert(unique.length === 1, `Uranium.io homepage exposed conflicting guide prices: ${unique.join(', ')}`);
  return {
    data: {
      observedAt: new Date().toISOString(),
      priceUsdPerLbU3O8: unique[0],
      priceUsdPerLb: unique[0],
      unit: 'USD per lb U3O8',
      displayUrl: 'https://price.uranium.io/en',
      semantics: {
        kind: 'issuer-published guide market price',
        statedRefreshCadence: 'approximately one minute',
        statedMethod: 'predictive estimate aggregating and filtering correlated financial instruments',
        formalTokenPeg: false,
        proofOfReserves: false
      },
      note: 'This reference estimate is kept separate from token venue quotes and the dated physical balance statement.'
    },
    coverage: { parsedFrom: 'server-rendered uranium.io homepage payload', valuesObserved: matches.length }
  };
}

function pdfLiteral(value) {
  return value
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\[rn]/g, ' ');
}

function extractPdfText(buffer) {
  const source = buffer.toString('latin1');
  const fragments = [];
  let cursor = 0;
  while ((cursor = source.indexOf('stream', cursor)) >= 0) {
    let start = cursor + 6;
    if (source[start] === '\r' && source[start + 1] === '\n') start += 2;
    else if (source[start] === '\n') start += 1;
    const end = source.indexOf('endstream', start);
    if (end < 0) break;
    const objectStart = source.lastIndexOf('obj', cursor);
    const dictionary = source.slice(Math.max(0, objectStart - 300), cursor);
    let bytes = buffer.subarray(start, end);
    while (bytes.length && (bytes.at(-1) === 10 || bytes.at(-1) === 13)) bytes = bytes.subarray(0, -1);
    if (dictionary.includes('/FlateDecode')) {
      try {
        const inflated = inflateSync(bytes).toString('latin1');
        for (const match of inflated.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) fragments.push(pdfLiteral(match[1]));
      } catch {
        // Font and image streams are allowed to be non-textual.
      }
    }
    cursor = end + 9;
  }
  return fragments.join(' ').replace(/\s+/g, ' ').trim();
}

function pdfDate(raw) {
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:([Zz])|([+-])(\d{2})'?(\d{2})'?)?/.exec(raw || '');
  if (!match) return null;
  const zone = match[7] ? 'Z' : match[8] ? `${match[8]}${match[9]}:${match[10]}` : 'Z';
  return iso(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${zone}`);
}

async function buildProof() {
  const buffer = await requestBuffer(PROOF_PDF);
  assert(buffer.subarray(0, 5).toString() === '%PDF-', 'Proof statement is not a PDF');
  const raw = buffer.toString('latin1');
  const text = extractPdfText(buffer);
  assert(text.includes('CONTRACT BALANCE STATEMENT') && text.includes('Archax Ltd.'), 'Proof PDF is not the expected contract balance statement');
  const statementMatch = /As At ([A-Za-z]+ \d{1,2}, \d{4})/.exec(text);
  const balances = [...text.matchAll(/\b(\d{1,3}(?:,\d{3})+\.\d{3})\b/g)].map((match) => number(match[1].replace(/,/g, ''))).filter((value) => value > 0);
  const endingBalance = balances.at(-1) ?? null;
  assert(statementMatch && endingBalance, 'Proof PDF is missing its statement date or ending balance');
  const statementAsOf = isoDate(`${statementMatch[1]} UTC`);
  const creationRaw = /\/CreationDate\s*\(D:([^)]*)\)/.exec(raw)?.[1] || null;
  const pageCount = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length;
  return {
    data: {
      documentType: 'Cameco contract balance statement',
      characterization: 'dated balance statement, not described here as an audit',
      statementAsOf,
      statementDate: statementAsOf,
      accountHolder: 'Archax Ltd.',
      commodity: 'Triuranium octoxide (U3O8)',
      endingBalanceKgUAsU3O8: endingBalance,
      endingBalanceKgU: endingBalance,
      unit: 'kgU as U3O8',
      agreementDate: /Dated:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(text)?.[1] || null,
      documentCreatedAt: pdfDate(creationRaw ? `D:${creationRaw}` : null),
      retrievedAt: new Date().toISOString(),
      sha256: sha256(buffer),
      bytes: buffer.length,
      pages: pageCount || null,
      url: PROOF_PDF,
      pdfUrl: PROOF_PDF,
      pageUrl: 'https://uranium.io/en/proof-of-reserves',
      note: 'The statement date is the physical-balance clock. Retrieval time only records when this file was checked.'
    },
    coverage: { textExtraction: 'FlateDecode PDF content streams', statementDateParsed: true, endingBalanceParsed: true }
  };
}

function staticReceipt(sourceKey, checkedAt, coverage) {
  const reviewedAt = coverage?.reviewedOn
    ? iso(`${coverage.reviewedOn}T00:00:00.000Z`)
    : null;
  const effectiveCheckedAt = reviewedAt || checkedAt;
  const maxReviewAgeDays = number(coverage?.maxReviewAgeDays);
  const reviewExpired = reviewedAt && maxReviewAgeDays !== null
    ? Date.parse(checkedAt) - Date.parse(reviewedAt) > maxReviewAgeDays * DAY_MS
    : false;
  return {
    ...sourceReceipt(sourceKey, effectiveCheckedAt, coverage),
    retrievedAt: effectiveCheckedAt,
    checkedAt: effectiveCheckedAt,
    reviewedAt,
    status: reviewExpired ? 'stale' : 'ok',
    error: reviewExpired ? `Manual source review is older than ${maxReviewAgeDays} days; re-review required.` : null
  };
}

function emptyKraken() {
  return { pair: null, ticker: null, orderBook: null, ohlcDaily: [], recentTrades: [], firstTradeAt: null, firstTrade: null, publicTapeCursor: null, note: 'Kraken market data unavailable.' };
}

function emptyCoinGecko() {
  return { coin: null, priceHistoryUsd: [], venues: [] };
}

function emptyBlockscoutToken() {
  return { clock: { tokenObservedAt: null, latestTransferAt: null }, token: null, counters: { holders: null, transfers: null }, topHolders: [], recentTransfers: [] };
}

function emptyContracts() {
  return { clock: { contractsObservedAt: null }, tokenControl: null, companionApp: { address: COMPANION_APP, name: null, verified: false, functions: [], tokenControl: false } };
}

function emptyRpc() {
  return { observedAt: null, blockTag: 'latest', kycable: null, blacklistable: null, paused: null, decimals: null, totalSupplyRaw: null, totalSupply: null };
}

function emptyProtocol() {
  return { clock: { observedAt: null, latestTvlAt: null }, id: null, name: 'Uranium.io', category: 'RWA', chain: 'Etherlink', chains: ['Etherlink'], symbol: 'xU3O8', url: 'https://uranium.io/', description: null, currentTvlUsd: null, change24hPct: null, dailyTvlUsd: [], history: [] };
}

function emptyOracle() {
  return { observedAt: null, priceUsdPerLbU3O8: null, priceUsdPerLb: null, unit: 'USD per lb U3O8', displayUrl: 'https://price.uranium.io/en', semantics: { kind: 'issuer-published guide market price', statedRefreshCadence: 'approximately one minute', statedMethod: 'predictive estimate aggregating and filtering correlated financial instruments', formalTokenPeg: false, proofOfReserves: false }, note: 'Guide price unavailable.' };
}

function emptyProof() {
  return { documentType: 'Cameco contract balance statement', characterization: 'dated balance statement, not described here as an audit', statementAsOf: null, statementDate: null, accountHolder: 'Archax Ltd.', commodity: 'Triuranium octoxide (U3O8)', endingBalanceKgUAsU3O8: null, endingBalanceKgU: null, unit: 'kgU as U3O8', agreementDate: null, documentCreatedAt: null, retrievedAt: null, sha256: null, bytes: null, pages: null, url: PROOF_PDF, pdfUrl: PROOF_PDF, pageUrl: 'https://uranium.io/en/proof-of-reserves', note: 'Proof statement unavailable.' };
}

function physicalDerived({ proof, oracle, coin, token }) {
  const kgU = number(proof?.endingBalanceKgUAsU3O8);
  const oracleUsdPerLb = number(oracle?.priceUsdPerLbU3O8);
  const tokenPriceUsd = number(coin?.currentPriceUsd);
  const supply = number(token?.totalSupply ?? coin?.totalSupply);
  const uraniumMassFractionInU3O8 = (3 * 238.02891) / ((3 * 238.02891) + (8 * 15.999));
  const estimatedU3O8Kg = kgU === null ? null : kgU / uraniumMassFractionInU3O8;
  const estimatedU3O8Lb = estimatedU3O8Kg === null ? null : estimatedU3O8Kg * 2.20462262185;
  const estimatedU3O8Oz = estimatedU3O8Lb === null ? null : estimatedU3O8Lb * 16;
  const estimatedOzPerToken = estimatedU3O8Oz !== null && supply ? estimatedU3O8Oz / supply : null;
  const oracleImpliedValuePerTokenUsd = estimatedU3O8Lb !== null && supply && oracleUsdPerLb !== null
    ? (estimatedU3O8Lb / supply) * oracleUsdPerLb
    : null;
  return {
    method: 'Stoichiometric conversion of kgU-as-U3O8 to U3O8 mass using standard atomic weights, then pounds/ounces and per-token ratios.',
    uraniumMassFractionInU3O8: round(uraniumMassFractionInU3O8, 10),
    estimatedU3O8Kg: round(estimatedU3O8Kg, 3),
    estimatedU3O8Lb: round(estimatedU3O8Lb, 3),
    reserveLb: round(estimatedU3O8Lb, 3),
    estimatedU3O8Oz: round(estimatedU3O8Oz, 3),
    tokenSupplyInput: supply,
    tokenSupply: supply,
    estimatedU3O8OzPerToken: round(estimatedOzPerToken, 6),
    ouncesPerToken: round(estimatedOzPerToken, 6),
    oracleImpliedPoolValueUsd: estimatedU3O8Lb !== null && oracleUsdPerLb !== null ? round(estimatedU3O8Lb * oracleUsdPerLb, 2) : null,
    oracleImpliedValuePerTokenUsd: round(oracleImpliedValuePerTokenUsd, 6),
    referenceValueUsd: round(oracleImpliedValuePerTokenUsd, 6),
    tokenPriceUsd,
    tokenPremiumDiscountPct: oracleImpliedValuePerTokenUsd && tokenPriceUsd !== null ? round(((tokenPriceUsd / oracleImpliedValuePerTokenUsd) - 1) * 100, 4) : null,
    marketBasisPct: oracleImpliedValuePerTokenUsd && tokenPriceUsd !== null ? round(((tokenPriceUsd / oracleImpliedValuePerTokenUsd) - 1) * 100, 4) : null,
    inputs: {
      proofStatementAsOf: proof?.statementAsOf || null,
      proofRetrievedAt: proof?.retrievedAt || null,
      oracleObservedAt: oracle?.observedAt || null,
      tokenQuoteObservedAt: coin?.lastUpdated || null
    },
    caveat: 'A cross-source estimate with non-matching clocks. It does not establish a formal peg, current backing, redeemability, exchange inventory, or proof by Kraken.'
  };
}

function issuerSemantics() {
  return {
    ownership: {
      issuerDescription: 'Each xU3O8 records a unit of ownership in physical U3O8 held by Archax for investors; the unit represents an equal proportion of the pooled material.',
      initialPoolLb: 100000,
      initialOuncesPerToken: 1,
      currentSemantics: 'Proportional beneficial co-ownership share; not a permanently fixed one-ounce entitlement.',
      receipts: [
        'https://help.uranium.io/en/articles/10110492-what-is-xu3o8',
        'https://help.uranium.io/en/articles/10222931-how-much-uranium-does-1-xu3o8-represent-and-where-can-i-find-this-information'
      ]
    },
    custody: {
      trusteeAccount: 'Archax Ltd.',
      storageOperator: 'Cameco',
      proofCadenceClaim: 'monthly Cameco statements',
      receipt: 'https://help.uranium.io/en/articles/10711639-where-is-the-physical-uranium-ore-concentrate-u3o8-stored'
    },
    redemption: {
      retailPhysicalDelivery: false,
      condition: 'Physical delivery is limited to regulated persons; an approved regulated warehousing/conversion account may receive a book-entry credit transfer.',
      receipt: 'https://help.uranium.io/en/articles/10222871-can-i-redeem-physical-uranium'
    },
    transfer: {
      issuerRestriction: 'Issuer documentation says xU3O8 may be held at approved venue addresses or wallets whitelisted for the dApp.',
      receipt: 'https://help.uranium.io/en/articles/10222876-what-can-i-do-with-the-u3o8-that-i-hold'
    },
    fees: {
      custodyAndAdministrationMaximumAnnualPct: 1.1,
      venueTransactionFeesVary: true,
      currentlyCharged: null,
      currentStatusNote: 'No safe current-rate receipt was encoded; the published ceiling is not treated as evidence of the amount presently charged.',
      receipt: 'https://help.uranium.io/en/articles/10222870-what-are-the-fees-associated-with-xu3o8-based-trading'
    },
    rights: {
      governanceRights: false,
      votingRights: false,
      equityRights: false,
      profitSharingRights: null,
      receipt: 'https://uranium.io/MiCAR-whitepaper.pdf',
      note: 'The MiCAR whitepaper explicitly excludes governance, voting, and equity rights. No equally explicit reviewed statement about profit-sharing rights was located, so that field fails closed.'
    },
    priceDiscovery: {
      venuePriceDiscovery: true,
      formalPeg: false,
      guidePriceIsSpotPrice: false,
      receipt: 'https://help.uranium.io/en/articles/10222888-how-is-price-discovery-carried-out'
    },
    caveat: 'Issuer descriptions and restrictions are reviewed public claims, not independent legal conclusions. Consult current terms before acting.'
  };
}

function identity() {
  return {
    id: 'xu3o8',
    name: 'Uranium',
    tokenName: 'Uranium',
    symbol: 'xU3O8',
    network: 'Etherlink',
    tokenContract: TOKEN,
    appContract: COMPANION_APP,
    companionAppContract: COMPANION_APP,
    issuer: 'Uranium.io',
    homepage: 'https://uranium.io/',
    explorer: `${BLOCKSCOUT}/token/${TOKEN}`,
    coinGeckoId: 'uranium',
    semantics: {
      token: 'A venue-traded token described by the issuer as a proportional interest in its physical U3O8 pool.',
      guidePrice: 'The issuer guide price is a reference estimate and is not a formal token peg.',
      storage: 'Issuer documentation says the physical material is stored with Cameco and Archax acts as trustee; dated balance statements remain separate evidence.',
      marketBoundary: 'Venue quotes, order books, volume, and trades do not prove physical backing, deposits, exchange inventory, liquidity quality, or redeemability.'
    },
    krakenListing: {
      status: 'announced-live',
      announcedLiveDate: '2026-07-30',
      receiptUrl: SOURCE_DEFINITIONS.krakenListing.url,
      note: 'Manual dated listing receipt. The public-tape first trade is recorded separately and Kraken is not treated as proof of backing.'
    },
    terms: issuerSemantics()
  };
}

function unavailableMethodologies() {
  return [
    {
      id: 'exchange-inventory-and-net-flows',
      label: 'Kraken xU3O8 inventory, deposits, withdrawals, and net flows',
      status: 'unavailable',
      reason: 'Public market-data endpoints expose trading activity, not Kraken custody inventory or complete deposit and withdrawal ledgers.',
      sources: [SOURCE_DEFINITIONS.krakenMarket.url]
    },
    {
      id: 'synchronized-physical-backing',
      label: 'Real-time physical backing ratio',
      status: 'not-calculated',
      reason: 'The physical statement, guide price, chain supply, and venue quote have different clocks. The chamber shows a bounded estimate without presenting it as real-time proof.',
      sources: [PROOF_PDF, 'https://price.uranium.io/en', `${BLOCKSCOUT}/token/${TOKEN}`]
    },
    {
      id: 'wallet-owner-attribution',
      label: 'Beneficial owners behind top token addresses',
      status: 'unavailable',
      reason: 'Explorer names and contract labels are address context, not proof of beneficial ownership.',
      sources: [`${BLOCKSCOUT}/api/v2/tokens/${TOKEN}/holders`]
    }
  ];
}

async function readExisting(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function isAscending(rows, key = 'date') {
  return (rows || []).every((row, index) => index === 0 || String(rows[index - 1]?.[key] || '') <= String(row?.[key] || ''));
}

function validateSnapshot(snapshot, byteLength) {
  const errors = [];
  if (snapshot?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Number.isFinite(Date.parse(snapshot?.generatedAt || ''))) errors.push('generatedAt must be an ISO timestamp');
  if (!/^[0-9a-f]{64}$/.test(snapshot?.contentHash || '')) errors.push('contentHash must be SHA-256');
  if (snapshot?.contentHash && contentHash(snapshot) !== snapshot.contentHash) errors.push('contentHash does not match the stable unsigned payload');
  if (snapshot?.identity?.tokenContract?.toLowerCase() !== TOKEN_LOWER) errors.push('identity token contract is invalid');
  if (snapshot?.identity?.companionAppContract?.toLowerCase() !== COMPANION_APP.toLowerCase()) errors.push('identity companion app is invalid');
  for (const key of SOURCE_ORDER) {
    const source = snapshot?.sources?.[key];
    if (!source) errors.push(`sources.${key} is missing`);
    else {
      if (!['ok', 'stale', 'unavailable'].includes(source.status)) errors.push(`sources.${key}.status is invalid`);
      if (!/^https:\/\//.test(source.url || '')) errors.push(`sources.${key}.url must be HTTPS`);
    }
  }
  if (!Array.isArray(snapshot?.market?.priceHistoryUsd) || !isAscending(snapshot.market.priceHistoryUsd, 'timestamp')) errors.push('market.priceHistoryUsd must be timestamp sorted');
  if (!Array.isArray(snapshot?.market?.venues)) errors.push('market.venues must be an array');
  if (!Array.isArray(snapshot?.market?.kraken?.ohlcDaily) || !isAscending(snapshot.market.kraken.ohlcDaily)) errors.push('market.kraken.ohlcDaily must be date sorted');
  if (snapshot?.market?.kraken?.pair && snapshot.market.kraken.pair.symbol !== 'XU3O8USD') errors.push('Kraken pair must be XU3O8USD');
  if (snapshot?.market?.kraken?.firstTrade && snapshot.market.kraken.firstTrade.tradeId !== 1) errors.push('Kraken firstTrade must be public trade id 1');
  if (snapshot?.chain?.token && (snapshot.chain.token.address?.toLowerCase() !== TOKEN_LOWER || snapshot.chain.token.decimals !== 18)) errors.push('chain token identity is invalid');
  if (snapshot?.chain?.controls?.companionApp?.tokenControl !== false) errors.push('companion app must not be presented as token control');
  if (!Array.isArray(snapshot?.chain?.topHolders) || snapshot.chain.topHolders.some((row, index, rows) => index && number(rows[index - 1].balance) < number(row.balance))) errors.push('top holders must be balance sorted');
  if (!Array.isArray(snapshot?.chain?.recentTransfers) || snapshot.chain.recentTransfers.some((row, index, rows) => index && Date.parse(rows[index - 1].observedAt) < Date.parse(row.observedAt))) errors.push('recent transfers must be newest first');
  if (!Array.isArray(snapshot?.protocol?.dailyTvlUsd) || !isAscending(snapshot.protocol.dailyTvlUsd, 'timestamp')) errors.push('protocol.dailyTvlUsd must be timestamp sorted');
  if (snapshot?.physical?.proof?.sha256 && !/^[0-9a-f]{64}$/.test(snapshot.physical.proof.sha256)) errors.push('proof PDF hash is invalid');
  if (snapshot?.physical?.proof?.statementAsOf && !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.physical.proof.statementAsOf)) errors.push('proof statement date is invalid');
  if (snapshot?.physical?.proof?.characterization && /audit/i.test(snapshot.physical.proof.characterization) && !/not described here as an audit/i.test(snapshot.physical.proof.characterization)) errors.push('proof must not be mislabeled as an audit');
  if (byteLength > MAX_SNAPSHOT_BYTES) errors.push(`snapshot is ${byteLength} bytes; maximum is ${MAX_SNAPSHOT_BYTES}`);
  return errors;
}

function trailingHistory(rows) {
  const normalized = (rows || []).filter((row) => row.date && Number.isFinite(Date.parse(row.timestamp || row.date)) && number(row.priceUsd) !== null);
  if (!normalized.length) return [];
  const cutoff = Date.parse(normalized.at(-1).timestamp || normalized.at(-1).date) - (ENTRY_HISTORY_DAYS * DAY_MS);
  return normalized.filter((row) => Date.parse(row.timestamp || row.date) >= cutoff).map((row) => ({ date: row.date, priceUsd: row.priceUsd }));
}

function venueHighlights(venues) {
  const clean = (venues || []).filter((row) => !row.isAnomaly && !row.isStale);
  const byVolume = [...clean].sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0));
  const kraken = clean.find((row) => row.identifier === 'kraken');
  const result = byVolume.slice(0, 5);
  if (kraken && !result.some((row) => row.identifier === 'kraken')) result.push(kraken);
  return result.map((row) => ({
    market: row.market,
    identifier: row.identifier,
    target: row.target,
    lastUsd: row.lastUsd,
    volumeUsd: row.volumeUsd,
    spreadPct: row.spreadPct,
    depthUpUsd: row.depthUpUsd,
    depthDownUsd: row.depthDownUsd,
    observedAt: row.observedAt,
    tradeUrl: row.tradeUrl
  }));
}

function buildProjection(snapshot, sourceText) {
  const terms = snapshot.identity.terms || {};
  const unsigned = {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    source: {
      path: SNAPSHOT_PATH,
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      contentHash: snapshot.contentHash,
      fileSha256: sha256(sourceText)
    },
    identity: {
      id: snapshot.identity.id,
      name: snapshot.identity.name,
      symbol: snapshot.identity.symbol,
      network: snapshot.identity.network,
      tokenContract: snapshot.identity.tokenContract,
      appContract: snapshot.identity.appContract,
      companionAppContract: snapshot.identity.companionAppContract,
      homepage: snapshot.identity.homepage,
      terms: {
        ownership: {
          kind: terms.ownership?.currentSemantics || null,
          receipt: terms.ownership?.receipts?.at(-1) || null
        },
        fees: {
          maximumAnnualPct: terms.fees?.custodyAndAdministrationMaximumAnnualPct ?? null,
          currentlyCharged: terms.fees?.currentlyCharged ?? null,
          receipt: terms.fees?.receipt || null
        },
        redemption: {
          retailPhysicalDelivery: terms.redemption?.retailPhysicalDelivery ?? null,
          receipt: terms.redemption?.receipt || null
        },
        rights: {
          governance: terms.rights?.governanceRights ?? null,
          voting: terms.rights?.votingRights ?? null,
          equity: terms.rights?.equityRights ?? null,
          profitSharing: terms.rights?.profitSharingRights ?? null,
          receipt: terms.rights?.receipt || null
        }
      }
    },
    market: {
      coin: snapshot.market.coin,
      priceHistoryUsd: trailingHistory(snapshot.market.priceHistoryUsd),
      venueHighlights: venueHighlights(snapshot.market.venues),
      kraken: {
        pair: snapshot.market.kraken.pair,
        ticker: snapshot.market.kraken.ticker,
        orderBook: snapshot.market.kraken.orderBook ? {
          bestBidUsd: snapshot.market.kraken.orderBook.bestBidUsd,
          bestAskUsd: snapshot.market.kraken.orderBook.bestAskUsd,
          midpointUsd: snapshot.market.kraken.orderBook.midpointUsd,
          spreadPct: snapshot.market.kraken.orderBook.spreadPct,
          depthUsd: snapshot.market.kraken.orderBook.depthUsd
        } : null,
        firstTradeAt: snapshot.market.kraken.firstTradeAt
      }
    },
    physical: {
      clock: snapshot.physical.clock,
      oracle: snapshot.physical.oracle,
      proof: snapshot.physical.proof,
      derived: snapshot.physical.derived
    },
    chain: {
      clock: snapshot.chain.clock,
      token: snapshot.chain.token,
      counters: snapshot.chain.counters,
      controls: snapshot.chain.controls
    },
    protocol: {
      clock: snapshot.protocol.clock,
      name: snapshot.protocol.name,
      category: snapshot.protocol.category,
      chain: snapshot.protocol.chain,
      currentTvlUsd: snapshot.protocol.currentTvlUsd
    },
    sourceStatuses: Object.fromEntries(SOURCE_ORDER.map((key) => [key, {
      status: snapshot.sources[key].status,
      retrievedAt: snapshot.sources[key].retrievedAt,
      checkedAt: snapshot.sources[key].checkedAt
    }]))
  };
  return { ...unsigned, contentHash: sha256(JSON.stringify(stableValue(unsigned))) };
}

function validateProjection(projection, bytes) {
  const errors = [];
  if (projection?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^[0-9a-f]{64}$/.test(projection?.contentHash || '')) errors.push('contentHash must be SHA-256');
  const { contentHash: ignored, ...unsigned } = projection || {};
  if (projection?.contentHash && sha256(JSON.stringify(stableValue(unsigned))) !== projection.contentHash) errors.push('contentHash mismatch');
  if (projection?.source?.path !== SNAPSHOT_PATH) errors.push(`source.path must be ${SNAPSHOT_PATH}`);
  if (!/^[0-9a-f]{64}$/.test(projection?.source?.fileSha256 || '')) errors.push('source file hash is invalid');
  if (projection?.identity?.tokenContract?.toLowerCase() !== TOKEN_LOWER) errors.push('token contract is invalid');
  if (!Array.isArray(projection?.market?.priceHistoryUsd)) errors.push('market price history must be an array');
  if (projection?.market?.priceHistoryUsd?.length > 92) errors.push('entry history exceeds its trailing window');
  if (bytes > MAX_ENTRY_BYTES) errors.push(`entry summary is ${bytes} bytes; maximum is ${MAX_ENTRY_BYTES}`);
  return errors;
}

async function writePairAtomic(snapshot, projection) {
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const entryText = `${JSON.stringify(projection, null, 2)}\n`;
  const snapshotTemporary = `${SNAPSHOT_FILE}.tmp-${process.pid}`;
  const entryTemporary = `${ENTRY_FILE}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
  await Promise.all([fs.writeFile(snapshotTemporary, snapshotText), fs.writeFile(entryTemporary, entryText)]);
  await fs.rename(snapshotTemporary, SNAPSHOT_FILE);
  await fs.rename(entryTemporary, ENTRY_FILE);
  return { snapshotText, entryText };
}

async function check() {
  const [snapshotText, entryText] = await Promise.all([fs.readFile(SNAPSHOT_FILE, 'utf8'), fs.readFile(ENTRY_FILE, 'utf8')]);
  const snapshot = JSON.parse(snapshotText);
  const snapshotErrors = validateSnapshot(snapshot, Buffer.byteLength(snapshotText));
  if (snapshotErrors.length) throw new Error(`Invalid Uranium snapshot: ${snapshotErrors.join('; ')}`);
  const expected = buildProjection(snapshot, snapshotText);
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  const entry = JSON.parse(entryText);
  const entryErrors = validateProjection(entry, Buffer.byteLength(entryText));
  if (entryErrors.length) throw new Error(`Invalid Uranium entry summary: ${entryErrors.join('; ')}`);
  assert(entryText === expectedText, `${ENTRY_PATH} is stale; run node scripts/refresh-uranium-data.mjs`);
  console.log(`ok - Uranium snapshot and entry summary valid (${Buffer.byteLength(snapshotText)} + ${Buffer.byteLength(entryText)} bytes, ${snapshot.contentHash.slice(0, 12)})`);
}

async function main() {
  if (hasFlag('--check')) {
    await check();
    return;
  }
  const generatedAt = new Date().toISOString();
  const existing = await readExisting(SNAPSHOT_FILE);
  const previousSources = existing?.sources || {};
  const part = (options) => attemptPart({ ...options, previousSources, checkedAt: generatedAt });
  const [kraken, coinGecko, blockscoutToken, blockscoutContracts, rpcState, protocol, oracle, proof] = await Promise.all([
    part({ sourceKey: 'krakenMarket', previousData: existing?.market?.kraken, emptyData: emptyKraken, build: () => buildKraken(existing?.market?.kraken) }),
    part({ sourceKey: 'coinGecko', previousData: existing?.market ? { coin: existing.market.coin, priceHistoryUsd: existing.market.priceHistoryUsd, venues: existing.market.venues } : null, emptyData: emptyCoinGecko, build: buildCoinGecko }),
    part({ sourceKey: 'blockscoutToken', previousData: existing?.chain ? { clock: existing.chain.clock, token: existing.chain.token, counters: existing.chain.counters, topHolders: existing.chain.topHolders, recentTransfers: existing.chain.recentTransfers } : null, emptyData: emptyBlockscoutToken, build: buildBlockscoutToken }),
    part({ sourceKey: 'blockscoutContracts', previousData: existing?.chain?.controls ? { clock: { contractsObservedAt: existing.chain.clock?.contractsObservedAt }, tokenControl: existing.chain.controls.token, companionApp: existing.chain.controls.companionApp } : null, emptyData: emptyContracts, build: buildBlockscoutContracts }),
    part({ sourceKey: 'etherlinkRpc', previousData: existing?.chain?.controls?.liveState, emptyData: emptyRpc, build: buildRpcState }),
    part({ sourceKey: 'defiLlama', previousData: existing?.protocol, emptyData: emptyProtocol, build: buildDefiLlama }),
    part({ sourceKey: 'uraniumOracle', previousData: existing?.physical?.oracle, emptyData: emptyOracle, build: buildOracle }),
    part({ sourceKey: 'proofOfReserves', previousData: existing?.physical?.proof, emptyData: emptyProof, build: buildProof })
  ]);

  const sources = {
    krakenMarket: kraken.receipt,
    krakenListing: staticReceipt('krakenListing', generatedAt, { receiptKind: 'manual dated announcement', reviewedOn: '2026-07-31', announcedLiveDate: '2026-07-30', marketDataProof: false, backingProof: false }),
    coinGecko: coinGecko.receipt,
    blockscoutToken: blockscoutToken.receipt,
    blockscoutContracts: blockscoutContracts.receipt,
    etherlinkRpc: rpcState.receipt,
    defiLlama: protocol.receipt,
    uraniumOracle: oracle.receipt,
    uraniumIssuer: staticReceipt('uraniumIssuer', generatedAt, {
      receiptKind: 'reviewed issuer semantics',
      reviewedOn: '2026-07-31',
      maxReviewAgeDays: 30,
      topics: ['beneficial co-ownership', 'proportional share', 'custody', 'redemption', 'fees', 'transfer restrictions', 'token rights', 'price discovery'],
      formalPeg: false,
      marketEvidence: false,
      currentFeeRateVerified: false,
      profitSharingRightsVerified: false
    }),
    proofOfReserves: proof.receipt
  };
  const chainClock = {
    observedAt: blockscoutToken.data.clock?.tokenObservedAt || rpcState.data.observedAt || null,
    tokenObservedAt: blockscoutToken.data.clock?.tokenObservedAt || null,
    latestTransferAt: blockscoutToken.data.clock?.latestTransferAt || null,
    contractsObservedAt: blockscoutContracts.data.clock?.contractsObservedAt || null,
    liveStateObservedAt: rpcState.data.observedAt || null
  };
  const derived = physicalDerived({ proof: proof.data, oracle: oracle.data, coin: coinGecko.data.coin, token: blockscoutToken.data.token });
  const unsigned = {
    schemaVersion: 1,
    generatedAt,
    identity: identity(),
    market: {
      clock: {
        coinQuoteObservedAt: coinGecko.data.coin?.lastUpdated || null,
        venueQuotesRetrievedAt: coinGecko.receipt.retrievedAt,
        krakenRetrievedAt: kraken.receipt.retrievedAt,
        krakenFirstPublicTradeAt: kraken.data.firstTradeAt || null,
        krakenListingAnnouncedLiveDate: '2026-07-30'
      },
      coin: coinGecko.data.coin,
      priceHistoryUsd: coinGecko.data.priceHistoryUsd,
      venues: coinGecko.data.venues,
      kraken: kraken.data
    },
    physical: {
      clock: {
        observedAt: oracle.data.observedAt || null,
        oracleObservedAt: oracle.data.observedAt || null,
        proofStatementAsOf: proof.data.statementAsOf || null,
        proofRetrievedAt: proof.data.retrievedAt || null
      },
      oracle: oracle.data,
      proof: {
        ...proof.data,
        endingBalanceLb: derived.reserveLb
      },
      derived
    },
    chain: {
      clock: chainClock,
      token: blockscoutToken.data.token,
      counters: blockscoutToken.data.counters,
      topHolders: blockscoutToken.data.topHolders,
      recentTransfers: blockscoutToken.data.recentTransfers,
      controls: {
        paused: rpcState.data.paused,
        blacklistable: rpcState.data.blacklistable,
        isBlacklistable: rpcState.data.blacklistable,
        kycable: rpcState.data.kycable,
        isKYCable: rpcState.data.kycable,
        upgradeable: blockscoutContracts.data.tokenControl?.capabilities?.upgradeable ?? null,
        token: blockscoutContracts.data.tokenControl,
        companionApp: blockscoutContracts.data.companionApp,
        liveState: rpcState.data
      }
    },
    protocol: protocol.data,
    sources: Object.fromEntries(SOURCE_ORDER.map((key) => [key, sources[key]])),
    unavailable: unavailableMethodologies()
  };
  const snapshot = { ...unsigned, contentHash: sha256(JSON.stringify(stableValue(unsigned))) };
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const snapshotErrors = validateSnapshot(snapshot, Buffer.byteLength(snapshotText));
  if (snapshotErrors.length) throw new Error(`Generated invalid Uranium snapshot: ${snapshotErrors.join('; ')}`);
  const projection = buildProjection(snapshot, snapshotText);
  const projectionText = `${JSON.stringify(projection, null, 2)}\n`;
  const projectionErrors = validateProjection(projection, Buffer.byteLength(projectionText));
  if (projectionErrors.length) throw new Error(`Generated invalid Uranium entry summary: ${projectionErrors.join('; ')}`);
  const written = await writePairAtomic(snapshot, projection);
  console.log(`Wrote ${SNAPSHOT_PATH} (${Buffer.byteLength(written.snapshotText)} bytes, ${snapshot.contentHash.slice(0, 12)})`);
  console.log(`Wrote ${ENTRY_PATH} (${Buffer.byteLength(written.entryText)} bytes, ${projection.contentHash.slice(0, 12)})`);
}

export { historyRows };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
