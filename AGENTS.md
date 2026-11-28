# Public plugin source contribution rules

This repository provides reusable React/Cordis client plugins, pure domain modules, Node-only GitHub service handlers, single-plugin fixture Playground and tests.

- Keep source entry points explicit. Browser bundles must never depend on `plugins/*/server`, `api/`, Node built-ins, OAuth credentials or GitHub App secrets.
- Ordinary business APIs use immutable functional objects. Cordis Services are lifecycle adapters, with a single browser Context and React Root. Route contributions use `ctx.reactUI.registerPage`; cleanup belongs to Cordis disposal.
- Keep component-specific styles in CSS Modules. Maintain request AbortSignal, stale response rejection, authorization boundaries and unknown GitHub POST result protection.
- Public owns resource routes, reusable UI, and business handlers. Hosts own their product Header, root page, Navigator and HTTP dispatch. Keep explicit Fixture paths isolated from real reads/writes. The approved source reorganization does not authorize merge or deployment.
- Run `npm run build` and relevant Node/DOM/route tests and document actual evidence. Use existing behavioral tests; no new pure CSS assertions or temporary verification files. No real GitHub write tests without explicit authorization.
- Do not publish packages, embed credentials, or make production settings changes in source migration PRs.
- License: AGPL-3.0-only for original code. Preserve authorship, original Git history and third-party notices. Deployment of modified network services may trigger Corresponding Source obligations; review them before distribution or use.

## 测试维护

- 遵循 [dependency-risk-testing](https://github.com/Ri0n72Y/agent-identity/blob/main/.agents/skills/dependency-risk-testing/SKILL.md)：从实际生产责任边界出发，说明结构性依赖风险、能拒绝错误实现的用例及可观察失败。优先最近的有效保护；不得以历史 Issue、测试数量或 CI 绿色替代意义判断。
- 以现行产品契约和实际行为为测试依据。修改或删除功能时，同步更新、合并或删除对应旧测试；新增回归前先检查现有覆盖。
- 业务计算、数据契约、授权、真实写入防重、未知结果、并发、分页、缓存、路由和生命周期保护不得因精简而丢失。用可控 mock/fixture 验证，不对真实 GitHub 写入。
- 优先调用公共 API、渲染组件或触发实际 DOM 事件。避免固定 CSS 数值、选择器、属性排列、变量名和内部函数调用顺序的源码断言。仅对稳定架构、安全或构建配置契约保留必要的静态检查；不得用 JSDOM 或 CSS 字符串冒充真实浏览器布局验收。
- 视觉、响应式、触控尺寸及焦点可见性按 [测试与验收说明](docs/testing.md) 进行真实浏览器检查。测试数量不设固定指标。合并或删除测试须说明覆盖归属及未验证风险。
- 测试维护候选须完成 build、完整 Node 回归与两套 DOM 回归；记录实际命令、精确 SHA 和退出码。只报告真实运行结果。

## CI 配额与自动化约束（双仓协作）

- Coder 先完成可执行的相关静态检查和验证，记录实际证据；Public 可按 Owner 授权使用线上 PR CI 完成测试，不要求 Owner 单独检出 Public 候选。禁止以空提交或碎片提交反复触发 CI 试错。
- 每项任务原则上只做一次正式完整 CI。失败先只读分析日志并本地修复；追加完整 CI、`rerun`、`workflow_dispatch` 需要 Lead/Owner 针对具体运行的明确授权。不得因节省预算谎报 PASS、规避必需验证或降低断言。
- PR 默认保留现有 `Build & test` 轻量必需检查；完整 Node 回归按批准引用手动触发，PR 上过期检查由 `concurrency` 取消。自动取消不覆盖 main 与经授权手动 CI。变更 required checks 前由 Owner 核对分支保护规则。
- Owner 在 GitHub Billing/Actions 查看用量并设置预算、告警与超额停止策略；未读取真实用量时不推断余额或 CI 启动失败根因。
- 公开仓库可能连接现有生产 Vercel 项目；未经 Owner 单独授权不得创建 Preview、合并到 main、改部署设置或触发实际生产。CI/代码授权不自动授予部署权限。
