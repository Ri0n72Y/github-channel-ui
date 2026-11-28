# Public 测试维护与验收

## 执行口径

Public 可使用线上 PR CI；需要完整回归时按既有批准流程执行。以下为候选源码根目录的等价完整验证命令：

```sh
npm run build
npm run test:full
npm run test:dom
```

依赖按仓库说明安装；Hosted 完整 verify 必须继续正式解析 Public main，不能使用 PR 分支冒充正式来源。CI 仍使用既有轻量 Build & test；functional-apis 和 shared-theme 纳入 critical 选择，避免此前完整测试文件的语法错误未进入轻量 CI。full-regression 保持批准后手动执行，不增加 workflow 或改变 required check 名称。真实 GitHub 写入和部署须单独授权。

## 本轮测试目录分类与处理

基于 PR #122 初始 Head 111b612d；目录含 36 个 Node 测试入口、2 个 DOM 测试入口及测试 helper。此次进行目录级盘点和针对源码耦合测试的定向改造，并不声称完成所有业务断言的语义去重。

| 范围 | 文件（tests/ 下，省略 .test.mjs） | 处理 |
|---|---|---|
| API 分派、安装、OAuth、CI、路由 | api-routing, installation-probe, installation-token-422, oauth-return, ci-policy, router-fallback | 保留安全、路由及构建/CI 配置契约；CI 策略测试同步 critical 清单 |
| Config | config-api, config-preview, config-route | 保留权限、版本、写入结果、解析及切换保护 |
| Channel | channel-api, channel-ui | 保留频道选择、空态、分页、隔离；暂保留未有等价行为测试的生命周期静态保护 |
| 普通 API | functional-apis | 修复 Topic 快照重复声明；保留完整 API 行为与 SHA 参数，纳入 critical |
| Issue / 劳动 | issue-api, issue-create-installation, issue-domain, issue-universal, issue-view | 保留领域计算、权限、写入和可访问行为；issue-view 删除固定 CSS/布局实现断言，真实布局移至浏览器 |
| Repo / 成员 | repo-home, repo-panel-functional, member-ui-79, repo-theme, repo-ui | 保留业务、权限、身份及安全 URL；移除重复视觉和源码断言，成员字段实际错误与焦点在 DOM 验证，成员目录和真实身份已有 DOM 验证 |
| Session / Theme | session-fixture, session-ui, shared-theme, site-theme-pages | 保留会话、OAuth、存储行为；重试、退出失效事件、存储拒绝时切换用实际 DOM 验证；共享主题只保留语义 token 接口及单运行时边界；删除 site-theme-pages 历史视觉源字符串检查，实际视觉检查见下 |
| Topic | topic-api, topic-masonry, topic-p1-83, topic-p1-ui, topic-pagination, topic-read-budget, topic-report-ui, topic-report, topic-slug-83, topic-ui | 保留授权、缓存、并发、分页、报告、图片安全、卡片和真实描述数据；删除固定描述 CSS 断言；尚无等价行为覆盖的写入防重与路由静态保护暂保留 |
| React / Playground DOM | react-lifecycle-86.dom.mjs, playground-routes.dom.mjs | 保留实际交互、路由、生命周期、草稿和写入锁；替换成员焦点、主题存储异常及登录重试/确认退出的源码检查；移除 Repo Home CSS 字符串检查 |

保留测试中的历史 Issue 编号仅作追溯，不要求每个 Issue 对应新增测试文件。将来删减业务断言应给出具体等价行为覆盖；测试文件名和测试数量不作为功能完成指标。

## 浏览器视觉验收

以下项目曾用 CSS 字符串、固定字号/颜色/选择器、断点或手算宽度测试表达。Node/SSR/JSDOM 不能证明实际视觉布局。改为在已授权、SHA 可核验的浏览器环境检查，无需创建 Preview：

- 浅色/深色主题：页面与控件颜色一致，文字、链接、焦点可见；不出现历史混色。核对批准的设计 token 和视觉基线。
- 公共 Theme/Session、项目成员及发布入口：实际触控面积至少 44px，键盘焦点可见；Session 在窄屏不溢出。
- Repo Home：标题、README、动态、团队区布局正确；标题覆盖图不裁切成员 Popover；长文本、Markdown H1–H6、代码和媒体保持可读，窄屏无非预期横向溢出。
- Issue：阅读/编辑区、标签和引用框在正常及矮视口可访问；分割滚动与紧凑单滚动模式保留末尾评论、分页、反馈及提交控件；触控与键盘可操作。
- Config：320/375px 等窄屏，编辑器和操作按钮不超出容器，长 YAML 可编辑。
- Topic：响应式列数和卡片布局符合批准设计，真实封面/无图/坏图状态正常；简介自然换行并最多显示五行，完整内容保留，链接正确。
- Hosted Header 64px 及移动端换行由 Hosted 所属测试和浏览器验收负责。

记录候选 SHA、浏览器、视口、实际结果和必要截图。上述验收不能用静态检查或 jsdom PASS 代替；未运行须注明。业务与安全行为仍由自动化测试保护。

## 完成条件

候选全量 Node/DOM 与 build 有真实结果，独立 Reviewer 核对删减是否丢失现行产品契约、架构或安全边界；未完成的视觉验收继续明确跟踪。不要为了维持旧计数、绿色结果或配额修改断言含义。

