# 开始使用

SauryCTF 当前采用 monorepo，活动应用只有两个：

- `apps/web`：Nuxt 4/Nitro 控制面，是浏览器和公网 API 的唯一业务入口；
- `apps/worker`：私有 Go 实例 Worker，只负责动态实例任务与资源对账。

首期只实现 Jeopardy。仓库不包含第二个公网业务后端。

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

`apps/worker` 是独立 Go module，包含任务领取、Docker/Kubernetes Provider、
观察回写和周期 Reconciler。它只提供私有存活、就绪与指标端点，不提供公网
业务 API。

当前可以单独验证 module：

```bash
pnpm test:worker
pnpm build:worker
```

Worker 生产运行需要独立数据库 LOGIN，且必须继承迁移后由 `deploy/postgres/worker-role.sql` 创建的 `sauryctf_worker` 限权组角色。完整配置和 Provider 说明见 `apps/worker/README.md`。

## 默认管理员

空用户表首次启动只创建一个受限制账号 `admin / sauryctf`。首次登录后必须在现有账号维护页完成改密、邮箱设置与验证；在此之前不能执行管理操作。改密会递增 `session_version` 并使旧 Cookie 失效。

## 空环境验证

```bash
pnpm test:onboarding
pnpm test:smoke
```

`test:onboarding` 从随机命名的新依赖容器启动真实控制面和 Worker；`test:smoke` 在隔离数据库中验证完整 Jeopardy 业务链路。步骤和人工检查清单见 [Jeopardy 空环境与冒烟验证](./jeopardy-smoke.md)。

## 建议验证顺序

```bash
pnpm check:toolchain
pnpm check:boundaries
pnpm check:jeopardy-scope
pnpm generate:api
pnpm test:contracts
pnpm test:db
pnpm test:onboarding
pnpm test:smoke
pnpm typecheck
pnpm build
pnpm test:worker
```

详细设计见 [文档索引](../README.md)、[生产部署](../deployment/production.md) 与当前 OpenSpec change。
