const UA = 'river-level-mcp/1.0 (+https://github.com/theluckystrike/river-level-mcp)';
const cache = new Map();
const MAX_ENTRIES = 200;
export async function fetchOnce(url, opts, init = {}) {
    const ac = new AbortController();
    const ms = opts.timeoutMs ?? 15000;
    const timer = setTimeout(() => ac.abort(), ms);
    try {
        const res = await fetch(url, {
            ...init,
            redirect: 'follow',
            signal: ac.signal,
            headers: { 'User-Agent': UA, Accept: opts.accept ?? 'application/json,text/plain,*/*' },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        if (/^\s*<!DOCTYPE html/i.test(body) && !/html/.test(opts.accept ?? ''))
            throw new Error('upstream returned an HTML error page');
        return body;
    }
    catch (e) {
        if (e.name === 'AbortError')
            throw new Error(`no answer within ${Math.round(ms / 1000)} s`);
        throw e;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function fetchWithRetry(url, opts, init = {}) {
    try {
        return await fetchOnce(url, opts, init);
    }
    catch (e) {
        const msg = e.message;
        if (/HTTP 4\d\d/.test(msg))
            throw e; // a 4xx will not fix itself; do not hammer the upstream
        await new Promise((r) => setTimeout(r, 800));
        return fetchOnce(url, opts, init);
    }
}
export const fetchTextNode = async (url, opts = {}) => {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < hit.ttl * 1000)
        return hit.body;
    const body = await fetchWithRetry(url, opts);
    if (cache.size >= MAX_ENTRIES)
        cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), ttl: opts.cacheTtl ?? 900, body });
    return body;
};
