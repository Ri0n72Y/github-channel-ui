# Public 测试维护与验收

## 测试设计

从实际生产契约设计最小充分保护。依据 [effective-testing](https://github.com/Ri0n72Y/agent-identity/blob/main/.agents/skills/effective-testing/SKILL.md) 及 Owner 指定的 [Change-Detector Tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)、[Increase Test Fidelity](https://testing.googleblog.com/2024/02/increase-test-fidelity-by-avoiding-mocks.html)、[Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html)、[Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)、[Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details)。历史 Issue、文件、测试数量与既有绿色结果均不是保留依据。按实际消费者、独立风险、可观察结果和维护成本选择最小稳定边界；预期结果须独立于实现。已有充分保护时可以不新增测试。外部端口替身应验证实际请求目标，并拒绝未预期的交互；避免生产错误处理吞掉替身内断言。重要的新建或实质修改测试在可行时验证预期缺陷能导致失败，不要求逐项风险记录、固定测试比例或 mutation score。不要为单纯重构修改测试结果。

| 责任与执行边界 | 保留的独立契约 |
|---|---|
| 纯领域规则（domain-*） | 劳动记录格式、主观工时与冲突；引用与目标安全；Label 计划与 Channel 选择；成员文档追加和字段限制；README、Topic 声明、游标、布局算法；读缓存及写入 gate 的时序 |
| GitHub 安装、会话与实际 HTTP Handler | 实际请求目标、授权主体、安装签名、最小读取范围、撤销及错误状态；完整原始数据、分页、配置来源与完整性；实际提交内容、分支、冲突与回读；不确定写入保留证据且不盲重试 |
| 浏览器 service | 独立 wire 响应校验、请求体、状态转换、读取缓存与取消；不重复验证页面已经实际发送并核对的 HTTP 交互 |
| 真实 DOM、Cordis 注册与 Public Host | 真实路由和组件中的用户操作、异步生命周期、草稿、权限变化及迟到结果；重要写入流程使用生产 service 和受控 HTTP，实际请求必须符合授权目标；独立 UI 行为可直接使用最小稳定端口 |
| 工程检查 | 正式 API/SPA 映射、Function 上限、已批准 CI 配置和真实插件隔离 |

测试保留依据是独立故障及其可观察后果。删除重复的成功/失败矩阵、旧兼容辅助函数的重复行为测试、Playground 替身自检、直接构造视图模型的重复渲染测试和不能证明真实布局的 DOM 几何断言。生产兼容导出与现行功能保持不变；真实领域布局算法仍验证其几何结果。

外部 HTTP 使用可观察替身，检查实际目标、方法、身份、请求体及禁止的副作用。observeHttp 在每个测试结束时暴露被生产错误处理吞掉的断言和意外请求。不要把替身自身的返回值当作生产行为的验证。重要写入场景通过持久化的 fixture 数据或服务端真实请求序列核对成功、部分成功、失败及不确定结果。测试不得访问实际用户数据或修改真实 GitHub 资源。

Issue 正文、讨论与劳动记录的差异由真实 Issue 页面和生产 service 验证；Theme 由真实 DOM 操作和重新挂载验证持久化。Config、Member、Issue、Topic 的写入 gate 与页面操作分层验证，避免在每个页面重复穷举共享规则。Topic 的缓存、完整 Search 页、局部分页及迟到响应在各自实际消费边界验证，避免重复跑相同的通用缓存矩阵。

保留 Private 兼容入口 `tests/*.test.mjs`、`tests/react-lifecycle-86.dom.mjs`，以及独立 Playground DOM 入口和现有 CI 门槛。不新增测试框架。历史审查过程在 PR #122 中追踪，当前文档只维护现行契约。

## 执行口径

```sh
npm run build
npm run test:full
npm run test:dom
```

常规 CI 保留 Build & test 名称与原有 Installation、critical、DOM、router、policy 步骤；完整回归按既有批准流程，真实 GitHub 写入与部署仍需单独授权。不要把 CI 选择或测试数量作为质量目标。记录候选 SHA、实际命令和结果；Hosted 必须按正式流程同步 Public main。

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

候选全量 Node/DOM 与 build 有真实结果；若常规 CI 的显式选择与全量入口集合完全一致，可使用各步骤的实际结果证明覆盖，无需仅为重复执行改动批准流程。独立 Reviewer 核对删减是否丢失现行产品契约、架构或安全边界；未完成的视觉验收继续明确跟踪。不得为了维持旧计数、绿色结果或配额修改断言含义。

