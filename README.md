# dsh-desktop

macOS 桌面客户端，内嵌 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh web`）。双击 App 即启动，无需手动执行命令、无需安装 Node.js。

## 架构

Electron 主进程监管一个 `dsh web` 子进程（`--host 127.0.0.1 --port 0`，系统分配端口），
从 stdout 解析就绪行 `dsh web: http://127.0.0.1:<port>` 后打开窗口加载 UI。
托盘持有 Host 生命周期：关窗隐藏、托盘恢复、退出时优雅停止（SIGTERM ≤5s）。
打包后的 App 通过 `ELECTRON_RUN_AS_NODE=1` 用 Electron 内置 Node 运行内置的 dsh，
不依赖系统 Node/pnpm。数据与 CLI 共用 `~/.dsh`。

架构设计参考了 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop)（MIT），详见 [docs/开发计划书.md](docs/开发计划书.md)。

## 开发

```sh
pnpm install
pnpm run dev          # 构建 main 进程并以开发模式启动（用系统 node + 仓库内 dsh）
pnpm run test         # vitest 单元测试
pnpm run package      # 暂存自包含 host 运行时并产出未封装 .app（dist/）
pnpm run dist         # 产出安装包（默认 dmg）
pnpm run dist:mac     # 签名 + 公证 DMG（需 Developer ID 与公证凭据，见 scripts/release-mac.mjs）
```

## 说明

- 开发模式使用系统 Node；打包模式使用 Electron 内置 Node（`ELECTRON_RUN_AS_NODE`）。
- 首次启动会从内置模板初始化 `~/.dsh/profiles/web`（已有则直接复用）。
- 未签名 App 首次打开需右键 → 打开（或 `xattr -d com.apple.quarantine`）。

## License

MIT。对 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 的架构设计致谢。
