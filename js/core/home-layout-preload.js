/* Apply saved Home visibility before the dashboard shell is parsed. */
(function () {
    var STORAGE_KEY = 'tezos-systems-home-layout-v1';
    var IDS = ['ticker', 'search', 'live-pulse', 'explore', 'moments', 'handoff'];
    var LEGACY = [
        ['tezos-systems-chambers-visible', 'explore', 'false'],
        ['tezos-systems-collapsed-hot-today-island', 'live-pulse', '1'],
        ['tezos-systems-collapsed-chambers-section', 'explore', '1'],
        ['tezos-systems-collapsed-moments-section', 'moments', '1']
    ];
    var hidden = [];

    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
            var saved = JSON.parse(raw);
            var valid = saved
                && saved.version === 1
                && Array.isArray(saved.hidden)
                && saved.hidden.every(function (id) { return IDS.indexOf(id) !== -1; });
            if (valid) hidden = IDS.filter(function (id) { return saved.hidden.indexOf(id) !== -1; });
        } else {
            LEGACY.forEach(function (entry) {
                if (localStorage.getItem(entry[0]) === entry[2] && hidden.indexOf(entry[1]) === -1) {
                    hidden.push(entry[1]);
                }
            });
            if (LEGACY.some(function (entry) { return localStorage.getItem(entry[0]) !== null; })) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, hidden: hidden }));
            }
        }
        LEGACY.forEach(function (entry) { localStorage.removeItem(entry[0]); });
    } catch (_) {
        hidden = [];
    }

    document.documentElement.setAttribute('data-home-hidden', hidden.join(' '));
}());
