## Context

参见 [proposal.md](./proposal.md) 的动机和 [nuxthub-data-management spec](./specs/nuxthub-data-management/spec.md) 的行为约束。当前控制面以 `pg.Pool` 注入仓储，使用 `drizzle-orm/node-postgres` 执行显式迁移，通过 AWS SDK 自建 S3 适配器，并为限流、公开榜单缓存、排行榜构建短锁、领域事件广播与 SSE 恢复维护一套 Redis 客户端。

PostgreSQL 已保存全部权威业务事实、排行榜版本和唯一版本快照；Redis 故障时限流会退回进程内存，排行榜会回源 PostgreSQL，构建锁会降级为重复计算。Redis 事件总线没有通用消费者，Web 客户端也没有使用比赛事件 SSE。因此，Redis 的大部分职责可以直接删除，只有跨副本安全限流需要迁移。

本设计必须保留 PostgreSQL 的事务、行锁、`FOR UPDATE SKIP LOCKED`、约束和 Worker 共享语义。NuxtHub 的 PostgreSQL 自动回退 PGlite 不适用于本平台。NuxtHub Blob 自动配置可能在 prepare/build 阶段解析环境并生成驱动参数，因此生产 Secret 和 S3/本机运行时选择仍需由 server-only 装配层保护。

## Goals / Non-Goals

**Goals:**

- 让 Web 控制面统一使用 NuxtHub 的 PostgreSQL Drizzle schema、客户端、迁移目录与 `_hub_migrations` journal 约定。
- 让内容基础设施统一使用 NuxtHub Blob API 与官方 `fs`/`s3` 驱动，并在 Nitro 启动时只选择一次后端。
- 完全删除 Redis 服务、客户端、配置、监控、故障恢复和测试夹具，不以另一种共享 KV 或消息代理替代。
- 将跨副本安全限流迁入 PostgreSQL，保留现有 HTTP 限流语义。
- 让排行榜只依赖 PostgreSQL 事实、版本、快照和进程内 single-flight。
- 删除未使用的 SSE/事件广播能力，让标准开发环境只需要 PostgreSQL、可选 SMTP 和一个 Blob 后端。
- 保持 Go Worker 无状态并继续只通过受限 PostgreSQL 表与控制面解耦。

**Non-Goals:**

- 不保留比赛事件 SSE、断线事件恢复窗口或通用领域 Pub/Sub。
- 不用 NuxtHub KV/Cache、Redis 兼容服务或其他消息代理替代 Redis。
- 不承诺消除多控制面副本之间无害的重复榜单计算。
- 不把数据库改为 SQLite、PGlite、D1、MySQL、Neon HTTP 或其他方言。
- 不让 NuxtHub 托管 Go Worker，不改变 Worker 的 Provider、`pgx` 或数据库角色。
- 不自动搬运已有内容对象，不支持运行中热切换存储驱动。
- 不增加公开 Blob 浏览或直出路由，不改变内容授权语义。

## Decisions

### 1. 固定 PostgreSQL 方言和 postgres-js 驱动

`apps/web` 精确锁定经验证的 `@nuxthub/core`、`postgres`、`drizzle-orm`、`drizzle-kit` 和 Blob S3 驱动依赖。Nuxt 配置启用 `@nuxthub/core`，数据库明确声明 PostgreSQL、`postgres-js`，并关闭 build/dev 自动迁移。显式指定驱动防止没有 `DATABASE_URL` 的构建阶段选择 PGlite；部署配置和 readiness 继续把 `DATABASE_URL` 作为必填项。

控制面仓储从 `pg.Pool` 改为接受一个可由 NuxtHub `db` 与 transaction 对象共同实现的窄 executor。普通查询优先使用生成 schema；依赖 PostgreSQL 锁、CTE、JSON、通知或性能特性的语句使用 Drizzle `sql`。事务统一通过 `db.transaction()` 传递 transaction-scoped executor，禁止仓储在事务内部回到全局 `db`。

集成测试使用相同的 `postgres-js` 驱动、schema 和临时 PostgreSQL URL 创建可关闭客户端，不依赖 Nuxt 全局单例。

**Alternatives considered:** 保留 `pg.Pool` 只让 NuxtHub 执行迁移无法统一数据库管理入口；改用 PGlite 会破坏 Worker 共享、并发锁和 PostgreSQL 权限测试；长期维护两种 Web 客户端会增加连接预算和事务误用风险。

### 2. Schema 和迁移迁入 NuxtHub 约定目录，但保持 SQL 历史不变

