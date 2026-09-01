## Why

当前代码在多轮局部生成后出现职责交叉、模型重复和接口行为漂移，继续在现有 Go 单体上叠加功能会扩大回归风险。需要以干净的新领域基线重建首期 Jeopardy 平台，将 Web 业务收敛到 Nuxt 控制面，并把 Go 缩减为私有动态实例 Worker。

## What Changes

- 建立只覆盖 Jeopardy 的首期领域基线，包括身份、队伍、比赛、题目、提交计分、排行榜、动态实例、附件、公告、Writeup、通知、审计和运维。
- 将 Nuxt 从纯 SSG 前端调整为 Nuxt/Nitro 模块化单体，统一承载页面、公开 API、认证授权、业务事务、缓存协调、SSE 和后台调度。
- 将 Go 服务调整为不面向公网的实例 Worker，只负责持久化实例任务、Docker/Kubernetes Provider 和资源对账。
- 将仓库整理为 monorepo：Nuxt/Nitro 控制面统一位于 `apps/web`，新的 Go 实例 Worker 统一位于 `apps/worker`；仓库根目录只保留工作区编排、共享契约、部署、文档和规格。
- 以 PostgreSQL 作为权威数据源；Redis 只承担缓存、速率限制、短锁和实时事件分发；S3 兼容存储保存权威内容对象。
- 使用 `nuxt-auth-utils` sealed Cookie Session，不建立服务端 Session 表；通过用户 `session_version` 支持改密、找回、封禁和角色变化后的全局失效。
- 采用邮箱必填与验证门槛、可配置 Turnstile、站内信与事务 Outbox 邮件，以及 `user`、`organizer`、`admin` 三种全局角色。
- 重新定义题库模板与比赛题目快照、强事务提交计分、封榜、赛后练习、排行榜缓存和动态实例任务协议。
- 采用干净重建：不迁移旧账号、Session、比赛运行事实或未声明 API 行为；现有代码和 smoke flow 仅作为行为参考与回归输入。
- 明确首期不实现 AWD，也不把 AWD 保留为题目分类；AWD 由独立 `add-awd-competition` change 设计和实施。
- 个人训练、OIDC、平台 MCP、动态附件、Checker/Bot 判题和 Challenge Gateway 抓包保留为后续非 AWD 能力，不进入本 change 的首期任务。
- **BREAKING**：生产部署从“静态 Nuxt + 公网 Go API”变为“Nuxt/Nitro 控制面 + 私有 Go Worker + PostgreSQL + Redis + 对象存储”。
- **BREAKING**：旧浏览器会话全部失效；公开接口只承诺本 change 声明的新契约。
- **BREAKING**：旧数据库不原位迁移，目标环境从新的 PostgreSQL schema 启动。

## Capabilities

### New Capabilities

- `platform-boundaries`: 定义 Nuxt 控制面、Go 实例 Worker、PostgreSQL、Redis、对象存储、浏览器和题目数据面之间的职责及信任边界。
- `identity-access`: 定义 sealed Cookie Session、邮箱验证、密码安全、CSRF、Turnstile、全局角色、默认管理员治理和安全通知。
- `teams-participation`: 定义队伍成员关系、队长权限、邀请、比赛报名审核、分组和赛中成员锁定。
- `contest-management`: 定义仅 Jeopardy 的比赛生命周期、时间窗口、可见性、报名、公告、公开时间线、封榜、练习模式和发布约束。
- `challenge-management`: 定义题库模板、比赛题目快照、Jeopardy 分类、Flag 策略、附件、提示、动态资源配置和发布冻结。
- `submission-scoring`: 定义 Flag 校验、提交限流、唯一解、动态计分、首解、练习解、反作弊线索和事务一致性。
- `scoreboard-realtime-cache`: 定义排行榜读模型、封榜视图、实时事件、缓存失效、重建和 Redis 故障降级。
- `instance-orchestration`: 定义动态实例期望状态、`instance_jobs`、Worker 领取、Docker/Kubernetes Provider、租约、销毁和对账。
- `content-portability`: 定义附件与对象存储、Writeup、比赛导入导出、数据保留和安全下载。
- `administration-observability`: 定义平台设置、全局管理、审计、通知投递、监控、日志、指标、追踪、健康检查、备份和运维操作。

### Modified Capabilities

无。仓库此前没有 OpenSpec 主规范，本变更建立首期 Jeopardy 平台基线。

## Impact

- `apps/web/` 将承载包含 Nitro API、领域模块、Drizzle 数据访问、`nuxt-auth-utils`、Outbox 和后台调度的控制面应用。
- `apps/worker/` 将成为唯一 Go 应用，承载实例任务领取器、Provider 和 Reconciler；现有 Go 公网单体迁入明确的临时遗留区，并在切换前完整退役，不能成为 Worker 的运行时依赖。
- `api/openapi.yaml` 将由共享运行时 Schema 重新生成，旧响应细节不作为兼容目标。
- 新 PostgreSQL schema 涉及用户、凭证、邮箱令牌、通知、队伍、参赛、比赛题目快照、提交、解题、排行榜、实例任务、内容和审计表，不包含 AWD 表。
- 生产部署新增 Redis、S3 兼容对象存储、Nuxt 控制面和私有 Go Worker 的独立身份、网络策略与扩缩配置。
- 首期按 300 支队伍、1000 名并发选手、1000 个运行实例和 200 次提交每秒短时峰值进行容量验收。
