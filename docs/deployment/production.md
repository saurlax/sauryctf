# 生产部署

## 拓扑与网络边界

Nuxt/Nitro 控制面是唯一公网业务入口，负责页面、API、认证授权、事务、PostgreSQL 协调、Blob、邮件和控制面定时任务。Go Worker 只能从私网访问 PostgreSQL、Docker Engine 或 Kubernetes API，不得通过 Ingress 暴露。

PostgreSQL 保存权威业务事实并承担跨副本协调；NuxtHub 管理 S3 兼容或本机 Blob 中的权威内容对象；SMTP 只承担事务邮件投递。题目 HTTP/TCP 流量由 Gateway/Ingress/Service 直接送达实例，不能经过控制面或 Worker。

建议网络策略：

- 公网只允许访问控制面和明确发布的题目入口；
- 控制面可访问 PostgreSQL、所选 Blob 后端、SMTP 和 OTLP Collector；
- Worker 可访问 PostgreSQL 和启用的 Provider API，不可访问身份凭据表对应的业务权限；
- PostgreSQL、S3 管理端、Docker socket 和 Kubernetes 管理面只允许受信工作负载访问；
- 题目实例默认不能访问控制面、数据库、对象存储或 Kubernetes 管理面。

## 构建产物

使用仓库固定的 Node、pnpm 和 Go 版本：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

控制面产物为 `apps/web/.output/`，启动入口是 `node apps/web/.output/server/index.mjs`。Worker 由 `apps/worker/cmd/worker` 构建为独立二进制。镜像应以不可变 digest 发布，并保留与数据库迁移和发布报告对应的版本标识。

## Secret 与配置

生产环境必须由 Secret 管理系统注入以下控制面变量：

- `DATABASE_URL`；
- `NUXT_PUBLIC_SITE_URL` 是浏览器同源校验和邮件绝对链接共用的站点根地址；未配置时默认 `http://localhost:3000`，生产环境必须显式设置为实际 HTTPS 地址；
- `RATE_LIMIT_BYPASS` 应在生产环境显式设置为 `false`。未配置时默认 `local`，仅对回环来源绕过全部限流；`private` 对回环与私网来源、`true` 对所有来源绕过限流。它不会关闭 Turnstile、同源、CSRF、认证、授权或输入校验；若同时启用 `TRUST_PROXY`，入口代理必须清洗客户端提供的 `X-Forwarded-For`；
- `NUXT_SESSION_PASSWORD`，至少 32 个字符；
- `SUBMISSION_ANSWER_KEY`；
- `INSTANCE_SECRET_ACTIVE_KEY_ID` 与 `INSTANCE_SECRET_KEYS`；
- `CONTROL_PLANE_REPLICA_COUNT`，以及二选一的 Blob 配置：单副本 fs 使用持久卷上的 `NUXTHUB_BLOB_DIR`；共享 S3 必须成组配置 `S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`，`S3_ENDPOINT` 仅用于兼容服务；
- `MAIL_SMTP_*` 与 `MAIL_FROM`；
- 可选且必须成对配置的 `TURNSTILE_SECRET_KEY`、`TURNSTILE_SITE_KEY`；
- 可选的 `OTEL_*` 导出配置。

Worker 至少需要 `WORKER_ID`、`WORKER_DATABASE_URL`、`WORKER_ENABLED_PROVIDERS`、`INSTANCE_SECRET_KEYS` 和对应 Provider 配置。Docker 使用 Engine API；Kubernetes 使用 in-cluster 身份或受限 kubeconfig，并显式设置实例 namespace、路由域名和受控 TCP 范围。完整变量见 `.env.example` 和 `apps/worker/README.md`。

密钥不得写入 `platform_settings`、镜像层、日志、Git 或 Kubernetes 标签。轮换实例密钥时，在所有活动实例不再引用旧 key id 前保留旧密钥。

## 发布顺序

