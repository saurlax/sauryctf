## 1. NuxtHub 基础与无 Redis 配置契约

- [x] 1.1 在 `apps/web` 精确锁定经验证的 `@nuxthub/core`、`postgres` 和 Blob S3 driver 版本，启用 NuxtHub PostgreSQL module 并关闭 build/dev 自动迁移，以冻结安装和 `pnpm check` 验证依赖与类型生成
- [x] 1.2 实现 server-only 数据服务配置解析器，覆盖必需 `DATABASE_URL`、完整 S3、完全无 S3、partial S3、`NUXTHUB_BLOB_DIR` 与 `CONTROL_PLANE_REPLICA_COUNT`，并以 Vitest 验证所有选择矩阵及安全错误输出
- [x] 1.3 从部署配置 contract 与 readiness 输入中移除 `REDIS_URL`，使 PostgreSQL、所选 Blob 后端和其他业务 Secret 成为完整必需集合，并以无 Redis 环境的 readiness Vitest 验证
- [x] 1.4 更新 `.gitignore` 和构建配置排除 `apps/web/.data/`，增加构建产物 Secret 扫描测试，验证注入测试数据库/S3凭据后执行 `pnpm build` 不会在可发布文件中找到明文

## 2. Schema 与迁移接管

- [x] 2.1 将 PostgreSQL schema 移到 NuxtHub 扫描的 `apps/web/server/db/schema.ts`，将既有 SQL 原样迁入 `apps/web/server/db/migrations/postgresql/` 并更新 generation 配置，验证 schema 导出完整、历史 SQL hash 未变化且 `pnpm check` 通过
- [x] 2.2 生成并提交历史迁移清单、SQL hash 和关键 PostgreSQL schema 指纹，增加 Vitest 证明当前迁移的顺序、名称和内容发生漂移时会失败
- [x] 2.3 实现幂等、非交互的旧 Drizzle journal 接管命令，在单一事务中校验旧 journal 和 schema 后写入 `_hub_migrations`，并以成功接管、重复接管、缺失迁移、hash 不符和事务回滚 Vitest 验证
- [x] 2.4 将根 `pnpm db:migrate` 切换为与 NuxtHub 目录和 `_hub_migrations` journal 兼容的显式事务迁移执行器，按 `--> statement-breakpoint` 保留 PostgreSQL dollar-quoted 函数体并在失败时非零退出；以空库测试验证迁移只执行一次、已有基线库测试验证历史 DDL 不重放、未知 schema 测试验证迁移前失败
- [x] 2.5 更新控制面 readiness 的迁移验证逻辑，使其比较 `_hub_migrations` 与当前构建清单并在过渡期校验旧 journal 认领状态，以数据库定向 Vitest 和 `pnpm check` 验证

## 3. 控制面数据库访问迁移

- [x] 3.1 定义可被 NuxtHub `db` 与 transaction 对象共同实现的窄 executor port，建立使用 `postgres-js` 的可关闭集成测试工厂，并以事务提交、回滚、参数绑定和错误映射 Vitest 验证
- [x] 3.2 将身份、Session、通知、队伍和参赛仓储从 `pg.Pool` 迁移到 NuxtHub executor，验证默认管理员、邮箱安全、成员并发与报名事务测试以及 `pnpm check` 全部通过
- [x] 3.3 将比赛、公告、时间线、题库和挂题仓储迁移到 NuxtHub executor，验证发布检查、不可变快照、定时公告和比赛阶段测试以及 `pnpm check` 全部通过
- [x] 3.4 将提交、解题、计分重放、排行榜所需数据库查询迁移到 NuxtHub executor，验证行锁、唯一解、正式/练习隔离、封榜和并发计分测试以及 `pnpm check` 全部通过
- [x] 3.5 将内容、Writeup、比赛包、平台设置、审计、保留、运维和实例仓储迁移到 NuxtHub executor，验证邮件 outbox、垃圾回收、instance fencing、死信重放和权限测试以及 `pnpm check` 全部通过
- [x] 3.6 更新 Nitro 服务装配为单一 NuxtHub 数据库实例，确保事务内仓储不回退全局连接，并以连接数量、事务原子性、服务关闭和依赖故障 Vitest 验证
- [x] 3.7 移除 Web 运行时 `pg`、`drizzle-orm/node-postgres` 客户端与旧 migrator 的使用，运行边界搜索、数据库定向测试、`pnpm check` 和 `pnpm test` 验证不存在第二条数据库写路径
- [x] 3.8 重新应用 `deploy/postgres/worker-role.sql` 并运行 Worker 权限测试，验证 Go Worker 仍能操作获准实例表且不能读取身份、队伍、比赛、答案、提交、解题或排行榜数据

