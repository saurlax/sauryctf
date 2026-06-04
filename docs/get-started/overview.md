# 快速开始

SauryCTF 是一个对标 GZCTF 的 Go + Gin + GORM + Nuxt SSG CTF 平台。

当前仓库已经具备这些基础能力：

- 用户登录、会话鉴权、空库默认管理员引导
- 队伍创建、加入、退出
- 比赛创建、题目挂载、比赛报名
- 比赛详情页、题目列表、排行榜
- 控制台首页导航与管理入口
- 动态计分与一血/二血/三血元数据

## 首次启动

首次启动并完成数据库迁移后，如果用户表为空，后端会自动创建默认管理员：

- 用户名：`admin`
- 密码：`sauryctf`

前端当前只保留 `/login` 统一登录入口，导航按钮文案为“登录/注册”，用于覆盖最小可用的首次使用流程。

登录成功后，前端会在客户端启动时自动恢复当前 Cookie 会话。即使刷新公开页面，导航栏也会继续显示正确的登录状态。

## 本地开发

后端：

```bash
go run ./cmd/server
```

前端：

```bash
cd frontend
pnpm dev
```

整体联调：

```bash
pnpm dev
```

## 当前前端原则

- 只使用 Nuxt UI 做极简页面拼接
- 先优先完成核心赛事流程，再逐步补齐管理功能
- 文档使用 Markdown，按 `get-started` 和 `guide` 分类沉淀

## 建议阅读顺序

- `docs/get-started/overview.md`
- `docs/guide/console-home.md`
- `docs/guide/game-participation.md`
- `AGENTS.md`