1. 按当前 `fs|s3` 驱动备份 PostgreSQL 与权威 Blob，并记录同一恢复点和摘要清单。
2. 将新镜像推送为不可变 digest，但先不接流量。
3. 新数据库直接使用控制面数据库所有者执行 `pnpm db:migrate`。已部署且只有旧 `control_plane.__drizzle_migrations` journal 的数据库，先在备份后运行 `pnpm --filter sauryctf-web exec tsx server/db/takeover-cli.ts`；接管会验证旧 SQL hash 和 schema 指纹，只认领历史迁移，不重放 DDL。随后执行 `pnpm db:migrate`。构建和应用启动均不得隐式迁移。
4. 以数据库所有者执行 `deploy/postgres/worker-role.sql`，并把部署专用 LOGIN 授予 `sauryctf_worker`。
5. 启动控制面新副本，确认 `/api/health/live` 和 `/api/health/ready` 均成功且安全投影显示 `postgresql/current` 与预期 `fs|s3` 后再接入流量。
6. 启动 Worker，确认 `/health/live`、`/health/ready` 和私有 `/metrics`；再逐步扩大并发。
7. 检查管理监控、邮件投递、实例队列、排行榜版本和 OTEL 信号，执行发布 smoke。
8. 旧控制面副本完成连接排空后下线；Worker 滚动退出时必须停止领取并安全释放租约。

发布候选必须先执行 `bash ./scripts/test-release-acceptance.sh`。该脚本为 fail-fast 总门禁；任一冻结安装、契约测试、身份安全、容量指标、故障恢复、备份恢复、真实实例生命周期、类型检查或构建失败都会返回非零并阻止发布。Pull Request 工作流执行同一脚本。

S3 模式下控制面可横向扩容；fs 是权威存储时必须挂载持久卷并保持 `CONTROL_PLANE_REPLICA_COUNT=1`。控制面连接池总预算按“每副本连接上限 × 副本数”计算并低于 PostgreSQL 可用连接数；Worker 同时考虑 `WORKER_DATABASE_MAX_CONNECTIONS`、领取批量和任务并发，避免抢占控制面连接预算。

安全限流由 PostgreSQL 原子窗口承担。平台没有共享 cache、消息代理或比赛事件 SSE；排行榜以 PostgreSQL 版本和快照为准，需要自动更新的页面只在可见时进行普通 HTTP 轮询。

## Blob 迁移与切换

禁止通过只改环境变量热切换权威 Blob。先保留源端，设置 `BLOB_MIGRATION_SOURCE_DRIVER`、`BLOB_MIGRATION_TARGET_DRIVER` 及对应的 `_DIR` 或完整 `_S3_*` 配置，然后运行：

```bash
pnpm --filter sauryctf-web blob:migrate
```

命令从 PostgreSQL 读取全部已提交对象，幂等复制并在目标端重新校验大小和 SHA-256。只有输出 `Target is ready to switch` 后，才可停止内容写入、更新正式 Blob 配置并滚动发布。切换后的 readiness 必须显示目标驱动 ready；源端至少保留一个回滚窗口。

## Probes

控制面：

- live：`GET /api/health/live`；
- ready：`GET /api/health/ready`，验证部署配置、PostgreSQL、迁移 journal 与当前构建完全一致，并探测所选 Blob；响应只显示后端种类与状态。

Worker：

- live：`GET /health/live`；
- ready：`GET /health/ready`，验证限权角色、实例任务 schema 与已启用 Provider；
- metrics：`GET /metrics`，只在私网采集。

进程 live 但不 ready 时应保留进程供排障，但不得接收新流量或扩大任务并发。

## 回滚边界

应用回滚只能回到与当前数据库 schema 向后兼容的构建。回滚窗口内保留旧 Drizzle journal、旧 outbox 列和源 Blob；不得删除 `_hub_migrations` 或反向重放迁移。Blob 切换失败时先停止内容写入，将配置恢复到仍完整保留的源端并验证摘要与 readiness。新版本一旦产生正式提交、解题、计分调整、实例任务、审计或内容引用事实，就不得切换到旧单体、第二套数据库或另一条写路径。若旧构建不能理解当前 schema，应停止发布、恢复当前兼容构建，或从发布前恢复点执行完整灾难恢复；禁止用双写或人工改表拼接事实。
