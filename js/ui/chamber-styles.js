const stylesheetPromises = new Map();

/** Load one same-origin Chamber stylesheet and resolve only after it is ready. */
export function ensureChamberStylesheet(id, href) {
    const existing = document.getElementById(id);
    if (existing?.sheet) return Promise.resolve(existing);
    if (stylesheetPromises.has(id)) return stylesheetPromises.get(id);

    const link = existing || document.createElement('link');
    if (!existing) {
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
    }

    const ready = new Promise((resolve, reject) => {
        link.addEventListener('load', () => resolve(link), { once: true });
        link.addEventListener('error', () => {
            stylesheetPromises.delete(id);
            link.remove();
            reject(new Error(`Chamber stylesheet unavailable: ${href}`));
        }, { once: true });
    });
    stylesheetPromises.set(id, ready);
    if (!existing) document.head.appendChild(link);
    return ready;
}
