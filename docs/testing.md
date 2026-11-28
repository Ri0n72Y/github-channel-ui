# Public 测试维护与验收

## 测试设计

从实际生产契约设计最小充分保护。依据 [effective-testing](https://github.com/Ri0n72Y/agent-identity/blob/main/.agents/skills/effective-testing/SKILL.md) 及 Owner 指定的 [Change-Detector Tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)、[Increase Test Fidelity](https://testing.googleblog.com/2024/02/increase-test-fidelity-by-avoiding-mocks.html)、[Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html)、[Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)、[Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details)。历史 Issue、文件、测试数量与既有绿色结果均不是保留依据。按实际消费者、独立风险、可观察结果和维护成本选择最小稳定边界；预期结果须独立于实现。已有充分保护时可以不新增测试。外部端口替身应验证实际请求目标，并拒绝未预期的交互；避免生产错误处理吞掉替身内断言。重要的新建或实质修改测试在可行时验证预期缺陷能导致失败，不要求逐项风险记录、固定测试比例或 mutation score。不要为单纯重构修改测试结果。

| 责任与执行边界 | 保护 |
|---|---|
| domain-*：直接运行真实领域函数 | 工时及引用安全、Config 删除边界、Channel 选择、成员身份和资料、README、Topic/图片与几何 |
| GitHub 安装和会话 | 签名、会话来源、安装范围、最小读权限、撤销与用户权限；每种入口的组合风险；不复跑全部领域分区 |
| HTTP 读取与写入契约 | 真 Request/Response、生产 Handler、授权与解析；外部 GitHub HTTP 替身。Config/Topic 写入不再注入 writeContext 或 Installation 假结果。Config preview 与 Channel 读取不再绕过真实授权和 HTTP 解析 |
| 浏览器 service 契约 | 真实 service 调用、HTTP 参数、响应校验、状态/错误转换、缓存和取消；模拟浏览器 HTTP 而非服务返回值 |
| 用户行为、Cordis 注册及 Host 组合 | 生产插件注册/卸载、实际 React 组件、真实路由；独立组件只验证自己拥有的状态；可控 service port 用于时序状态，代表性的 Channel 读取执行真实 browser service 到 HTTP。真实 GitHub 兼容性不由替身证明 |
| 渲染契约 | 仅保留独立的内容安全、可信 URL、错误/不完整状态、可访问语义等可观察输出；不以 SSR 字符串证明交互或 CSS 布局 |
| 工程检查 | 正式 API/SPA 映射、Function 上限、已批准 CI 配置、真实插件隔离；不固化历史测试文件或复制 Actions 调度算法 |

重构保持 Private 使用的顶层 `tests/*.test.mjs` 和 `tests/react-lifecycle-86.dom.mjs` 兼容；不新增框架，不改生产模块。保留两套现有 DOM 入口是 Hosted 兼容性与独立 Playground 组合的选择。历史审查过程在 PR #122 的记录中保留，当前文件只维护现行契约。

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

候选全量 Node/DOM 与 build 有真实结果，独立 Reviewer 核对删减是否丢失现行产品契约、架构或安全边界；未完成的视觉验收继续明确跟踪。不要为了维持旧计数、绿色结果或配额修改断言含义。

