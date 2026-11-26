# Public plugin source contribution rules

This repository provides reusable React/Cordis client plugins, pure domain modules, Node-only GitHub service handlers, single-plugin fixture Playground and tests.

- Keep source entry points explicit. Browser bundles must never depend on `plugins/*/server`, `api/`, Node built-ins, OAuth credentials or GitHub App secrets.
- Ordinary business APIs use immutable functional objects. Cordis Services are lifecycle adapters, with a single browser Context and React Root. Route contributions use `ctx.reactUI.registerPage`; cleanup belongs to Cordis disposal.
- Keep component-specific styles in CSS Modules. Maintain request AbortSignal, stale response rejection, authorization boundaries and unknown GitHub POST result protection.
- Public owns resource routes, reusable UI, and business handlers. Hosts own their product Header, root page, Navigator and HTTP dispatch. Keep explicit Fixture paths isolated from real reads/writes. The approved source reorganization does not authorize merge or deployment.
- Run `npm run build` and relevant Node/DOM/route tests and document actual evidence. Use existing behavioral tests; no new pure CSS assertions or temporary verification files. No real GitHub write tests without explicit authorization.
- Do not publish packages, embed credentials, or make production settings changes in source migration PRs.
- License: AGPL-3.0-only for original code. Preserve authorship, original Git history and third-party notices. Deployment of modified network services may trigger Corresponding Source obligations; review them before distribution or use.

## CI 配额与自动化约束（双仓协作）

- Coder 先在**本地完成相关静态检查和测试验证**，记录实际结果；禁止以连续 Push、空提交或碎片提交远端 CI 试错。
- 每项任务原则上只做一次正式完整 CI。失败先只读分析日志并本地修复；追加完整 CI、`rerun`、`workflow_dispatch` 需要 Lead/Owner 针对具体运行的明确授权。不得因节省预算谎报 PASS、规避必需验证或降低断言。
- PR 默认保留现有 `Build & test` 轻量必需检查；完整 Node 回归按批准引用手动触发，PR 上过期检查由 `concurrency` 取消。自动取消不覆盖 main 与经授权手动 CI。变更 required checks 前由 Owner 核对分支保护规则。
- Owner 在 GitHub Billing/Actions 查看用量并设置预算、告警与超额停止策略；未读取真实用量时不推断余额或 CI 启动失败根因。
- 公开仓库可能连接现有生产 Vercel 项目；未经 Owner 单独授权不得创建 Preview、合并到 main、改部署设置或触发实际生产。CI/代码授权不自动授予部署权限。
