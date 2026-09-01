# 开始使用

SauryCTF 当前采用 monorepo，活动应用只有两个：

- `apps/web`：Nuxt 4/Nitro 控制面，是浏览器和公网 API 的唯一业务入口；
- `apps/worker`：私有 Go 实例 Worker，只负责动态实例任务与资源对账。

`legacy/go-monolith` 是迁移期间的实现参考，不属于目标部署，也没有加入根
Go workspace。首期只实现 Jeopardy。

## 准备工具链

按 [工具链与锁文件](./toolchain.md) 安装固定版本，然后在仓库根目录执行：

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 启动控制面

复制 `.env.example` 为 `.env`，启动 PostgreSQL、Redis、MinIO 和 Mailpit：

```bash
pnpm dev:dependencies
pnpm db:migrate
pnpm dev:web
```

Nuxt 默认监听 `http://127.0.0.1:3000`。`/api/**` 由 Nitro 自己处理，不代理
到 Go 服务。

生产构建与启动：

```bash
pnpm build
node apps/web/.output/server/index.mjs
```

## Worker

`apps/worker` 已建立独立 Go module 和依赖边界。Worker 的进程入口、任务领取、
Provider 和 Reconciler 会按 OpenSpec 第 8、9 阶段逐步实现；在这些任务完成前，
不使用遗留 Go 单体伪装成新 Worker。

当前可以单独验证 module：

```bash
pnpm test:worker
```

## 遗留实现

需要对照旧行为或运行迁移期 smoke 时，使用显式遗留命令：

```bash
pnpm dev:legacy
pnpm test:legacy
```

这些命令不会把 `legacy/go-monolith` 加回活动 workspace，也不能作为新功能的
落点。迁移完成后整个遗留目录将删除。

## 建议验证顺序

```bash
pnpm check:toolchain
pnpm check:boundaries
pnpm check:jeopardy-scope
pnpm generate:api
pnpm test:contracts
pnpm test:db
pnpm typecheck
pnpm build
pnpm test:worker
```

详细设计见 [文档索引](../README.md) 与当前 OpenSpec change。
