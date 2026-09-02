## Why

控制面目前同时自行装配 PostgreSQL、AWS S3 和 Redis，Redis 只承载可重建缓存、限流、短锁与未被前端使用的实时广播，却增加了本地开发、部署、监控和故障恢复成本。本变更以 NuxtHub 统一 PostgreSQL 与 Blob，并将仍有价值的限流迁入 PostgreSQL，彻底移除 Redis 运行依赖。

## What Changes

- 在 `apps/web` 启用 `@nuxthub/core` 的 PostgreSQL Database 与 Blob 能力，由 NuxtHub 负责控制面数据库客户端、schema 发现、迁移目录与 journal 约定和对象存储驱动装配；历史 PostgreSQL SQL 由项目的显式事务执行器安全应用并写入 NuxtHub `_hub_migrations`。
- **BREAKING**：控制面数据库访问从 `pg.Pool`/`drizzle-orm/node-postgres` 迁移到 NuxtHub 提供的 PostgreSQL Drizzle 客户端；领域事务、PostgreSQL 锁语义和 Go Worker 的独立数据库连接保持不变。
- **BREAKING**：数据库迁移 journal 从现有 Drizzle journal 安全切换到 NuxtHub `_hub_migrations`，提供已部署数据库的一次性迁移认领流程，禁止重新执行历史迁移；不直接使用会错误拆分 PostgreSQL dollar-quoted 函数体的 NuxtHub 0.10.8 CLI runner。
- 对象存储改用 NuxtHub Blob 统一接口。S3 环境变量完整配置时选择 S3 驱动；完全未配置时选择本机文件系统驱动；只配置部分 S3 变量时启动失败。
- **BREAKING**：删除 Redis 客户端、`REDIS_URL`、开发容器和运行时依赖，不以另一种共享 KV、Cache 或消息代理替代 Redis。
- 将身份、网络与 Flag 提交限流迁移到 PostgreSQL，确保多控制面副本共享限制并保留现有 429 与 `Retry-After` 语义。
- 删除 Redis 排行榜缓存和分布式构建锁；公开榜单以 PostgreSQL 版本与持久快照为准，同一进程只合并重复构建，多副本偶发重复计算通过数据库唯一约束收敛。
- **BREAKING**：删除未被 Web 客户端使用的比赛事件 SSE API、恢复窗口和 Redis Pub/Sub；需要自动更新的页面改用可见时的普通 HTTP 轮询。
- 删除只服务于 Redis 广播的领域事件投递和缓存重建运维命令；事务邮件与站内通知继续使用 PostgreSQL 持久记录。
- 调整就绪检查、备份恢复、开发依赖、发布流程和测试，使标准环境不再启动、配置、监控或备份 Redis。

## Capabilities

### New Capabilities

- `nuxthub-data-management`: 规定控制面通过 NuxtHub 管理 PostgreSQL 和 Blob，定义无 Redis 运行边界、PostgreSQL 限流、榜单读取、S3/本机存储选择、迁移兼容、持久性和部署约束。

### Modified Capabilities

无。现有能力仍位于未归档的 `rebuild-platform-with-nuxt-control-plane` change，本变更以独立能力收紧其数据服务与实时交互规则；归档时需要协调 `platform-boundaries`、`content-portability`、`request-security`、`scoreboards` 与 `public-realtime` 的相关表述。

## Impact

- Web：`apps/web/nuxt.config.ts`、依赖清单、数据库 schema/客户端/仓储/事务、限流、排行榜、事件 API、迁移命令、Blob 适配器和部署配置校验。
- API：删除比赛事件 SSE 路由；普通排行榜读取 API 保持，客户端通过版本化 HTTP 读取获得更新。
- 运维：移除 `REDIS_URL`、Redis 容器、监控与故障恢复；更新本机数据目录、数据库迁移 journal、备份恢复、健康检查和生产部署文档。
- Worker：继续直接连接 PostgreSQL，继续使用独立受限 LOGIN；不引入 Redis，也不增加控制面 HTTP 依赖。
- 外部依赖：增加 `@nuxthub/core` 及其 PostgreSQL/Blob 驱动依赖；移除 `redis`、直接 AWS S3 SDK 装配和独立 Redis 服务。
