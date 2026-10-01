# 更新日志

版本按「DSH 接缝的代际」划分：v1 是第三方侧边栏插件时代，v2 起对齐 DSH 原生 Web 应用（含 0.2.0-rc.2 桌面版）。

## v2.0.0 — 2026-09-30

**支持最新桌面版（DSH Desktop `0.2.0-rc.2`），并修复「点击后提示先打开一个会话」。**

### 🐛 修复

- **「暂无会话，请先打开一个会话」**：DSH `0.2.0` 的客户端会话列表移除了 `current` 字段（选择权移到 `uiWorkspace`，client `sessions` 服务改为 retention 模型），旧面板恒读到 `undefined`，所以只要打开面板就必然提示没有会话 —— 哪怕正在对话中。现在管理器改为**会话作用域的视图标签页**，会话 id 由接缝直接注入，不再从全局字段猜「当前会话」。
- 同一改动顺带消除了会话切换 / 页面刷新后作用域过期的问题。

### 💥 变更（破坏性）

- 入口从「侧边栏图标行 + 中栏整页」（`sidebar.panellist` + `main`）改为**会话中栏的视图标签页**（`conversation.view`，id=`skills`，order=20），与内置「对话」（0）、「轨迹」（10）同一条标签栏。原因：DSH 0.2 原生左栏只对插件开放导航类接缝，没有「插件内容常驻左栏」的席位。
- 移除 dsh-better-sidebar / 第三方侧边栏插件的集成（`registerTab` 路径与 `dsh-better-sidebar` peer 依赖一并删除）；管理器不再需要任何侧边栏插件。
- 空会话（Hero 起始页）不显示视图标签栏 —— 与内置「轨迹」一致，发出第一条消息后出现。

### ✅ 兼容性

- 支持 **DSH Web / Desktop ≥ 0.1.7-rc.2**：`conversation.view` 与 `inject(sessionId)` 的契约在 0.1.7 与 0.2.0 完全一致（对照两个版本的内置 `ui-trajectory` 实现确认）。
- **已在 DSH Desktop `0.2.0-rc.2` 实测**：客户端插件图加载、标签注册、`/skills` API 全链路（`roots.info` / `skills.list` / `skills.get` / `skills.create` / `skills.update` / `skills.delete` / `skills.library.*`）通过；host 半按会话 `header.cwd` 解析项目根正常。
- `dsh.client.inject` 元数据更新为 0.2.0 的真实包名（`@deepseek-ai/dsh-client-runtime` 在 0.2 已不存在，client `sessions` 由 `@deepseek-ai/dsh-api-session-controller` 提供）。
- **`peerDependencies` 的 dsh 范围改为 `>=0.1.7-rc.2 <0.3.0`**（原为 `^0.1.0-rc.6` 等 caret 范围 —— caret 不跨 0.x 次版本，因此**不覆盖 0.2.x**）。同时删除两个已不存在的 peer（`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-client-runtime`）。
  > 为什么必须改范围而不是申请豁免：DSH 在 profile 装载时对每个 bundle 跑兼容性检查（`dsh-app-boot` 的 `evaluatePluginCompatibility`），任何 `@deepseek-ai/dsh*` peer 不满足**当前运行版本**就抛错，`loadProfileDirectory` 捕获后把**整个 bundle 丢进 `skippedBundles`** —— 只在 stderr 打一行，插件随即"人间蒸发"：host 行不在配置里（`/skills` 路由消失），client 条目也不在图里（所以标签页消失）。豁免记录在 profile 的 `compatibility.json`，键是**精确的 `name@version`**，所以**只要版本号一变，旧豁免立刻失效**。正确做法是让范围本身兼容。
- **构建产物 `lib/` 随仓库发布**：GitHub 安装（`add github:z-col/dsh-SkillsManagePlugins`）开箱即用，不需要任何构建脚本，也不受 pnpm ≥10 对 git 依赖构建脚本的拦截影响。

### 🧪 测试

- 共 56 项：新增**视图渲染测试**（注入的会话作用域直接渲染管理器，断言不再出现「暂无会话」，覆盖无 feed 行、多会话隔离）；**重写接线测试**（`conversation.view` 单缝注册、id/order/label、会话注入、语言跟随、fiber 释放）；新增 **profile 装载守卫测试**（`tests/profile-compat.spec.ts`：复刻 `evaluatePluginCompatibility` 的语义，断言所有 dsh peer 在 0.1.7-rc.2 与 0.2.0-rc.2 上**无需豁免即可满足**，并钉住 bundle/client 入口与不再存在的 peer）—— 这类"bundle 被静默跳过"的问题从此在 CI 就能拦住。

### 📦 安装

```sh
# GitHub（推荐，无需构建脚本）
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add github:z-col/dsh-SkillsManagePlugins

# 本地路径（开发）
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add /path/to/SkillsManagePlugins
```

> ⚠️ **不要**用 `add dsh-skills-manager`：npm 上的同名包属于第三方（`Xichun123/dsh-skills-manager`），与本项目无关。

## v1.0.0 — 2026-09-09

- 首个正式版：Skill 三级管理（Skill 库 `~/.dsh/skill-library` 权威原件 + 全局 `~/.dsh/skills` + 项目级 `<项目根>/.dsh/skills` 副本）。
- 可视化浏览 / 在线编辑（原子写入）/ 全链路重命名（同步 frontmatter `name`）/ 全链路删除（二次确认）/ 移至式多项目分发 / 单层回收 / 打开目录。
- 入口：安装 dsh-better-sidebar 时为侧边栏标签页，否则为会话标题栏按钮 + 浮动面板（自动切换）。
- 中英文界面跟随 DSH locale；全部修改实时落盘，无需重启。
