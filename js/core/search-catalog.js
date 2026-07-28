import { loadDataAsset } from './data-assets.js';
import { siteMapSearchScore } from './site-map.js';

let catalogRows = [];
let catalogPromise = null;
let catalogLoaded = false;

export function isSearchCatalogLoaded() {
    return catalogLoaded;
}

export function loadSearchCatalog() {
    if (catalogLoaded) return Promise.resolve(catalogRows);
    if (!catalogPromise) {
        catalogPromise = loadDataAsset('searchCatalog')
            .then((data) => {
                catalogRows = Array.isArray(data?.rows) ? data.rows : [];
                catalogLoaded = true;
                return catalogRows;
            })
            .catch(() => {
                catalogRows = [];
                catalogLoaded = true;
                return catalogRows;
            });
    }
    return catalogPromise;
}

export function searchFirstPartyCatalog(query, { limit = 12 } = {}) {
    const raw = String(query || '').trim();
    if (!raw || !catalogLoaded) return [];
    return catalogRows
        .map((row, index) => ({ row, index, score: siteMapSearchScore(row, raw) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, limit)
        .map(({ row, score }) => ({ ...row, searchScore: score }));
}
