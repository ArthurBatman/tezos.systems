// Instant blackout for HEN mode — prevents dashboard/doorway flash.
const isHenRoute = /^\/hen(?:\/|\/index\.html)?$/.test(window.location.pathname);
if (isHenRoute || new URLSearchParams(window.location.search).has('hen')) {
    document.documentElement.style.background = '#111';
    const style = document.createElement('style');
    style.id = 'hen-initial-blackout';
    style.textContent = 'body>*:not(.hen-overlay){display:none!important}body{background:#111!important}';
    (document.head || document.documentElement).appendChild(style);
    window.__henBlackoutClaimed = false;
    window.__henBlackoutFailOpenTimer = window.setTimeout(() => {
        if (window.__henBlackoutClaimed) return;
        document.getElementById('hen-initial-blackout')?.remove();
        document.documentElement.style.background = '';
    }, 2500);
}
