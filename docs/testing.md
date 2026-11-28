# Public 测试维护与验收

## 执行口径

本地在候选源码根目录运行：

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
