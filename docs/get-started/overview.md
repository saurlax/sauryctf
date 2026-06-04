# 快速开始

SauryCTF 是一个对标 GZCTF 的 Go + Gin + GORM + Nuxt SSG CTF 平台。

当前仓库已经具备这些基础能力：

- 用户登录、会话鉴权、仅空库触发的默认管理员引导
- 队伍创建、加入、退出
- 比赛创建、题目挂载、比赛报名与列表状态提示
- 比赛报名审核与参赛队伍状态管理
- 比赛报名模式配置（人工审核 / 自动通过）
- 比赛公告编辑与详情展示
- 比赛时间配置校验（开始/结束/封榜时间）
- 题面、提示、附件链接的录入与比赛页展示
- 比赛详情页、题目列表、排行榜
- 控制台首页导航与管理入口
- 管理端比赛导出 ZIP 包
- 动态计分与一血/二血/三血元数据（公开榜单与管理端挂题视图）

## 首次启动

首次启动并完成数据库迁移后，只有在 `users` 表为空时，后端才会自动创建默认管理员：

- 用户名：`admin`
- 密码：`sauryctf`

前端当前提供独立的 `/login` 与 `/register` 页面，右上角导航也固定提供两个按钮入口：

- `登录`
- `注册`

首页 Hero 也会根据登录态显示入口：

- 未登录时显示 `登录`、`注册`
- 已登录时显示 `进入控制台`
- `/login` 与 `/register` 现在都使用统一的访客中间件：
  - 未登录用户正常停留在页面
  - 已登录用户会自动回到 `redirect` 指定页面，或默认进入 `/console`
- 前端登录态恢复现在通过 `useAuth().ensureInitialized()` 统一收口：
  - 路由中间件和关键页面会等待一次共享的会话恢复
  - 避免公开页、控制台页各自重复触发一套登录态初始化
- 公开比赛列表与控制台首页现在也共享同一套批量报名状态加载逻辑：
  - 同一批 `/api/games/{id}/participation` 请求会复用统一的兜底行为
  - 后续调整报名状态展示时，不需要再手动同步两套请求实现
- 公开比赛列表与比赛详情页现在共享同一套报名状态解释：
  - 登录、组队、待审核、被拒绝、待补 Writeup、已报名等状态会保持一致语义
  - 页面只负责各自的展示布局，不再分别维护两套核心状态判断

登录成功后，前端会在客户端启动时自动恢复当前 Cookie 会话。即使刷新公开页面，导航栏也会继续显示正确的登录状态。

如果你是第一次在本地把整套项目跑起来，建议先直接验证这组默认入口：

- 前端登录页：`http://127.0.0.1:3000/login`
- 默认管理员：`admin / sauryctf`
- 只有在 `users` 表为空时，后端才会创建这组账号
- 登录成功后，浏览器会收到 `token` Cookie；随后刷新页面或访问 `/api/auth/me` 都应仍能识别当前登录态
- 重复登录会生成新的独立会话，不需要手动清理旧会话或重置数据库

完整的本地冒烟步骤现在已经拆到单独文档：

- `docs/get-started/smoke-flow.md`

其中会覆盖：

- 空库后的管理员建赛最小链路
- 普通选手的注册、建队、报名、提 Flag、看榜最小链路
- 以及几个最容易卡住的本地联调检查点

## 本地开发

后端：

```bash
go run ./cmd/server
```

前端：

```bash
pnpm dev:frontend
```

整体联调：

```bash
pnpm dev
```

如果只想在前端目录里单独启动，也可以直接运行：

```bash
cd frontend
pnpm dev:local
```

当前仓库里 `dev:frontend` 已经固定为本地可访问的 `127.0.0.1:3000`，便于直接联调登录态和 Cookie 会话。

本地登录调试时，有两个约束最好保持不变：

- 浏览器入口优先使用 `http://127.0.0.1:3000`，不要在同一轮调试里混用 `localhost:3000`
- 前端请求保持走同源 `/api/**`
  - 当前 Nuxt 开发环境已经通过 `nitro.devProxy` 把 `/api` 转发到 `http://localhost:8080/api`
  - `frontend/app/plugins/api.ts` 里的 `$apiFetch` 也固定带上了 `credentials: 'include'`
  - 这样浏览器收到的是来自前端源站的 `token` Cookie，刷新页面后 `/api/auth/me` 才能稳定恢复登录态

如果登录后仍然是访客态，可以先按这个顺序排查：

1. 确认后端实际跑在 `127.0.0.1:8080` 或 `localhost:8080`
2. 打开浏览器开发者工具，确认登录请求地址是 `http://127.0.0.1:3000/api/auth/login`，而不是直接跨源请求 `http://localhost:8080/api/auth/login`
3. 确认登录响应里出现了 `Set-Cookie: token=...`
4. 刷新后访问 `http://127.0.0.1:3000/api/auth/me`，确认仍然返回当前用户

## 当前前端原则

- 只使用 Nuxt UI 做极简页面拼接
- 先优先完成核心赛事流程，再逐步补齐管理功能
- 文档使用 Markdown，按 `get-started` 和 `guide` 分类沉淀

## 建议阅读顺序

- `docs/get-started/overview.md`
- `docs/get-started/smoke-flow.md`
- `docs/guide/console-home.md`
- `docs/guide/team-management.md`
- `docs/guide/game-participation.md`
- `AGENTS.md`
