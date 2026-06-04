# 快速开始

SauryCTF 是一个对标 GZCTF 的 Go + Gin + GORM + Nuxt SSG CTF 平台。

当前仓库已经具备这些基础能力：

- 用户注册、登录、会话鉴权
- 队伍创建、加入、退出
- 比赛创建、题目挂载、比赛报名
- 比赛详情页、题目列表、排行榜
- 动态计分与一血/二血/三血元数据

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
- `docs/guide/game-participation.md`
- `AGENTS.md`
