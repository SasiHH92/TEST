'use strict';
// A Kamu Bíróság backend (web) kliense. A bot SEMMIT nem tárol: az állapot a backendben él, a bot csak
// megjeleníti, és a Discord-os kattintásokat továbbítja. Hitelesítés: szolgáltatás-token (BOT_SERVICE_TOKEN),
// ami csak a /api/bot végpontokra jó – a bot nem kap általános admin-hozzáférést.

class BackendError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createBackend({ baseUrl, token, fetchImpl = fetch, log = console }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const enabled = !!(root && token);

  async function request(method, route, body, { timeoutMs = 15000 } = {}) {
    let res;
    try {
      res = await fetchImpl(root + '/api/bot' + route, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      throw new BackendError(0, 'unreachable', 'A Kamu Bíróság szerver nem érhető el (' + (e.message || e) + ').');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(res.status, data.code || 'error', data.error || 'Hiba (' + res.status + ').');
    return data;
  }

  const api = {
    enabled,
    listSessions: async () => (await request('GET', '/sessions')).sessions,
    getSession: async (id) => (await request('GET', '/sessions/' + encodeURIComponent(id))).session,
    setPanel: (id, ref) => request('POST', '/sessions/' + encodeURIComponent(id) + '/panel', ref),
    announce: async (id, key) => (await request('POST', '/sessions/' + encodeURIComponent(id) + '/announce', { key })).first,
    setAppliedRoles: (id, assignments) => request('POST', '/sessions/' + encodeURIComponent(id) + '/applied-roles', { assignments }),
    act: (id, action, payload) => request('POST', '/sessions/' + encodeURIComponent(id) + '/' + action, payload),
    link: (payload) => request('POST', '/link', payload),

    // Eseményfolyam (SSE). Az esemény csak "kopogtat": a bot a friss állapotot kérdezi le, ezért az elveszett
    // esemény nem okoz eltérést (újracsatlakozáskor és időnként teljes egyeztetés is fut).
    subscribe(onEvent, { onOpen = () => {}, onClose = () => {} } = {}) {
      let stopped = false, controller = null, delay = 1000;
      (async function loop() {
        while (!stopped) {
          controller = new AbortController();
          try {
            const res = await fetchImpl(root + '/api/bot/stream', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            delay = 1000;
            onOpen();
            const decoder = new TextDecoder();
            let buf = '';
            for await (const chunk of res.body) {
              buf += decoder.decode(chunk, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const block = buf.slice(0, i); buf = buf.slice(i + 2);
                const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
                if (!data) continue;
                try { onEvent(JSON.parse(data)); } catch (e) { log.error('[bot] esemény feldolgozási hiba:', e.message); }
              }
            }
          } catch (e) {
            if (stopped) break;
            log.error('[bot] az eseményfolyam megszakadt:', e.message);
          }
          if (stopped) break;
          onClose();
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30000);
        }
      })();
      return () => { stopped = true; if (controller) controller.abort(); };
    }
  };
  return api;
}

module.exports = { createBackend, BackendError };