Drizzle schema 移到 `apps/web/server/db/schema.ts`，现有 PostgreSQL SQL 文件按原文件名和内容迁入 `apps/web/server/db/migrations/postgresql/`；后续使用 `nuxt db generate` 生成同一目录的迁移。关闭 build/dev 自动迁移。NuxtHub 0.10.8 的 `nuxt db migrate` 会按分号错误拆分 PostgreSQL dollar-quoted PL/pgSQL 函数体，并在迁移失败时可能返回成功退出码，因此根命令 `pnpm db:migrate` 使用项目的非交互显式执行器：从 NuxtHub 目录读取 SQL，按已提交的 Drizzle `--> statement-breakpoint` 边界拆分，在每个迁移的单一事务内执行，成功后写入 NuxtHub `_hub_migrations`。执行器必须在任一语句失败时返回非零退出码且不得记录该迁移。

新增一次性的 journal 接管命令：

1. 空库不做认领，直接由项目执行器按 NuxtHub 迁移清单顺序执行全部迁移。
2. 旧库读取 `control_plane.__drizzle_migrations`，校验迁移数量、SQL hash、关键 schema 指纹和当前构建基线。
3. 在单一 PostgreSQL 事务中创建 `_hub_migrations` 并写入已确认的历史文件名；已有相同条目视为成功，不删除旧 journal。
4. 任一校验不一致则在写入前失败。

readiness 检查 `_hub_migrations` 与当前构建迁移清单完全一致；过渡期仍检查旧 journal 与认领标记的一致性。

**Alternatives considered:** 直接调用 NuxtHub 0.10.8 runner 会拆坏现有 dollar-quoted PL/pgSQL，且失败退出码不可靠；改写或 squash 历史 SQL 会破坏 hash 与已部署基线；patch `node_modules` 会引入不可审计的安装期差异；重放历史 DDL 可能重复执行数据变换或锁大表；交互式 mark-as-migrated 无法验证旧 journal；继续使用旧 Drizzle journal 会永久保留双 journal。

### 3. Blob 使用 NuxtHub 官方运行时 API

`hub.blob` 不接收生产凭据的构建期自动配置。基础设施层建立 server-only、进程级惰性工厂，使用 NuxtHub 官方 Blob storage 与 `fs`/`s3` driver，并在首次访问前完成严格配置解析。

| S3 配置 | 驱动 | 结果 |
| --- | --- | --- |
| access key、secret、bucket、region 均存在；endpoint 可选 | `s3` | 使用 S3 |
| 五个变量均缺失或为空 | `fs` | 使用本机目录 |
| 其他任意组合 | 无 | 配置错误，进程不 ready |

本机目录由 `NUXTHUB_BLOB_DIR` 覆盖，默认解析为 `apps/web/.data/blob`。`.data/` 被 Git 和构建排除；容器化单机部署必须挂载持久卷。配置校验使 `fs + CONTROL_PLANE_REPLICA_COUNT > 1` 失败。适配器继续实现领域所需的 put/get/head/delete/list 能力，对象键保持不变，下载继续从授权后的控制面流式返回。

**Alternatives considered:** 构建期自动配置可能固化驱动与凭据；保留 AWS SDK 再增加 fs 适配器会绕开 NuxtHub；按请求动态选择驱动会把对象分裂到不同后端。

### 4. Redis 完整删除且不引入替代服务

删除 `redis` npm 依赖、全部 Redis adapter、`REDIS_URL`、Compose Redis 服务、Redis readiness、监控、备份说明和故障演练。NuxtHub KV/Cache、Nitro Redis storage 或另一个共享消息代理不进入部署依赖。

进程内状态只允许用于不影响正确性的优化，例如同一进程合并并发榜单构建。它不得保存跨请求必须持久、跨副本必须一致或重启后必须保留的数据。

**Alternatives considered:** 把 Redis 改由 NuxtHub module 管理仍保留了外部服务与故障面；把所有 Redis 能力迁到另一个 KV 只更换名称，没有简化架构。

### 5. 限流迁入 PostgreSQL

新增限流窗口表，键由现有 scope、action 和身份摘要组成，只保存 SHA-256 摘要，不保存原始 IP、用户输入、凭据或 Flag。窗口起点与到期时间使用 PostgreSQL 时间计算，避免多副本时钟漂移；唯一键由 bucket 摘要与窗口起点组成。

