# dsh-plugin-usage-meter

DeepSeek Harness 插件：在会话 header 右上角（`conversation.session.header.utilities` 插槽）显示
**本会话 token 消耗 · 估算费用 · DeepSeek API 账户余额**，一个可点击刷新的 chip。

## 结构（host + client，照 `dsh-plugin-vision` 范式）

| 部分 | 文件 | 职责 |
|---|---|---|
| host half | `lib/index.js` | `cordis.patch.yml` 注册 service；`GET /usage/config`（价格表）、`GET /usage/balance`（余额代理） |
| client half | `lib/client.js` | utilities 插槽 chip：`useProjection('tokenUsage')` 读 token、价格表算费用、fetch 余额 |
| bundle patch | `cordis.patch.yml` | `- insert: dsh-plugin-usage-meter` |

## 数据口径（如实标注，非精确计费单）

- **token**：`@deepseek-ai/dsh-token-meter` 的 `tokenUsage` 投影（`uncachedInputTokens` /
  `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`），是**整段会话日志**的累计口径
  （含被压缩前的历史、失败重试的输入），与 Trajectory/轨迹 页同源。
- **费用**：估算值，`uncached×P_in + cacheRead×P_cacheHit + output×P_out`，价格表来自
  host 路由 `/usage/config`（插件 config 可配，默认与 harness 实际模型对齐——DeepSeek-V4-Flash
  低峰价：输入未命中 $0.22/M、缓存命中 $0.007/M、输出 $0.66/M；切换 V4-Pro 请在配置改
  0.66/0.022/1.98）；高峰时段（01:00–04:00 与 06:00–10:00 UTC）按 ×2 计入，由客户端本地 UTC
  时钟判定当前时段，不在 UI 代码里硬编码。仍是「当前时段」估算：`tokenUsage` 投影为整段日志
  累计、无逐请求时间戳，无法按请求精确分摊高峰/低峰。
- **余额**：host 侧代理 `GET https://api.deepseek.com/user/balance`，key 经
  `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 解析（`~/.dsh/.credentials.yaml`），
  **绝不下发到浏览器**；无 key 时 chip 显示「未配置」。

## 安装（web profile）

```bash
# 1. 包体放入 profile 的 node_modules（手动放置，免网络）
cp -R plugins/dsh-plugin-usage-meter \
  ~/.dsh/profiles/web/node_modules/dsh-plugin-usage-meter

# 2. profile package.json：dependencies 加本地引用，dsh.profile.bundles 数组加入本包
# 3. 重启桌面 App（或 dsh web）使插件生效
```

## 配置

在 profile 的 `cordis.patch.yml` 给 insert 加 `config`（见该文件头部注释），或直接改
`plugins/dsh-plugin-usage-meter/cordis.patch.yml` 的默认值。改后需重启。
