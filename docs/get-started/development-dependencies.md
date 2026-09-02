# 开发依赖

本地控制面依赖由 `compose.dev.yml` 提供：

- PostgreSQL：`127.0.0.1:15432`；
- Mailpit SMTP：`127.0.0.1:11025`，收件箱：`127.0.0.1:18025`。

默认不需要 S3：NuxtHub Blob 使用 `apps/web/.data/blob`（或 `NUXTHUB_BLOB_DIR`）作为持久目录，开发控制面必须保持单副本。直接启动默认依赖：

复制 `.env.example` 为本地 `.env` 后，启动并等待依赖健康：

```bash
docker compose -f compose.dev.yml up -d --wait
```

需要验证共享 S3 时，显式启用 `s3` profile；MinIO S3 API 位于 `127.0.0.1:19000`，控制台位于 `127.0.0.1:19001`，初始化任务会幂等创建 `sauryctf` bucket：

```bash
docker compose -f compose.dev.yml --profile s3 up -d --wait
```

停止容器但保留开发数据：

```bash
docker compose -f compose.dev.yml down
```

数据库 schema 只能通过显式迁移升级：

```bash
pnpm db:migrate
```

迁移使用 NuxtHub PostgreSQL migration journal 与项目的显式事务执行器；重复执行不会重复应用已记录迁移。CI 会为迁移测试创建随机命名的临时 PostgreSQL 数据库，并在测试结束后精确删除该测试库。

Worker 不得复用控制面数据库所有者。迁移后按 [Worker 数据库角色](../../deploy/postgres/README.md) 创建部署专用 LOGIN 并授予 `sauryctf_worker`，配置 `.env` 中的 `WORKER_DATABASE_URL` 后运行：

```bash
pnpm worker
```

控制面和 Worker 的 `live` 仅表示进程存活；只有 `ready` 成功才可接入流量或领取任务。完整空环境验证可直接运行：

```bash
bash ./scripts/test-onboarding.sh
```

开发凭据仅用于绑定到 `127.0.0.1` 的本地编排，禁止用于共享或生产环境。生产 Secret 必须由部署系统注入，不能复制本文件中的值。
