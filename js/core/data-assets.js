/**
 * Session-level loader for immutable first-party JSON assets. Feature modules
 * share one promise so opening several Chambers does not refetch the same lore.
 */

export const DATA_ASSET_URLS = Object.freeze({
    protocolData: '/data/protocol-data.json?v=2',
    governanceVotes: '/data/governance-votes.json',
    governanceReport: '/data/governance-refresh-report.json?v=1',
    releaseRadar: '/data/release-radar.json',
    searchCatalog: '/data/search-catalog.json?v=1'
});

const assetPromises = new Map();

export function loadDataAsset(name, { force = false } = {}) {
    const url = DATA_ASSET_URLS[name];
    if (!url) return Promise.reject(new Error(`Unknown data asset: ${name}`));
    if (force) assetPromises.delete(name);
    if (assetPromises.has(name)) return assetPromises.get(name);

    const request = fetch(url, { cache: 'no-store' })
        .then((response) => {
            if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
            return response.json();
        })
        .catch((error) => {
            assetPromises.delete(name);
            throw error;
        });
    assetPromises.set(name, request);
    return request;
}