## 依赖风险审计（2026-11-28）

依据 [dependency-risk-testing](https://github.com/Ri0n72Y/agent-identity/blob/main/.agents/skills/dependency-risk-testing/SKILL.md)。上轮 Head 8e77ef8b 的 313/313 是运行结果，不能据此证明每项断言都符合标准。此次读取该轮 CI 日志并扫描全部 27 个运行入口的测试声明、导入与断言；对发现的问题回读实际责任函数与调用组件后修订。逐项生产依赖追踪与所有等价类去重尚未完成，不将本次扫描标记为 313 项全部合规。

| 责任边界 | 结构性风险及应拒绝的错误实现 | 本轮处理 |
|---|---|---|
| target.mjs / OAuth newFlow/readFlow | 允许非授权返回路径、状态或密钥错配 | 将 Session 中重复 allowlist 合入 OAuth；纯路径规范化和封存边界各自保留 |
| Issue domain / loadIssueContent | PR 或错误编号被当 Issue，或取消信号未转发 | 领域判断只保留最近的完整用例；loader 测实际依赖转发与不继续读取 |
| IssueDetailPage 路由及分页状态 | 切换 Issue 后旧分页迟到，污染新 Issue 的劳动汇总 | 删除两个独立 loader 假数据自证的汇总用例；新增真实挂载、路由切换、旧请求迟到及当前成果/工时断言 |
| Topic config-draft / TopicPageContainer | dirty 草稿被读取覆盖；维护 PR 在 main 未变化或读取失败后提前解锁 | 保留纯函数等价类；替换测试自行模拟 Promise 失败和源码 ref 名称检查为真实挂载组件的提交、重查、失败恢复、版本变化 |
| TopicPageContainer 分页 | 同 tick 双请求、失败丢失已有卡片、重复 ID | 既有生产 batch/endpoint 用例覆盖 sparse；移除 Playground fixture 及源码钩子混合用例，新增真实 UI 快速点击/失败/重试 |
| member registerMember / GitHub Contents port | 409 后重复旧 SHA、覆盖其他人的并发修改 | mock 在第一次 409 后返回新 SHA 和真实新增成员；断言第二次 PUT 使用新 SHA 且保留双方成员 |
| functional API → HTTP port | 错目标、错分支、错误分页参数、未发送写入对象、错误请求也被泛型 Error 断言接受 | 验证 detached API 调用、确切 query/body/错误类别，移除旧 Class 名称和 JSON 序列化天然不同引用的断言 |
| Issue View / CI config | 实际架构和任务调度契约 vs 内部变量、历史文档字符串、重复计数 | 保留禁止越界依赖和独立调度风险；删除 Controller 私有变量/函数调用名称、重复 rewrite 数量、同一计算重复断言 |

保留未证实重复的安全/并发/缓存、签名、响应投影和路由接线保护，尤其多个端点各自可能错误绕过共享授权函数的组合风险。Mock 请求验证不证明真实 GitHub 兼容性；JSDOM 不证明真实浏览器布局/BFCache。仍需按原门槛完成新的线上证据、独立 Reviewer 的覆盖复核以及未验证依赖边界的逐项审计，不能因测试全部绿色而关闭该要求。

## 第二轮清理：实际路由、写入与全量目录

基于 16cd25ba 的线上常规 CI 310/310（build 通过，full-regression skipped），补查此前未选入常规 CI 的测试文件。

- Channel：保留 selectChannelIssues 真实领域风险和 Handler 的分页、授权、main 及不完整快照保护；去掉重复 Issue 有效性、手动拼接 Issue loader/劳动 parser 的测试以及 fixture 自身返回常量检查。新增实际 Cordis 插件注册、同路由跨仓库切换、旧响应迟到测试。
- Config：用实际注册路由的 A 提交未结束 → B 编辑器 → A 响应迟到测试替代 config-route 中空组件 key 与 Controller 内部字符串断言。保留已有独立的读/写取消、草稿与同步保护。
- Member：保留公共成员展示、权限状态、独立 Session fixture 连接行为；用真实 MembersPage 授权、session-change、迟到响应与公开内容保留测试替代 hook 内部 key/变量和 SSR 初始渲染推断。
- Topic：实际注册源路由切换验证旧草稿和旧 metadata 取消；真实报告控制器测试覆盖快速重复 POST、未知结果、草稿、明确重查 proof 和成功链接。去掉源码 guard、无关插件名和 fixture 返回值自检；保留展示层独立失败/权限反馈。1000 窗口由 topic-pagination 的现行链路覆盖；旧导出 accumulateTopicProjects 尚未证明外部消费者不存在，保留其最近的聚合函数测试，不依据旧名称宣称其仍是现行分页入口。
- Markdown、Theme、API routing：去掉重复的解析内容顺序、无真实主题依赖的 fixture 比较、精确 HTML 嵌套与 rewrite 总数；保留独立 H1–H6 可访问语义、真实组件路由和 API 映射/无重复来源保护。
- Channel Handler 与普通 Issue 创建安装授权具有独立写入/读取风险，加入现有 critical 清单；不改变 workflow 或批准后 full-regression 门槛。全量目录中未选入常规 CI 的改动仍须通过完整回归确认。

本轮仍为定向清理，尚不代表全部用例的生产依赖逐项审计完成。线上运行以新提交实际结果为准。
