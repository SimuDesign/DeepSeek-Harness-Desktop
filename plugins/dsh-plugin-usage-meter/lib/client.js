/**
 * dsh-plugin-usage-meter — browser client half.
 *
 * Renders one chip in the right-aligned `conversation.session.header.utilities`
 * slot: estimated session tokens · estimated cost · DeepSeek account balance.
 *
 * - Tokens come from the durable `tokenUsage` projection (whole-log scope —
 *   including pre-compaction history and failed retries), read through the
 *   framework `useProjection` seat.
 * - Cost is an ESTIMATE derived from the host-served price table
 *   (`GET /usage/config`) — never hard-coded here.
 * - Balance is fetched from the host proxy `GET /usage/balance`; the API key
 *   never reaches the browser. Click the chip to refresh.
 *
 * The chip is a <button>, so the desktop shell's header no-drag CSS keeps it
 * clickable inside the draggable header region.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-usage-meter',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    var S = {
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 28, padding: '0 12px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 13, lineHeight: 1, cursor: 'pointer', whiteSpace: 'nowrap',
      },
      strong: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
      sep: { opacity: 0.55, margin: '0 1px' },
    };

    function formatTokens(n) {
      if (!n || n <= 0) return '0';
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
      return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
    }

    function formatMoney(value, currency) {
      var num = Number(value);
      if (!isFinite(num)) return '—';
      var symbol = currency === 'USD' ? '$' : '¥';
      return symbol + num.toFixed(2);
    }

    /** Estimated cost: per-1M prices scaled by the projection buckets. */
    function estimateCost(usage, prices) {
      if (!usage || !prices) return null;
      return ((usage.uncachedInputTokens || 0) * (prices.inputPerM || 0)
        + (usage.cacheReadTokens || 0) * (prices.cacheHitPerM || 0)
        + (usage.outputTokens || 0) * (prices.outputPerM || 0)) / 1e6;
    }

    function UsageChip(props) {
      var useProjection = props.useProjection;
      var usage = typeof useProjection === 'function' ? useProjection('tokenUsage') : undefined;
      var state = React.useState({ prices: null, balance: null, note: null });
      var setState = state[1];
      var prices = state[0].prices;
      var balance = state[0].balance;
      var note = state[0].note;

      var load = React.useCallback(function () {
        var cancelled = false;
        Promise.all([
          fetch('/usage/config').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          fetch('/usage/balance').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        ]).then(function (res) {
          if (cancelled) return;
          var cfg = res[0];
          var bal = res[1];
          var note = null;
          if (!bal || bal.status === 'error') note = (bal && bal.error) ? bal.error : '余额获取失败';
          else if (bal.status === 'not_configured') note = '未配置';
          setState({ prices: cfg, balance: (bal && bal.status === 'ok') ? bal.balance : null, note: note });
        });
        return function () { cancelled = true; };
      }, []);

      React.useEffect(function () { return load(); }, [load]);

      var parts = [];
      var total = usage
        ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.outputTokens || 0)
        : 0;
      if (total > 0) {
        var cost = estimateCost(usage, prices);
        parts.push(React.createElement('span', { key: 't' },
          React.createElement('span', { style: S.strong }, formatTokens(total)),
          React.createElement('span', { style: S.sep }, 'tok')));
        if (cost !== null && cost >= 0.001) {
          parts.push(React.createElement('span', { key: 'c' },
            React.createElement('span', { style: S.sep }, '·≈'),
            React.createElement('span', { style: S.strong }, formatMoney(cost, (prices && prices.currency) || 'CNY'))));
        }
      }
      var balanceText;
      var first = balance && balance.balance_infos && balance.balance_infos[0];
      if (note) balanceText = note;
      else if (first) balanceText = formatMoney(first.total_balance, first.currency);
      else balanceText = '…';
      parts.push(React.createElement('span', { key: 'b' },
        React.createElement('span', { style: S.sep }, '·'),
        React.createElement('span', { style: S.strong }, balanceText)));

      var title = '本会话 token 消耗（整段日志口径，含压缩前历史）与估算费用 · DeepSeek 账户余额（点击刷新）';
      return React.createElement('button', {
        type: 'button', style: S.chip, title: title, onClick: load,
      }, parts);
    }

    exports.name = 'dsh-plugin-usage-meter';
    exports.inject = [];
    exports.apply = function (ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      slots.inject('conversation.session.header.utilities', function () {
        return slots.register(
          { name: 'conversation.session.header.utilities', id: 'usage-meter', order: 90, label: '用量与余额' },
          function (props) { return React.createElement(UsageChip, Object.assign({}, props)); }
        );
      });
    };

    // The loader takes the factory's RETURN value as the plugin exports.
    return exports;
  },
});
