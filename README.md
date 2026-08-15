# dsh-desktop

macOS 桌面客户端，内嵌 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh web`）。双击 App 即启动，直接使用 Harness Web UI，无需手动执行命令、无需安装 Node.js/pnpm。

## 快速使用

从 `dist/` 获取安装包（或自行构建，见下）。未签名版本首次打开：

- 右键 `DeepSeek Harness.app` → **打开**（Gatekeeper 绕过提示），或
- 终端执行 `xattr -d com.apple.quarantine "/path/to/DeepSeek Harness.app"`

启动后：

- 托盘图标持有应用生命周期；**关闭窗口 = 隐藏到托盘**（Host 继续运行）
- 托盘菜单：**打开主窗口** / **退出**（退出会优雅停止本地服务，≤5s）
- 数据与 CLI 网页版**共用 `~/.dsh`**：现有会话、设置、插件互通
- 诊断日志：`~/Library/Logs/dsh-desktop/host.log`（开发模式在 `.logs/`）

## 架构

Electron 主进程监管一个 `dsh web` 子进程（`--host 127.0.0.1 --port 0`，系统分配端口），
解析 stdout 就绪行 `dsh web: http://127.0.0.1:<port>` 后打开窗口加载 UI。
打包后的 App 通过 `ELECTRON_RUN_AS_NODE=1` 用 Electron 内置 Node 运行内置的 dsh
（`Resources/host/`，由 `stage-runtime` 打包的完整依赖闭包），不依赖系统 Node/pnpm；
运行期也绝不回落到 PATH 中的 dsh，杜绝版本漂移。`@deepseek-ai/dsh` 版本精确锁定
（`runtime/package.json`），升级 = 显式 bump + 重新打包。

安全：窗口 `sandbox: true` + 拒绝全部权限请求 + 导航锁定宿主 origin + 外链走系统浏览器；
单实例锁；端口由系统分配天然无冲突。

架构参考 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)（MIT），
详见 [NOTICE](NOTICE) 与 [docs/开发计划书.md](docs/开发计划书.md)。

## 开发

```sh
pnpm install
pnpm run dev          # 构建 main 进程并开发模式启动（系统 node + 仓库内 dsh）
pnpm run test         # vitest 单元测试
pnpm run typecheck    # tsc 类型检查
pnpm run build        # 编译 src/ → lib/
```

开发模式用系统 Node 跑仓库内 `node_modules/@deepseek-ai/dsh`；可用
`DSH_DESKTOP_NODE_EXECUTABLE` 指定其他 Node。用 `DSH_HOME=<隔离目录>` 避免污染真实
`~/.dsh`（冒烟/CI 建议隔离）。

冒烟测试（不依赖 GUI，验证 supervisor + 真实 host 子进程全链路）：

```sh
node scripts/smoke-host.mjs "node" "$PWD/node_modules/@deepseek-ai/dsh/lib/bin.js"
# 打包运行环境（Electron 内置 Node）：
node scripts/smoke-host.mjs "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$PWD/runtime-host/node_modules/@deepseek-ai/dsh/lib/bin.js" "1"
```

## 打包

```sh
pnpm run package      # build + stage-runtime + electron-builder --dir（未封装 .app）
pnpm run dist         # build + stage-runtime + 未签名 DMG（arm64 + x64）
```

`stage-runtime` 用 `node-linker=hoisted` 安装 `@deepseek-ai/dsh` 闭包并把 pnpm 符号链接
物化为真实文件；`afterPack` 校验 CLI 入口、Web 前端与无符号链接，缺失即拒发产物。
图标由 `scripts/generate-icons.mjs` 生成（已提交，可按需重生成）。

## 签名与公证（发布用）

需要 Apple Developer 账号与 `Developer ID Application` 证书。凭据（三选一）：

```sh
# 1) Keychain profile（推荐）
xcrun notarytool store-credentials "dsh-notary" --apple-id "<Apple ID>" --team-id "<Team ID>"
APPLE_KEYCHAIN_PROFILE=dsh-notary pnpm run dist:mac
# 2) Apple ID 组
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... pnpm run dist:mac
# 3) App Store Connect API Key 组
APPLE_API_KEY=... APPLE_API_KEY_ID=... APPLE_API_ISSUER=... pnpm run dist:mac
```

脚本会预检身份与凭据、构建签名+公证 DMG，并验证
`codesign --verify --deep --strict`、`spctl --assess`、`xcrun stapler validate`。

## 验收清单（Task 8）

- [ ] 双击 `.app` ≤10s 内出现 Harness UI（首次启动含 profile 初始化）
- [ ] 与 `dsh web` 网页版共用 `~/.dsh`，会话互通
- [ ] 关窗隐藏到托盘、托盘恢复、退出优雅停止（≤5s）
- [ ] 不依赖系统 Node/pnpm/dsh（用 Electron 内置 Node）
- [ ] 单实例：重复打开聚焦已有窗口
- [ ] Host 崩溃显示错误对话框（含日志尾部）
- [ ] 未签名 DMG 可运行；签名+公证脚本可用
- [ ] `pnpm typecheck && pnpm test` 全绿

## License

MIT。第三方包保留各自许可证；对 anywhere-labs/deepseek-harness-desktop 等架构致谢见 [NOTICE](NOTICE)。
