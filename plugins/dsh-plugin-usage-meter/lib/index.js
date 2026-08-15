/**
 * dsh-plugin-usage-meter — host half.
 *
 * Serves two same-origin routes for the browser client:
 *
 *   GET /usage/config  → configurable price table + currency used for the
 *                        client-side cost estimate (never hard-coded in UI).
 *   GET /usage/balance → proxied DeepSeek `GET /user/balance`, with the API
 *                        key resolved through the DSH credentials seam
 *                        (`ctx.credentials.resolve(keyRef)`), falling back to
 *                        the process environment. The key never leaves the
 *                        host and is never logged; balance figures are
 *                        returned to the browser but never written to logs.
 *
 * The webServer service may not be mounted yet when this row activates (boot
 * ordering), so route registration retries until it appears — the same
 * pattern as dsh-plugin-vision.
 */
const DEFAULT_CONFIG = {
  currency: 'CNY',
  // DeepSeek platform list prices per 1M tokens (deepseek-chat split, prompt
  // cached vs uncached), as of this writing. Deployments override via the
  // plugin config in their profile cordis.patch.yml.
  inputPerM: 2,
  cacheHitPerM: 0.5,
  outputPerM: 8,
  keyRef: 'DEEPSEEK_API_KEY',
};

const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
const REQUEST_TIMEOUT_MS = 10000;

function resolveConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      const v = raw[key];
      if (v !== undefined && v !== null && v !== '') cfg[key] = v;
    }
  }
  return cfg;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export default {
  inject: ['timer'],
  config: {},
  apply(ctx, config) {
    const cfg = resolveConfig(config);

    async function fetchBalance() {
      const credentials = ctx.get('credentials');
      let key;
      if (credentials !== undefined) {
        try {
          const r = await credentials.resolve(cfg.keyRef);
          if (r && r.value) key = r.value;
        } catch { /* fall through to env */ }
      }
      if (!key && process.env && process.env[cfg.keyRef]) key = process.env[cfg.keyRef];
      if (!key) return { status: 'not_configured' };
      let res;
      try {
        res = await fetch(BALANCE_ENDPOINT, {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        return { status: 'error', error: '网络请求失败: ' + (e && e.message ? e.message : String(e)) };
      }
      if (!res.ok) {
        return { status: 'error', error: 'DeepSeek 余额接口 HTTP ' + res.status };
      }
      try {
        const data = await res.json();
        return { status: 'ok', balance: data };
      } catch {
        return { status: 'error', error: 'DeepSeek 余额接口响应无法解析' };
      }
    }

    function registerRoutes() {
      const ws = ctx.get('webServer');
      if (ws === undefined) return false;
      ctx.effect(() => ws.register({
        kind: 'exact',
        path: '/usage/config',
        handler(req, res) {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET');
            res.end();
            return;
          }
          sendJson(res, 200, {
            currency: cfg.currency,
            inputPerM: cfg.inputPerM,
            cacheHitPerM: cfg.cacheHitPerM,
            outputPerM: cfg.outputPerM,
            note: 'estimated session cost from the whole-log tokenUsage projection',
          });
        },
      }), 'dsh-plugin-usage-meter: /usage/config');
      ctx.effect(() => ws.register({
        kind: 'exact',
        path: '/usage/balance',
        async handler(req, res) {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET');
            res.end();
            return;
          }
          try {
            sendJson(res, 200, await fetchBalance());
          } catch (e) {
            sendJson(res, 200, { status: 'error', error: (e && e.message) ? e.message : String(e) });
          }
        },
      }), 'dsh-plugin-usage-meter: /usage/balance');
      return true;
    }

    if (!registerRoutes()) {
      let disposed = false;
      ctx.effect(() => () => { disposed = true; });
      let tries = 0;
      const tick = () => {
        if (disposed) return;
        if (registerRoutes()) return;
        tries += 1;
        if (tries < 40) ctx.timeout(tick, 500); // up to ~20s of boot time
      };
      ctx.timeout(tick, 500);
    }
  },
};
