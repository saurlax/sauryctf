# 开发依赖

本地控制面依赖由 `compose.dev.yml` 提供：

- PostgreSQL：`127.0.0.1:15432`；
- Redis：`127.0.0.1:16379`；
- MinIO S3 API：`127.0.0.1:19000`，控制台：`127.0.0.1:19001`；
- Mailpit SMTP：`127.0.0.1:11025`，收件箱：`127.0.0.1:18025`。

复制 `.env.example` 为本地 `.env` 后，一条命令启动并等待依赖健康：

```bash
pnpm dev:dependencies
```

MinIO 初始化任务会幂等创建 `sauryctf` bucket。停止容器但保留开发数据：

```bash
pnpm dev:dependencies:down
```

数据库 schema 只能通过显式迁移升级：

```bash
pnpm db:migrate
```

迁移使用有界 `pg` 连接池和 Drizzle migrator；重复执行不会重复应用已记录迁移。CI 会为迁移测试创建随机命名的临时 PostgreSQL 数据库，并在测试结束后精确删除该测试库。

Worker 不得复用控制面数据库所有者。迁移后按 [Worker 数据库角色](../../deploy/postgres/README.md) 创建部署专用 LOGIN 并授予 `sauryctf_worker`，配置 `.env` 中的 `WORKER_DATABASE_URL` 后运行：

```bash
pnpm dev:worker
```

控制面和 Worker 的 `live` 仅表示进程存活；只有 `ready` 成功才可接入流量或领取任务。完整空环境验证可直接运行：

```bash
pnpm test:onboarding
```

开发凭据仅用于绑定到 `127.0.0.1` 的本地编排，禁止用于共享或生产环境。生产 Secret 必须由部署系统注入，不能复制本文件中的值。
