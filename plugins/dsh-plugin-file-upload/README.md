# dsh-plugin-file-upload

DeepSeek Harness 插件：在 composer 工具行（`conversation.input.left` 插槽）加一个**回形针按钮**，
点击弹出系统文件选择器，按文件类型分流：

- **图片**（PNG/JPEG/WebP/GIF，以 host `imageLimits` 投影的 `mediaTypes` 为准）→ 走既有附件管线
  （`createDraftImages` + `addImages`），进入草稿图片 rail，可预览、随消息作为 vision 块发送。
- **其他文件**（文本/代码等）→ `FileReader` 读取内容，以带语言标注的 fenced code block 追加进草稿；
  读取后检测二进制特征（NUL 字节、控制符/替换符簇）——若是二进制（PDF/Excel 等），改为通过桌面壳
  preload（`dshDesktop.getPathForFile`）把**真实路径**插入草稿，让模型用 fs/工具自行读取；拿不到
  路径才拒绝。单个文件 >16MB 不读（防 UI 卡死）；草稿超过 100 万字符时截断到上限并提示。

## 结构

| 部分 | 文件 | 职责 |
|---|---|---|
| host half | `lib/index.js` | 无操作桩（让 `- insert` 解析到合法 cordis service） |
| client half | `lib/client.js` | `conversation.input.left` 槽注入回形针按钮；会话作用域经 `inject: (sessionId) => actx.get('conversation')` 解析（同 QueueDock 范式） |
| bundle patch | `cordis.patch.yml` | `- insert: dsh-plugin-file-upload` |

纯浏览器侧实现，不需要 host 路由，API key 与文件系统不出本机。

## 安装（web profile）

```bash
# 1. 包体放入 profile 的 node_modules（手动放置，免网络）
cp -R plugins/dsh-plugin-file-upload \
  ~/.dsh/profiles/web/node_modules/dsh-plugin-file-upload

# 2. profile package.json：dependencies 加本地引用，dsh.profile.bundles 数组加入本包
# 3. 重启桌面 App（或 dsh web）使插件生效
```

## 限制

- 图片上限沿用 host 的 `imageLimits` 投影（数量/单张/总量），超限整批拒绝并提示；
  草稿已有图片的字节数无法在浏览器侧精确累计，发送时 host 仍会二次校验。
- 非图片文件一律按文本读取，读取后做二进制检测（NUL 字节、控制符/替换符比例）；二进制文件在桌面版
  会插入真实路径（preload 提供），非 Electron 环境才拒绝；16MB 单文件上限只是防 UI 卡死的保护；
  文本内容本身不设大小限制，仅受草稿 100 万字符上限约束。
- 若宿主未挂载 `dsh-attachment` 附件服务，图片入口会提示「附件服务不可用」，文本插入不受影响。