## 4. PostgreSQL 限流

- [x] 4.1 增加 PostgreSQL 限流窗口 migration 与 schema，使用 bucket 摘要、窗口起点、到期时间和计数的唯一键，并以 schema Vitest 验证不存储原始 IP、用户输入、凭据或 Flag
- [x] 4.2 实现基于 PostgreSQL 时间和原子 upsert 的限流 repository，使一次请求可在一次往返中消费多个策略，并以允许、拒绝、`Retry-After`、窗口切换、并发递增和事务失败 Vitest 验证
- [x] 4.3 将登录、注册、密码/邮箱安全操作和 Flag 提交限流切换到 PostgreSQL repository，删除进程内降级，以跨副本并发与模拟重启 Vitest 验证共享窗口不能被绕过
- [x] 4.4 将过期限流窗口纳入数据保留任务，使用有限批次删除并增加活跃窗口不受影响、重复清理幂等和大批量分段清理 Vitest
- [x] 4.5 在 PostgreSQL 集成环境运行热点 IP、热点题目与 200 次提交/秒容量测试，记录限流 SQL p95、锁等待和连接使用，只有满足发布阈值后完成本组

## 5. 排行榜与实时能力收缩

- [x] 5.1 增加多实例并发构建测试，证明相同比赛、视图、范围和版本的榜单通过 `scoreboard_snapshots_scope_version_unique` 与冲突后重读收敛为同一快照
- [x] 5.2 删除 Redis 排行榜 cache、cache port 和分布式 build lock，使读取只使用 PostgreSQL 快照与现有进程内 single-flight，并以 cache miss、重复读取、封榜、赛后榜单和多副本重复构建 Vitest 验证
- [x] 5.3 从运维 contract、管理 UI、领域服务、审计枚举和测试中删除 `cache_rebuild`，保留 `result_recalculate` 清理 PostgreSQL 快照并重算的能力，验证重算结果不再包含 Redis key 数量
- [x] 5.4 删除比赛事件 SSE 路由、public realtime contract、恢复窗口和相关 HTTP 测试；如现有榜单页面需要自动更新，则使用 Page Visibility 控制的 3–5 秒普通 HTTP 轮询，并以 fake timer Vitest 验证可见时刷新、后台与卸载时停止
- [x] 5.5 删除 Redis domain event publisher/subscriber、dispatcher 和提交/计分调整/公告中的广播专用 outbox 写入，保留身份通知与 `mail_deliveries` 的事务来源记录，并以邮件、站内通知和数据库无广播积压 Vitest 验证
- [x] 5.6 删除全部 Redis adapter、`redis` npm 依赖、`REDIS_URL`、Compose Redis 服务、Redis 监控与测试夹具，运行 `rg` 检查活动代码、配置、脚本和运维文档无 Redis 引用，并以冻结安装更新锁文件

## 6. NuxtHub Blob 与本机回退

