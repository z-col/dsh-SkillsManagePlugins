<div align="center">

# 🧩 dsh-skills-manager

**DSH (DeepSeek Harness) Skills 可视化管理器**

在 DSH Web 界面中可视化地查看、编辑、创建和管理你的 Skill —— 无需再打开终端手敲 `SKILL.md`。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-purple.svg)](https://github.com/deepseek-ai/deepseek-harness)

</div>

---

## 这是什么？

DeepSeek Harness (DSH) 的 Skill 是放在目录里的 Markdown 指令文件（`SKILL.md` + 可选 frontmatter），DSH 的 AI 代理会按需加载它们来获得任务专用能力。但随着 Skill 越来越多，**管理它们本身成了一个问题**：

- 散落在不同目录，没有统一视图
- 编辑要手写 YAML frontmatter，格式错了 DSH 就不认
- 改名只改文件夹、忘了同步 frontmatter 的 `name`，Skill 悄悄失效

`dsh-skills-manager` 把这一切搬进 **DSH Web 界面**：以 dsh-better-sidebar 的侧边栏 tab 形式，提供完整的可视化 CRUD。

## ✨ 功能特性

| 能力 | 说明 |
|---|---|
| 👁️ 可视化浏览 | 列出全部 Skill（名称 + 描述 + 形态），点开查看完整 `SKILL.md` |
| 📝 在线编辑 | 直接编辑 frontmatter 与正文，原子写入磁盘，不会写坏文件 |
| ➕ 一键新建 | 表单填写名称/描述/何时使用/正文，自动生成标准 Skill 目录结构 |
| 🗑️ 安全删除 | 删除前二次确认，防止误删 |
| ✏️ 智能重命名 | 改名后**自动同步 frontmatter 的 `name` 字段**（DSH 以 frontmatter name 为准，只改文件夹名会让 Skill 失效） |
| 🗂️ 双层级管理 | 用户级 `~/.dsh/skills/` 与项目级 `<项目根>/.dsh/skills/` 一键切换 |
| 🌍 中英文界面 | 跟随 DSH 的 locale 系统自动切换 |

## 📸 截图

<!-- 在此处添加截图，例如：
![Skills 管理面板](./docs/screenshot.png)
-->

*（截图待补充 —— 欢迎贡献！）*

## 🚀 安装

> 前置依赖：DSH Web（`@deepseek-ai/dsh` ≥ 0.1.0-rc.6）以及 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（提供侧边栏容器）。

```sh
# 从 npm 安装
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add dsh-skills-manager

# 或从本仓库本地安装（开发）
npx -p @deepseek-ai/dsh dsh plugin --profile web add /path/to/SkillsManagePlugins
```

安装后**重启目标 profile**（host 代码与 client bundle 变化需要重启），然后刷新浏览器页面。

## 🎮 使用方法

1. 打开 DSH Web 的**侧边栏**
2. 点击侧边栏顶部的 **+ 菜单**
3. 选择 **「Skills 管理器」** tab
4. 面板顶部可在 **用户级 / 项目级** 之间切换

| 操作 | 怎么做 |
|---|---|
| 查看 Skill | 点击列表中的卡片，进入详情页查看完整 `SKILL.md` |
| 编辑 Skill | 详情页底部编辑框修改内容 → 点「保存」 |
| 新建 Skill | 列表页右上角「+ 新建 Skill」→ 填写表单 → 确认 |
| 重命名 Skill | 详情页右上角「重命名」→ 输入新名称 → 确认 |
| 删除 Skill | 详情页右上角「删除」→ 确认弹窗 |

> 💡 所有修改都实时落盘，DSH 的 skill 监听器会自动刷新目录，**无需重启**即可生效。

## 🔍 工作原理

```
┌─ Host 半（lib/index.js）───────────────────────────────┐
│  /skills/api/*  JSON API（webServer prefix 路由）       │
│  · 浏览器信任围栏：Host-header 回环或 trustedHosts      │
│  · 会话作用域：sessionId → 会话 header.cwd → 项目根     │
│  · 全部文件操作限定在用户/项目 skill 根内（路径围栏）     │
│  方法：roots.info / skills.list / skills.get /          │
│        skills.create（no-clobber）/ skills.update（原子）│
│        skills.delete / skills.rename（同步 frontmatter）│
└─────────────────────────────────────────────────────────┘
┌─ Client 半（lib/client.js）────────────────────────────┐
│  · ctx.inject(['betterSidebar']) → Skills 侧边栏 tab     │
│    （唯一入口：dsh-better-sidebar 的 + 菜单）            │
│  · 面板内用户级/项目级可切换，请求作用域由侧边栏提供     │
│  · 全部文案走 DSH locale 系统（zh/en）                   │
└─────────────────────────────────────────────────────────┘
```

复用的官方服务：`ctx.skills` 注册表（`dsh-skill` + `dsh-skill-filesystem` 已在 base bundle 启用，负责扫描与变化监听）。本插件直接读写文件系统，与官方 provider 的 frontmatter 契约保持一致（`name`/`description` 必填、kebab-case 名称）。

## 📁 项目结构

```
SkillsManagePlugins/
├── src/
│   ├── index.ts              # Host 半：/skills JSON API
│   ├── skill-fs.ts           # Skill 文件系统操作（扫描/解析/CRUD/重命名）
│   ├── trust-fence.ts        # 浏览器信任围栏（与 /api 网关一致）
│   ├── wire.ts               # JSON API 信封工具
│   ├── context-types.ts      # 双面 Context 类型声明
│   └── client/
│       ├── index.tsx         # Client 半入口（注册侧边栏 tab）
│       ├── SkillsTab.tsx     # 侧边栏 tab 外壳
│       ├── SkillsPanel.tsx   # 管理面板视图（列表/详情/新建）
│       ├── api.ts            # client → host API 桥接
│       ├── state.ts          # 面板状态 store
│       └── locales.ts        # zh/en 文案
├── tests/                    # 单元 + 真实组合集成测试（29 项）
├── cordis.patch.yml          # profile bundle 挂载行
├── tsdown.config.ts          # 双产物构建（host ESM + client CJS）
└── package.json
```

## 🛠️ 开发

```sh
pnpm install
pnpm typecheck   # 双面（host + client）类型检查
pnpm test        # 单元 + 真实组合（真实 cordis + WebServer + 真实 HTTP）集成测试
pnpm build       # tsc 声明 + tsdown 双产物（lib/index.js + lib/client.js）
pnpm watch       # client bundle 热构建（配合 dev:web 的 HMR 链）
```

构建产物：
- `lib/index.js` — host 半（/skills JSON API，fenced）
- `lib/client.js` — 浏览器半（`window.__ModuleLoader__.load` 包装的 CJS 闭包）
- `lib/types/**` — 双面声明

## ✅ 验证矩阵

- `pnpm typecheck` — host/client 双面类型检查通过
- `pnpm test` — 29 项：skill 文件系统单元测试（扫描/解析/CRUD/围栏/重命名 frontmatter 同步）+ 真实组合集成测试（真实 cordis + WebServer + 真实 HTTP，覆盖 create/read/update/rename/delete、404、403 跨站围栏、用户/项目双根）
- `pnpm build` — 双产物构建通过，client bundle 纯度门（无 Node builtin、无越界 @deepseek-ai 值导入）
- 安装后 `dsh --profile <name> --dump-config` 应出现 `dsh-skills-manager` 行

## ❓ FAQ

**Q: 为什么列表里看不到某个 Skill？**
A: 官方解析器会跳过 frontmatter 缺失/无效（缺 `name` 或 `description`、名称不是 kebab-case）的文件。打开对应 `SKILL.md` 补全 frontmatter 即可。

**Q: 为什么不在工作区顶栏/项目行菜单里加按钮？**
A: 这两个位置是官方 `ui-workspace` 内部硬编码、无 slot 扩展点，DOM 注入依赖哈希 CSS 类名不可靠，故采用 dsh-better-sidebar 的官方 tab 入口。

**Q: 支持哪些 Skill 形态？**
A: 目录型（`<name>/SKILL.md`）与扁平型（`<name>.md`）都支持。

## 📄 License

[MIT](LICENSE)
