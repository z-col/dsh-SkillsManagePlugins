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
| 🗑️ 安全删除 | 删除前二次确认（全链路删除：库原件 + 所有层级副本），防止误删 |
| ✏️ 智能重命名 | 改名后**自动同步 frontmatter 的 `name` 字段**（DSH 以 frontmatter name 为准），且**全链路同步**到库原件与所有层级副本 |
| 🗂️ 三级管理 | **Skill 库**（`~/.dsh/skill-library/`，唯一权威原件）+ **全局** `~/.dsh/skills/` + 项目级 `<项目根>/.dsh/skills/` 一键切换 |
| 📦 移至式分发 | 打破「全局 or 项目」的独占限制：库中可把同一个 Skill **移至全局 / 移至项目级**（拷贝过去，库原件保留，可同时分发到多处）；某项目会话里该项目副本优先（DSH rank 机制），其它项目不受影响 |
| ♻️ 回收 | 层级卡片菜单「回收」= 只移除该层级的副本（库原件与其它位置保留） |
| 📂 打开目录 | 工具栏右侧图标一键在系统文件管理器打开当前 Tab（Skill 库 / 全局 / 项目级）对应目录 |
| 🧩 自动适配 | 装了 dsh-better-sidebar 自动集成到侧边栏；没装则在会话头部提供独立按钮 + 浮层面板；后装侧边栏也能自动切换 |
| 🌍 中英文界面 | 跟随 DSH 的 locale 系统自动切换 |

## 📸 截图

<!-- 在此处添加截图，例如：
![Skills 管理面板](./docs/screenshot.png)
-->

*（截图待补充 —— 欢迎贡献！）*

## 🚀 安装

> 前置依赖：DSH Web（`@deepseek-ai/dsh` ≥ 0.1.0-rc.6）。[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) **可选**：装了 → 集成到侧边栏 + 菜单；没装 → 自动改用会话头部按钮 + 浮层面板；先装本插件再装侧边栏也会自动切换。

```sh
# 从 npm 安装
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add dsh-skills-manager

# 或从本仓库本地安装（开发）
npx -p @deepseek-ai/dsh dsh plugin --profile web add /path/to/SkillsManagePlugins
```

安装后**重启目标 profile**（host 代码与 client bundle 变化需要重启），然后刷新浏览器页面。

## 🎮 使用方法

1. 打开 DSH Web 的**侧边栏**（或会话头部按钮）
2. 点击侧边栏顶部的 **+ 菜单**，选择 **「Skills 管理器」** tab
3. 面板顶部可切换 **Skill 库 / 全局 / 项目级** 三个 tab

| 操作 | 怎么做 |
|---|---|
| 查看 Skill | 点击列表中的卡片，进入详情页查看完整 `SKILL.md` |
| 编辑 Skill | 详情页底部编辑框修改内容 → 点「保存」（编辑副本会自动回写库原件） |
| 重命名 Skill | 详情页或卡片菜单「重命名」→ 输入新名称 → 确认（全链路：库原件 + 所有副本） |
| 删除 Skill | 详情页或 Skill 库卡片菜单「删除」→ 确认弹窗（**全链路删除**：库原件 + 全局 + 所有项目副本） |
| 移至 Skill | Skill 库卡片菜单「移至全局 / 移至项目级」→ 把库原件复制到该层级（已存在则覆盖刷新；库原件始终保留） |
| 回收 Skill | 全局/项目级卡片菜单「回收」= 仅移除当前层级副本（库原件与其它位置保留） |
| 打开文件夹 | 工具栏最右侧 📂 图标 → 在系统文件管理器打开**当前 Tab 对应目录**（Skill 库 / 全局 / 项目级） |

> 💡 新建 Skill 不在面板内提供：把 `SKILL.md` 目录放进 `~/.dsh/skill-library/<name>/` 即可出现在库中（或在全局/项目级直接建目录，打开 Skill 库会自动导入为原件）。

### 📦 三级模型速览

```
~/.dsh/skill-library/<name>/    ← Skill 库（唯一权威原件）
~/.dsh/skills/<name>/           ← 全局（副本 = 所有会话可用）
<项目>/.dsh/skills/<name>/      ← 项目级（副本 = 该项目可用，可同时存在于多个项目）
~/.dsh/skills-manager/index.json ← 项目索引（记录见过的项目，供库聚合与分发）
```

- **移至 = 拷贝**：把库原件复制到目标层级（库原件保留）；同一 Skill 可同时存在于全局和多个项目。
- 某项目会话里，项目副本**优先于**全局同名副本（DSH rank：项目 100 < 全局 400），其它项目不受影响 —— 这是「一个 Skill 分发到多个项目」的底层保障。
- 首次打开 Skill 库时自动执行**迁移**：全局与已记录项目里的旧 Skill 会被拷入库（原件保留 = 视为已分发），老数据零丢失。
- 已知取舍：分发是拷贝，改库原件不会自动同步到副本 —— 对已存在副本的位置再点一次「移至」即可用库原件覆盖刷新。

> 💡 所有修改都实时落盘，DSH 的 skill 监听器会自动刷新目录，**无需重启**即可生效（host 代码变更除外）。

## 🔍 工作原理

```
┌─ Host 半（lib/index.js）───────────────────────────────┐
│  /skills/api/*  JSON API（webServer prefix 路由）       │
│  · 浏览器信任围栏：Host-header 回环或 trustedHosts      │
│  · 会话作用域：sessionId → 会话 header.cwd → 项目根     │
│  · 全部文件操作限定在已知 skill 根内（路径围栏）     │
│  方法：roots.info / skills.list / skills.get /          │
│        skills.create（库中新建+可选立即分发）/    │
│        skills.update（原子）/ skills.delete（全链路）/   │
│        skills.rename（全链路）/ skills.recycle（单层回收）│
│        skills.library.list / .assign / .recycle / .sync │
│        skills.openFolder（按 root 打开对应目录）         │
└─────────────────────────────────────────────────────────┘
┌─ Client 半（lib/client.js）────────────────────────────┐
│  · ctx.inject(['betterSidebar']) → Skills 侧边栏 tab     │
│    （唯一入口：dsh-better-sidebar 的 + 菜单）            │
│  · 面板内 Skill 库/全局/项目级可切换，请求作用域由侧边栏提供 │
│  · 全部文案走 DSH locale 系统（zh/en）                   │
└─────────────────────────────────────────────────────────┘
```

复用的官方服务：`ctx.skills` 注册表（`dsh-skill` + `dsh-skill-filesystem` 已在 base bundle 启用，负责扫描与变化监听）。本插件直接读写文件系统，与官方 provider 的 frontmatter 契约保持一致（`name`/`description` 必填、kebab-case 名称）。同名 Skill 在全局与项目级并存时，DSH 以 rank 低的项目副本为准（`dsh-skill-filesystem` rank 100 < 全局 rank 400），这正是多项目分发安全性的依据。

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
├── tests/                    # 单元 + 真实组合集成测试（44 项）
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
- `pnpm test` — 44 项：skill 文件系统单元测试（扫描/解析/CRUD/围栏/库的分配·回收·同步·全链路重命名删除·迁移）+ 真实组合集成测试（真实 cordis + WebServer + 真实 HTTP，覆盖 create/read/update/rename/delete、库分配/回收/同步、404、403 跨站围栏、三级根）
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