一次请求需要消费多个策略时，repository 在一次数据库往返中使用 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` 原子递增所有 bucket，并以最严格的拒绝结果生成 429 与 `Retry-After`。计数消费成功但后续业务失败时不回退额度，这是抵御重试攻击的保守语义。数据库错误返回稳定的服务不可用错误，不再降级到内存。

数据保留任务按到期时间分批删除旧窗口。容量测试覆盖热点 IP、热点题目和 200 次提交/秒，必要时只增加索引或网关预过滤，不改变 PostgreSQL 的应用级最终判定。

**Alternatives considered:** 进程内限流可被跨副本和重启绕过；删除应用限流会削弱登录、重置和 Flag 接口保护；把所有限制交给网关无法表达用户与题目维度。

### 6. 排行榜删除共享缓存和分布式构建锁

删除 `ScoreboardProjectionCache` 的 Redis 实现、Redis 构建锁和 Redis 专用 `cache_rebuild` 运维命令。读取流程先根据 PostgreSQL `scoreboard_versions` 确定版本，再读取 `scoreboard_snapshots`；快照不存在时从正式事实构建。

同一 Nitro 进程继续使用现有 in-flight map 合并同 key 构建。不同副本可以同时计算，但 `scoreboard_snapshots_scope_version_unique` 保证相同比赛、视图、范围和版本只有一个持久快照。持久化使用 `ON CONFLICT DO NOTHING` 后重新读取获胜快照，确保并发请求返回同一数据库结果。

`result_recalculate` 运维命令继续清理 PostgreSQL 快照并重新计算；结果不再包含 Redis key 数量。`cache_rebuild` 从 contract、管理 UI、领域服务和审计允许枚举中删除。

**Alternatives considered:** PostgreSQL advisory lock 可以减少重复计算，但当前唯一约束已保证正确性，增加锁协议收益有限；Nitro 共享 cache 会重新引入外部依赖。若容量回归证明重复计算不可接受，再以独立变更增加 PostgreSQL advisory lock。

### 7. 删除 Redis Pub/Sub、SSE 和只用于广播的事件

删除比赛事件 SSE 路由、public realtime contract、Redis publisher/subscriber、最近 1000 条恢复窗口和 domain outbox dispatcher。前端当前没有 `EventSource` 消费者；需要自动刷新的榜单页面使用普通 HTTP，并通过 Page Visibility 在后台或卸载时停止 3–5 秒轮询。

删除提交、计分调整和公告中只用于 Redis 广播的 domain outbox 写入。身份安全邮件与站内通知仍在同一数据库事务中创建来源事件、`notifications` 和 `mail_deliveries`；邮件 dispatcher 继续直接通过 `FOR UPDATE SKIP LOCKED` 从 PostgreSQL 领取。

为保留已部署数据库的回滚能力，本变更不立即删除 `domain_outbox` 的旧投递列或旧 journal；新代码不扫描或更新 Redis 投递状态。至少一个发布回滚窗口后，可单独清理无引用的广播事件和遗留列。

**Alternatives considered:** PostgreSQL `LISTEN/NOTIFY` 加事件恢复表可以保留 SSE，但前端没有使用该能力，不值得维护长连接、恢复游标和跨副本广播；定时扫描 outbox 再广播只是把 Redis 消费者改成数据库消费者，仍保留无业务价值的事件面。

### 8. 配置、健康检查与开发编排共享无 Redis 基线

server-only 配置解析器统一产生 PostgreSQL 方言、Blob 驱动与安全诊断；不再解析或显示 Redis 配置。readiness 只验证必需配置、PostgreSQL/迁移和所选 Blob 后端。安全诊断不输出数据库 URL、S3 endpoint、bucket、绝对目录或凭据。

默认 Compose 启动 PostgreSQL 和 Mailpit；MinIO 保留为显式 S3 集成测试或可选 profile。Worker 继续需要 PostgreSQL 和 Docker/Kubernetes Provider，但不连接 Redis。onboarding、容量、安全、故障和备份测试均从环境中完全移除 Redis。

**Alternatives considered:** 保留一个可选 Redis profile 会延续两套运行路径和测试矩阵；readiness 忽略已配置但不可用的 Redis 会造成误解，因此配置本身也必须删除。

### 9. 本机 Blob 成为受约束的权威后端

选择 fs 时，数据库仍保存对象键、摘要、大小、媒体类型、状态和引用，文件目录只保存不可变内容体。本机备份必须捕获数据库与 Blob 目录的一致恢复点；恢复后验证数据库摘要与文件内容，未通过前不 ready。

存储迁移命令按数据库中的已提交对象清单复制到目标后端，验证大小和 SHA-256，支持幂等重跑，并在全部通过后才允许切换环境变量。源后端在保留窗口结束前不删除。

**Alternatives considered:** 把本机路径写入数据库会泄漏部署细节并阻碍迁移；启动时自动复制会造成不可预测的启动时间和失败恢复。

## Risks / Trade-offs

- [PostgreSQL 限流增加写入与热点行竞争] → 一次往返批量消费策略，使用短小索引记录和到期清理，并以 200 次提交/秒容量门禁验证。
- [删除共享榜单锁会增加多副本重复计算] → 依赖版本快照唯一约束收敛结果，容量测试衡量额外负载，只有证据不足时才引入 PostgreSQL advisory lock。
- [删除 SSE 后榜单更新延迟取决于轮询间隔] → 可见页面采用 3–5 秒轮询，响应携带版本，后台立即停止；该延迟仍低于首期 5 秒排行榜目标。
- [旧外部 SSE 客户端失效] → 将路由删除标记为 breaking，在发布说明中要求改用排行榜 GET；仓库不再承诺 OpenAPI 兼容。
- [移除 Redis 后 PostgreSQL 成为更集中的依赖] → readiness、连接预算、慢查询和容量门禁覆盖新增限流流量，业务本来已无法在 PostgreSQL 故障时正确写入。
- [双 journal 接管或自管 runner 错误会使 schema 漂移] → 接管前备份、hash 与 schema 指纹验证、逐迁移事务、失败非零退出和空库/旧库/未知库验收，旧 journal 至少保留一个发布周期。
- [本机 Blob 丢失即丢失权威内容] → 强制持久卷、单副本检查、备份恢复验收，并在管理监控显示 fs 模式。
- [NuxtHub API 仍在演进] → 精确锁版本，围绕数据库与 Blob port 编写契约测试，升级依赖单独验证。

## Migration Plan

### Phase 0：建立兼容性和容量基线

1. 精确锁定 NuxtHub 和驱动版本，增加 DB/Blob 最小契约测试。
2. 为现有迁移生成固定清单、hash 和 schema 指纹。
3. 记录 Redis 移除前限流、排行榜和提交容量基线，并确认仓库没有 EventSource 消费者。

**Rollback:** 尚未改变运行路径，删除新增依赖和测试即可。

### Phase 1：切换数据库客户端、迁移与限流

1. 迁移 schema 和 Web 仓储/事务到 NuxtHub PostgreSQL 客户端。
2. 对空库执行全量迁移；对旧库执行 journal 接管。
3. 增加 PostgreSQL 限流表与 adapter，先切换全部限流调用并完成安全、并发和容量测试。

**Rollback:** 新限流表是附加 schema；旧镜像可继续使用 Redis，旧 Drizzle journal 和旧环境变量保留到本阶段验收完成。

### Phase 2：删除 Redis 功能路径

1. 删除排行榜 Redis cache/build lock 与 `cache_rebuild`，验证唯一快照并发收敛。
2. 删除 Redis domain event dispatcher、广播专用写入、SSE 路由和 public realtime contract；为需要的页面增加受控 HTTP 轮询。
3. 删除 Redis adapter、依赖、环境变量、Compose 服务、readiness、监控和测试夹具。

**Rollback:** 回滚窗口内保留旧数据库投递列和可重新注入的旧 Redis 配置；回滚到旧镜像时重新提供 Redis。新代码不对 Redis 写入任何数据，因此不存在反向数据迁移。

### Phase 3：切换 Blob

1. 接入 NuxtHub Blob adapter 和配置矩阵，先以现有 S3 环境验证对象摘要。
2. 启用无 S3 的 fs 路径、持久卷约束、备份恢复和存储迁移命令。
3. 更新默认开发编排与两种后端 acceptance tests。

**Rollback:** S3 部署可回到旧 AWS SDK adapter；已经写入 fs 的部署必须先用显式迁移命令复制到 S3，旧版本不能直接读取本机 Blob。

### Phase 4：发布

1. 运行完整 release acceptance，确认环境和构建产物不包含 Redis 引用或数据库/S3 Secret。
2. 对现有环境备份并执行 journal 接管与 `pnpm db:migrate`，再部署控制面。
3. 检查 readiness 的 PostgreSQL、迁移和 Blob 状态，完成无 Redis onboarding、容量、安全、故障、备份和真实实例生命周期验收。
4. 保留旧镜像、旧 journal、旧 outbox 投递列和源对象后端至少一个回滚窗口，再以独立变更清理遗留数据库列。
