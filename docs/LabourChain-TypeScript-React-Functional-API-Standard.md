# LabourChain TypeScript / React 编码规范（#77）

状态：Owner 已批准在 #77/#76 执行。本规范中的 Google/React 部分引用官方要求；LabourChain 扩展为项目约束。开发结果与 CI 证据写入对应 PR。

## 1. 标准依据

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)：默认 `const`、清晰类型、避免不必要容器及隐式可变状态、可索引的具名函数。
- [React Components and Hooks must be pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure)：渲染幂等，Props/State/Hook 输入不变更；网络和存储副作用放事件或 Effect。
- **项目强化规则**（Owner 决策，不属于 Google 官方强制要求）：普通 HTTP/Domain API 使用只读普通对象 `Object.freeze({ method, ... })`，具名函数实现，避免业务 `class`、`new XXXService()`、`this.fetcher`、客户端对象方法运行时覆盖与 Service 继承；不保留过时业务内部适配层。

## 2. API、纯函数和数据

```ts
interface Member {
  readonly id: string
  readonly name: string
}
interface MemberApi {
  readonly members: (signal?: AbortSignal) => Promise<readonly Member[]>
}
type RequestFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

// 原生 fetch 始终在正确 receiver 上调用；不能取出 window.fetch 再当对象方法调用。
function defaultRequest(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init)
}
function createMemberApi(request: RequestFn = defaultRequest): Readonly<MemberApi> {
  async function members(signal?: AbortSignal): Promise<readonly Member[]> {
    const response = await request('/api/members', { signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error('Cannot load members')
    const value: unknown = await response.json()
    return parseMembers(value) // 校验未知边界，输出新快照
  }
  return Object.freeze({ members })
}
export const memberApi = createMemberApi()
```

API 函数允许 I/O，称为函数式 API 并不意味着网络请求是纯函数。解析/筛选/排序/Reducer 用输入 → 新输出的纯函数实现；异常、HTTP 状态码在边界转换为受控领域错误。响应先作为 `unknown` 检查，不靠 `as DomainObject` 代替校验。共享业务数据只读：对象及数组标注 `readonly`，更新嵌套值时复制受影响层，不能修改调用方的对象。局部缓冲、AbortController、DOM 和 Response 可按生命周期变更；`Object.freeze` 不承诺深层冻结。

默认使用模块级静态 API；仅受控环境或测试需要时用 `createApi(request)` 注入**函数**（一次性确定依赖），返回引用稳定的只读对象，不传 Class 实例、不能后续替换客户端方法。页面消费单一稳定 API 引用；插件注册/注销仍由 Cordis 管理，React Root 仍只有一个。

## 3. 浏览器、Session 与安全

- `fetch` 使用自由函数 `globalThis.fetch(input, init)`；不可保存未绑定的 `window.fetch` 作为 `this.fetcher` 调用。受控替身要能检查 receiver，验证没有 `Illegal invocation`。
- 浏览器 GET / POST 保留 `credentials:'same-origin'`、`cache:'no-store'`、`AbortSignal`。请求状态不能在 render/useMemo 阶段触发 I/O；Effect 要能中止与规避过期结果。
- 匿名允许公开且已获 App 安装授权的 GitHub 仓库读；写仍需 OAuth 会话、App×User 权限交集、来源校验及明确用户确认。未知写入结果禁止自动重试。
- 共享 Header 从同源 Session API 读取最小公开登录信息。无 Session、请求失败、登录过期是不同状态。登录 return_to 必须过白名单。退出仅允许同源受控 POST，清本产品 Cookie，禁止 GET 退出及泄漏令牌。
- 本项目目前没有须迁移的 LabourChain 旧业务数据；**GitHub 仓库、Issue、Labels 和提交是真实数据，不允许自动删除或放宽权限**。

## 4. 有界例外与禁止项

Cordis 框架强制的 `extends Service` 为最薄框架适配例外，Registry 状态仍由单 Root / `useSyncExternalStore` 消费；`Error`、`URL`、`Response` 等标准平台对象是必要例外。页面局部 React State/Ref/Effect 保留其生命周期约束；禁止普通 HTTP 类、`export let` 客户端、Prototype 覆盖、通用全局可变业务 API。

所有业务 UI 样式仍在 CSS Modules。既有生产数据不使用测试 Fixture 替代；Fixture 只能在受控 Playground 模式提供显式、独立的行为场景，旧架构依赖与双路径适配必须删除。

## 5. 迁移清单、顺序与可回滚策略

| 优先级 | 现状 | 目标与验收 |
| --- | --- | --- |
| P0-A | `plugins/repo-home/src/service.ts` 中 `RepoHomeService` 和成员能力读/写；`plugins/repo-config/src/service.ts` 中 `RepoConfigService` | 一次替换为稳定只读普通 API、更新 Cordis 注入、Controller/Fixture 和回归；处理 `getCapability` 的 401/403/5xx 正确反馈；原 GitHub read/write 完整保持 |
| P0-B | `plugins/issue-detail/src/service.ts`、`plugins/channel/src/service.ts`、`plugins/topic-page/src/service.ts` HTTP Class | 静态普通 API + 函数 Request 注入；删除 Class 实例、兼容包装/旧断言；保留 Issue 评论与 Topic 写入未知结果保护 |
| P0-C | `plugins/react-ui/src/index.tsx` 共享 Header 只有 Theme；`api/github-session.mjs` 只返回布尔值；无 Logout Function | Header Session 加载/错误、真实身份/头像及键盘/触屏菜单、受控登录 return_to 与 POST 退出；公开只读不阻断；Playground 独立场景与真实验证边界 |
| P1 | 其他前端 API、`api/` HTTP 边界、类型断言与过时 Fixture | 依次核查并转换仍是业务 Class / 可变共享 API 的部分，确认无旧 HTTP Service 双路径；不得改 GitHub 权限或无授权写入 |

每一垂直模块含完整调用方、业务行为回归、原生 receiver 回归，并在一个独立 PR 上用同 Head CI 验证；不容忍新旧 API 同时存在。合并门槛：Reviewer #55 独立 Code QA + Owner/Lead 显式许可。浏览器真机、Vercel、OAuth 和 #51 D4 未跑时如实保留边界，不宣称通过。发生安全或 CI 阻断时优先修复或撤销对应 PR，不以降级安全检查、删除测试或兼容假实现遮盖。

## 6. 审查检查表

1. 是否仍有 `new *Service`、`this.fetcher`、可变 API 注册或隐藏 I/O？
2. 被调用的 `fetch` 是否保留原生 receiver？测试工厂是否注入纯函数？
3. JSON 是否在未知边界校验？对象及数组更新是否复制，不更改传入值？
4. Route/Abort/Session/权限/写入未知结果与原业务行为是否有等价正反路径回归？
5. Header Login、Avatar、菜单与 Logout 是否经过独立键盘/安全检查？
6. PR 记录真实测试和未测边界；Request/Result 只链接 PR，不重复证据。