- [x] 6.1 使用 NuxtHub 官方 Blob storage 及 `fs`/`s3` driver 实现 server-only 惰性单例工厂，确保驱动每个进程只选择一次且凭据不进入日志，并以配置、并发初始化 Vitest 和 `pnpm check` 验证
- [x] 6.2 实现 NuxtHub Blob 到内容存储 port 的适配器，覆盖 put、get、head、delete、list、Blob/ArrayBuffer 转换、媒体类型和自定义元数据，并以共享存储 contract tests 验证
- [x] 6.3 将附件、Logo、Writeup、比赛包、下载和垃圾回收服务切换到 NuxtHub Blob adapter，移除直接 AWS SDK 装配，并验证对象键、SHA-256、引用和 API 响应保持兼容
- [x] 6.4 增加本机 Blob 集成 Vitest，使用临时专用目录验证上传、授权下载、去重、重启后读取、垃圾回收、不可写目录不 ready 和测试退出后精确清理
- [x] 6.5 增加 MinIO S3 集成 Vitest，验证自定义 endpoint、上传/读取/列举/删除、S3 故障不回退 fs、partial S3 拒绝启动以及对象摘要保持一致
- [x] 6.6 增加安全回归测试，证明不存在通用 Blob 公开路由，猜测对象键、永久 S3 URL 和本机路径均不能绕过内容领域授权
- [x] 6.7 扩展 readiness 和管理监控投影，仅返回 `postgresql`、`fs|s3`、迁移与健康状态，验证响应和日志不含 Redis 字段、数据库 URL、bucket、endpoint、目录绝对路径或凭据
- [x] 6.8 实现清单驱动、幂等的 Blob 迁移命令，按已提交对象复制并校验大小与 SHA-256，增加中断重跑、缺失源对象、校验失败和成功切换前置检查 Vitest

## 7. 开发、备份与部署流程

- [x] 7.1 调整 `compose.dev.yml`，使默认开发依赖只启动 PostgreSQL 和 Mailpit，MinIO 作为显式 profile/集成测试依赖，并从空环境验证无 Redis、无 S3 时创建并复用本机 Blob 目录
- [x] 7.2 更新 `.env.example`，删除 `REDIS_URL`，说明 S3 成组配置、`NUXTHUB_BLOB_DIR`、`CONTROL_PLANE_REPLICA_COUNT` 和废弃的 `S3_FORCE_PATH_STYLE`，以配置示例 Vitest 验证默认 fs 与完整 S3 模板
- [x] 7.3 更新备份恢复脚本，分别实现“PostgreSQL + S3 bucket”和“PostgreSQL + 本机 Blob 目录”的一致恢复点、摘要校验和失败阻断，确认备份内容与恢复步骤均不包含 Redis
- [x] 7.4 更新生产部署、Runbook 和事故响应，写明 NuxtHub 显式迁移、旧 journal 接管、PostgreSQL 限流、无共享 cache/SSE、fs 单副本、S3 多副本、Blob 迁移和回滚步骤，并通过文档命令检查验证引用存在
- [x] 7.5 更新架构、开发依赖和 Worker 文档，明确 PostgreSQL 是唯一共享协调后端、NuxtHub 管理 Web DB/Blob、Worker 只使用受限 PostgreSQL 与 Provider，并运行 `pnpm check`

## 8. 集成与发布验收

- [x] 8.1 调整测试结构，使业务、数据库、配置、HTTP、安全、容量和故障断言尽量由 Vitest 执行，shell 只负责启动/清理 PostgreSQL、MinIO、Mailpit、Nitro、Worker 和 Provider 进程，并验证 `pnpm test` 可直接运行无外部依赖的测试
- [x] 8.2 更新 onboarding 和 Jeopardy smoke，使默认路径不启动 Redis 或 MinIO，并完成管理员、附件、比赛、提交、排行榜、Writeup 和动态实例闭环，运行对应脚本验证
- [x] 8.3 更新故障、安全与容量验收，覆盖 PostgreSQL/Blob/SMTP/Worker/Provider 失效、本机目录权限错误、PostgreSQL 限流热点和 1000 并发/200 提交每秒目标，删除 Redis 故障场景并运行对应验收脚本
- [x] 8.4 运行 `pnpm check`、`pnpm test` 和 `pnpm build`，确认控制面与 Worker 在依赖树、构建产物和运行配置中均无 Redis 引用且无意外 diff
- [x] 8.5 运行完整 `bash ./scripts/test-release-acceptance.sh`，确认空库、旧 journal 接管、PostgreSQL 限流、fs、S3、备份恢复、真实实例生命周期与 Secret 扫描全部通过后，记录 NuxtHub 版本、迁移基线和发布/回滚证据
