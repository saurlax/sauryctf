# 生产部署

## 拓扑与网络边界

Nuxt/Nitro 控制面是唯一公网业务入口，负责页面、API、认证授权、事务、缓存协调、SSE、Outbox 和控制面定时任务。Go Worker 只能从私网访问 PostgreSQL、Docker Engine 或 Kubernetes API，不得通过 Ingress 暴露。

PostgreSQL 保存权威业务事实；Redis 只保存可重建缓存、限流、短锁和实时扇出；S3 兼容存储保存权威内容对象；SMTP 只承担事务邮件投递。题目 HTTP/TCP 流量由 Gateway/Ingress/Service 直接送达实例，不能经过控制面或 Worker。

建议网络策略：

- 公网只允许访问控制面和明确发布的题目入口；
- 控制面可访问 PostgreSQL、Redis、S3、SMTP 和 OTLP Collector；
- Worker 可访问 PostgreSQL 和启用的 Provider API，不可访问身份凭据表对应的业务权限；
- PostgreSQL、Redis、S3 管理端、Docker socket 和 Kubernetes 管理面只允许受信工作负载访问；
- 题目实例默认不能访问控制面、数据库、Redis、对象存储或 Kubernetes 管理面。

## 构建产物

使用仓库固定的 Node、pnpm 和 Go 版本：

```bash
pnpm install --frozen-lockfile
pnpm check:toolchain
pnpm generate:api
pnpm build
pnpm build:worker
```

控制面产物为 `apps/web/.output/`，启动入口是 `node apps/web/.output/server/index.mjs`。Worker 由 `apps/worker/cmd/worker` 构建为独立二进制。镜像应以不可变 digest 发布，并保留与数据库迁移、OpenAPI 和发布报告对应的版本标识。

## Secret 与配置

生产环境必须由 Secret 管理系统注入以下控制面变量：

- `DATABASE_URL`、`REDIS_URL`、`PUBLIC_ORIGIN`；
- `NUXT_SESSION_PASSWORD`，至少 32 个字符；
- `SUBMISSION_ANSWER_KEY`；
- `INSTANCE_SECRET_ACTIVE_KEY_ID` 与 `INSTANCE_SECRET_KEYS`；
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`；
- `MAIL_SMTP_*` 与 `MAIL_FROM`；
- 可选且必须成对配置的 `TURNSTILE_SECRET_KEY`、`TURNSTILE_SITE_KEY`；
- 可选的 `OTEL_*` 导出配置。

Worker 至少需要 `WORKER_ID`、`WORKER_DATABASE_URL`、`WORKER_ENABLED_PROVIDERS`、`INSTANCE_SECRET_KEYS` 和对应 Provider 配置。Docker 使用 Engine API；Kubernetes 使用 in-cluster 身份或受限 kubeconfig，并显式设置实例 namespace、路由域名和受控 TCP 范围。完整变量见 `.env.example` 和 `apps/worker/README.md`。

密钥不得写入 `platform_settings`、镜像层、日志、Git 或 Kubernetes 标签。轮换实例密钥时，在所有活动实例不再引用旧 key id 前保留旧密钥。

## 发布顺序

1. 备份 PostgreSQL 与版本化对象存储，并记录恢复点。
2. 将新镜像推送为不可变 digest，但先不接流量。
3. 使用控制面数据库所有者执行 `pnpm db:migrate`；迁移必须可重复执行。
4. 以数据库所有者执行 `deploy/postgres/worker-role.sql`，并把部署专用 LOGIN 授予 `sauryctf_worker`。
5. 启动控制面新副本，确认 `/api/health/live` 和 `/api/health/ready` 均成功后再接入流量。
6. 启动 Worker，确认 `/health/live`、`/health/ready` 和私有 `/metrics`；再逐步扩大并发。
7. 检查管理监控、邮件投递、实例队列、排行榜版本和 OTEL 信号，执行发布 smoke。
8. 旧控制面副本完成连接排空后下线；Worker 滚动退出时必须停止领取并安全释放租约。

发布候选必须先执行 `pnpm test:release`。该命令为 fail-fast 总门禁；任一冻结安装、OpenAPI 一致性、身份安全、容量指标、故障恢复、备份恢复、真实实例生命周期、类型检查或构建失败都会返回非零并阻止发布。Pull Request 工作流执行同一命令。

控制面和 Worker 都可横向扩容。控制面连接池总预算按“每副本连接上限 × 副本数”计算并低于 PostgreSQL 可用连接数；Worker 同时考虑 `WORKER_DATABASE_MAX_CONNECTIONS`、领取批量和任务并发，避免抢占控制面连接预算。

## Probes

控制面：

- live：`GET /api/health/live`；
- ready：`GET /api/health/ready`，验证部署配置、PostgreSQL 和迁移 journal 与当前构建完全一致。

Worker：

- live：`GET /health/live`；
- ready：`GET /health/ready`，验证限权角色、实例任务 schema 与已启用 Provider；
- metrics：`GET /metrics`，只在私网采集。

进程 live 但不 ready 时应保留进程供排障，但不得接收新流量或扩大任务并发。

## 回滚边界

应用回滚只能回到与当前数据库 schema 向后兼容的构建。新版本一旦产生正式提交、解题、计分调整、实例任务、审计或内容引用事实，就不得切换到旧单体、第二套数据库或另一条写路径。若旧构建不能理解当前 schema，应停止发布、恢复当前兼容构建，或从发布前恢复点执行完整灾难恢复；禁止用双写或人工改表拼接事实。
