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
- 动态计分与一血/二血/三血元数据

## 首次启动

首次启动并完成数据库迁移后，只有在 `users` 表为空时，后端才会自动创建默认管理员：

- 用户名：`admin`
- 密码：`sauryctf`

前端当前提供独立的 `/login` 与 `/register` 页面，右上角导航也分别提供登录、注册入口，用于覆盖最小可用的首次使用流程。

登录成功后，前端会在客户端启动时自动恢复当前 Cookie 会话。即使刷新公开页面，导航栏也会继续显示正确的登录状态。

如果你是第一次在本地把整套项目跑起来，建议先直接验证这组默认入口：

- 前端登录页：`http://127.0.0.1:3000/login`
- 默认管理员：`admin / sauryctf`
- 只有在 `users` 表为空时，后端才会创建这组账号

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

## 当前前端原则

- 只使用 Nuxt UI 做极简页面拼接
- 先优先完成核心赛事流程，再逐步补齐管理功能
- 文档使用 Markdown，按 `get-started` 和 `guide` 分类沉淀

## 建议阅读顺序

- `docs/get-started/overview.md`
- `docs/guide/console-home.md`
- `docs/guide/team-management.md`
- `docs/guide/game-participation.md`
- `AGENTS.md`
