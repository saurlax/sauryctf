## Context

参见 [proposal.md](./proposal.md) 的动机。当前仓库是根目录 Go 单体加 `frontend/` Nuxt 纯 SSG：Go 同时拥有 HTTP、认证、业务数据库、计分、清理循环和实例 Provider，Nuxt 通过 `/api/**` 调用它。现有实现只作为行为参考；目标平台从新的 PostgreSQL schema 干净启动，不迁移旧账号、Session、比赛运行事实或未声明 API 行为。目标仓库采用 monorepo，活动应用只位于 `apps/web` 与 `apps/worker`。

首期只实现 Jeopardy。AWD 不保留为题目分类，不创建 AWD 表、API、调度、网络或 UI；完整 AWD 设计位于独立 `add-awd-competition` change。

目标拓扑：

```text
                         +----------------------+
Browser ---------------->| Nuxt 4 / Nitro       |
                         | control plane        |
                         | UI + API + Auth      |
                         | Domain + Outbox      |
                         +----+--------+--------+
                              |        |
                       SQL tx |        | cache / pub-sub
                              v        v
                         +---------+  +---------+
                         |PostgreSQL|  |  Redis  |
                         +----+----+  +---------+
                              |
                    claim jobs|write observations
                              v
                         +----------------------+
                         | Go instance worker   |
                         | reconciler/providers |
                         +------+----------+----+
                                |          |
                                v          v
                            Docker API  Kubernetes API

Content: Nuxt <----------> S3-compatible storage
Challenge traffic: Player <----> Gateway/Ingress/Service
```

## Goals / Non-Goals

**Goals:**

- 以 Nuxt/Nitro 模块化单体承载所有公网 Web 业务，消除前后端 DTO、鉴权和接口语义漂移。
- 让 Go Worker 成为无公网业务接口、只处理动态实例期望状态的基础设施执行器。
- 用 PostgreSQL 事务、不可变事实、可重建读模型和持久化实例任务保证一致性。
- 建立邮箱安全、全局角色、站内通知、邮件 Outbox、Jeopardy 全流程与生产运维基线。
- 在 300 队、1000 并发用户、1000 实例和 200 提交/秒短峰值下满足首期验收目标。

**Non-Goals:**

- 不迁移或兼容旧数据库、旧 Session、旧 API 响应细节和旧 Go 业务写路径。
- 不实现 AWD、混合赛制、AWD 题目分类、VPN、终端网关或 Checker 调度。
- 不实现多租户、比赛级权限、设备会话管理或后台集成令牌。
- 个人训练、OIDC、平台 MCP、动态附件、异步 Checker/Bot 和 Challenge Gateway 抓包不进入首期任务。
- 不让 Nuxt 或 Worker承载题目 HTTP/TCP 数据面流量。
- 不在首期实现 Kubernetes Operator/CRD。

## Decisions

### 1. Nuxt/Nitro 作为唯一公网控制面

`apps/web/` 演进为可部署 Nuxt 服务。稳定介绍页可预渲染，比赛、控制台和管理页面通过 Nitro API 和 SSR/CSR 获取动态状态。`apps/worker/` 是独立 Go module，只包含私有实例 Worker。仓库根目录统一管理 pnpm workspace、Go workspace、生成命令、部署、共享契约、文档和 OpenSpec；应用不得在根目录散落业务源码。建议边界：

```text
apps/
  web/
    app/
    server/
      api/                       # 薄 H3 适配层
      middleware/                # request id、session、csrf、rate limit
      domains/
        identity/
        teams/
        contests/
        challenges/
        submissions/
        scoreboards/
        instances/
        content/
        notifications/
        administration/
      infrastructure/
        db/
        cache/
        events/
        mail/
        storage/
        telemetry/
      jobs/                      # outbox、缓存和保留策略作业
    shared/contracts/
    db/migrations/
  worker/
    cmd/worker/
    internal/jobs/
    internal/reconcile/
    internal/providers/docker/
    internal/providers/kubernetes/
legacy/
  go-monolith/                  # 只读迁移参考；不得被活动应用依赖，切换前删除
```

页面不得访问数据库；API Handler 只完成协议映射；领域服务拥有授权和事务规则；基础设施适配器不得反向依赖页面或 Handler。pnpm workspace SHALL 只把 `apps/web` 作为 Web 应用包；Go workspace SHALL 只把 `apps/worker` 作为目标运行 module。边界检查 SHALL 拒绝 `apps/worker` 导入遗留 Go 单体或 Web 业务领域。

**Alternatives considered:** 保持纯 SSG 会继续维护两套业务与鉴权；Node 微服务会提前引入分布式事务；全部改为 Node 会失去 Go 与 Kubernetes 长期 Reconcile 的优势。

### 2. PostgreSQL 保存事实，Redis 只保存派生状态

TypeScript 使用 Drizzle schema/migrations、`node-postgres` 和显式事务。常规 CRUD 使用类型化查询；提交计分、成员并发变更、报名、版本推进和任务创建使用唯一约束、行锁和必要原生 SQL。标准集成测试使用临时 PostgreSQL，SQLite 不作为正式语义适配器。

Redis 只保存 cache-aside 读模型、限流桶、短锁和 SSE 扇出。Redis 清空或不可用不得改变身份、权限、成绩、实例所有权或任务状态。S3 兼容存储保存权威文件，应用本地磁盘只允许临时处理。

目标环境从空 schema 执行可审计迁移，不运行旧表回填、双读、影子比对或兼容路由。

**Alternatives considered:** Prisma 对普通 CRUD 友好，但计分和任务队列仍需大量原生事务；双数据库方言会削弱锁语义；兼容迁移会把未经确认的旧行为重新固化。

### 3. 数据模型围绕不可变事实和可重建读模型

所有主键使用稳定 UUID，时间保存为 UTC `timestamptz`：

| 聚合 | 核心表 | 设计要点 |
|---|---|---|
| 身份 | `users`, `credentials`, `email_tokens` | 无 Session 表；用户保存 `session_version`、邮箱验证和首次改密状态 |
| 权限 | `user_roles` | 只允许 `user`、`organizer`、`admin` 全局角色 |
| 通知 | `notifications`, `mail_deliveries` | 站内事实与邮件投递状态分离 |
| 队伍 | `teams`, `team_members`, `team_invites` | 单成员归属、单队长、邀请轮换 |
| 比赛 | `contests`, `divisions`, `participations`, `announcements`, `contest_events` | 首期仅 Jeopardy；发布状态持久化、时间阶段派生 |
| 题库 | `challenge_templates`, `challenge_template_versions`, `content_objects` | 模板版本不可变，分类不包含 AWD |
| 比赛题 | `contest_challenges`, `challenge_hints`, `challenge_assets` | 挂题时复制完整运行快照 |
| 提交 | `submissions`, `solves`, `score_adjustments`, `cheat_clues` | 追加事实；正式与练习显式隔离 |
| 排行榜 | `scoreboard_versions`, `scoreboard_snapshots` | 派生、可重建、区分公开和内部视图 |
| 实例 | `instances`, `instance_jobs`, `instance_job_attempts` | 只处理 Jeopardy 动态实例 |
| 内容 | `writeups`, `writeup_versions`, `content_references`, `imports`, `exports` | 对象不可变、引用可变 |
| 运维 | `platform_settings`, `audit_events`, `domain_outbox` | 设置类型化，审计与事件追加写 |

比赛发布后公平性字段不可原地修改。紧急修题通过显式修订命令产生修订号、审计和客户端版本事件。

### 4. 使用 nuxt-auth-utils sealed Cookie 与最小 Session 版本

安装并使用 `nuxt-auth-utils`。`NUXT_SESSION_PASSWORD` 是生产必填 Secret；Session Cookie 使用模块默认 sealed 存储并设置 `HttpOnly`、生产 `Secure`、`SameSite=Lax`。载荷只包含：

```text
user_id, session_version, logged_in_at
```

每个受保护请求从 PostgreSQL读取账号状态、邮箱验证、首次改密标记、角色和 `session_version`。Cookie 版本不一致、账号封禁或不存在时调用 `clearUserSession`。系统不保存 Session 摘要、不展示登录设备，也不支持单设备撤销。

密码使用模块的 `hashPassword`、`verifyPassword` 和 `passwordNeedsRehash`，采用 scrypt。改密、找回、封禁和角色变化在同一事务递增 `session_version`。Cookie 写请求执行 Origin 校验和 CSRF 证明；登录、注册和找回同时执行分层限流。

**Alternatives considered:** 纯默认 Cookie 无法在固定默认管理员改密后使潜在旧 Cookie 失效；Session 注册表会重新引入设备状态；浏览器 JWT 会固化角色快照并扩大泄露面。

### 5. 邮箱、Turnstile、默认管理员和三种全局角色

注册要求规范化唯一邮箱，验证令牌和找回令牌只存摘要、单次使用并限时。未验证账号只可浏览公开内容和维护账号。Turnstile 通过 provider 接口配置；未配置时平台继续启动并依赖本地限流，生产是否启用由设置与部署配置共同决定。

用户表完全为空时创建 `admin / sauryctf`，同时设置 `must_change_password=true` 与未验证邮箱状态。认证中间件只允许它访问账号维护、邮箱验证和登出。首次改密递增 Session 版本，阻断使用初始密码取得的旧 Cookie；不创建初始化页面。

权限只有 `user`、`organizer`、`admin`。`organizer` 对所有比赛拥有主办和裁判能力；`admin` 额外管理用户、角色、平台设置和全局运维；队长由 `team_members` 关系派生。所有领域服务入口重复授权，前端仅用于体验控制。

站内通知在业务事务内创建，邮件通过 `domain_outbox` 派发到 `mail_deliveries`。邮件失败不回滚账号或比赛事实，dispatcher 使用事件标识幂等重试。

### 6. 共享运行时 Schema 是 API 契约源

`shared/contracts/` 使用 Zod 定义输入、输出、稳定错误码和领域枚举；Nitro 执行运行时校验，同源生成 OpenAPI 与前端类型。列表使用 cursor pagination，管理写操作支持 `Idempotency-Key` 或资源版本前置条件。

统一错误：

```json
{
  "error": {
    "code": "contest.not_running",
    "message": "当前不在正式提交时间内",
    "request_id": "...",
    "fields": {}
  }
}
```

首期只实现密码登录。设置 schema 可以表达将来登录方式，但保存未实现的 OIDC-only 配置必须失败，防止锁死登录入口。

### 7. 首期比赛和题目只表达 Jeopardy

首期不需要 `contest.mode` 字段；所有比赛按 Jeopardy 规则运行。API、导入清单和数据库约束拒绝 AWD 或混合配置。题目分类为 `web`、`pwn`、`crypto`、`reverse`、`misc`、`forensics`，拒绝 `awd`。

题库模板发布不可变版本，挂题时将说明、提示、附件引用、Flag 策略、计分策略、实例配置和资源限制复制到 `contest_challenges`。公共附件与每队派生 Flag 可组合，但动态附件生成不属于首期。

比赛发布前执行完整性检查；选手内容投影统一依据发布状态、参赛状态、比赛阶段、题目发布时间和提示发布时间。公告、题目/提示发布、首解、封榜与阶段变化进入公开 `contest_events`；管理和安全事件只进入后台审计。

### 8. 提交和计分使用单一串行化事务路径

同步 Jeopardy Flag 提交顺序：

1. API 校验 Session、邮箱门槛、CSRF、限流和输入长度。
2. 事务锁定参赛记录与比赛题目计分状态，并重新计算比赛阶段和资格。
3. 写不可变 `submissions`，使用常量时间比较或受控同步校验器验证 Flag。
4. 尝试插入唯一 `(contest_challenge_id, participation_id, mode)` solve。
5. 首个唯一解推进 `score_version`、确定首解次序、写时间线与 outbox。
6. 排行榜构建器按版本更新读模型。

首期提供 `fixed-v1` 和 `decay-v1`。正式与练习使用显式 mode；练习不改变正式解数、动态分值、首解和封榜。异步 Checker/Bot 不属于此 change。

### 9. Redis 缓存与 SSE 均可丢失和重建

缓存 key 包含 schema 版本、比赛、视图、分组和 scoreboard version。事务内写 outbox，dispatcher 发布失效和实时事件；消费者按 event id 去重。热点排行榜使用进程内 single-flight 与 Redis 短锁。

SSE 事件保存有限恢复窗口并支持 `Last-Event-ID`；不能补齐时发送 reset，客户端重新拉取当前读模型。Redis 故障时使用 PostgreSQL 持久快照、限频重建和轮询降级，不缓存 Flag、Session 载荷、内部榜或实例凭证。

### 10. Go Worker 只消费 instance_jobs

控制面拥有 `instances.desired_state`、`desired_generation` 和 `expires_at`；Worker 只写观察状态、观察代次、入口、Provider 标识和错误摘要。每次期望变化在同一事务写 `instance_jobs`：

```text
job_id, instance_id, operation, payload_version
desired_generation, idempotency_key UNIQUE
status(ready|leased|retry_wait|succeeded|dead|cancelled)
available_at, lease_owner, lease_until, fencing_token
attempt_count, max_attempts, error_code, error_summary
created_at, started_at, finished_at
```

Worker 使用 `FOR UPDATE SKIP LOCKED` 领取并递增 fencing token；续租与完成必须匹配 `job_id + lease_owner + fencing_token`。旧代次任务标记为 superseded。数据库任务表是事实来源，`LISTEN/NOTIFY` 仅减少轮询延迟。

首期 job operation 只允许 `ensure`、`inspect`、`destroy`、`reconcile`。Worker 拒绝 Checker、Flag、VPN、终端或通用代码执行任务。

### 11. Worker 是声明式 Reconciler

Provider 契约：

```text
Ensure(ctx, InstanceSpec) -> Observation
Inspect(ctx, InstanceKey) -> Observation
Destroy(ctx, InstanceKey) -> Observation
```

Docker Provider 使用 Docker Engine API，Kubernetes Provider 使用 `client-go`。资源使用确定性名称和完整所有权标签；默认非 root、只读根文件系统、禁用 ServiceAccount token、限制 CPU/内存/临时存储并应用 NetworkPolicy。销毁缺失资源视为成功，未知无标签资源只告警。

`running` 必须基于 workload Ready、Service 和路由可用。HTTP 优先使用 Gateway API/Ingress，TCP 使用受支持 Gateway 或受控端口池；禁止默认 NodePort。Nuxt 只返回获权且就绪的公开入口。

### 12. 内容对象不可变，业务引用决定授权

`content_objects` 保存随机对象键、SHA-256、大小、媒体类型和状态；`content_references` 决定题目、Writeup 和导出包授权。上传先进入临时前缀，完成摘要、大小和策略校验后提交；未提交对象默认 24 小时回收。

下载由 Nuxt 重新授权后签发短期 URL 或流式返回。比赛包使用版本化清单，在隔离目录中限制条目数、解压大小、压缩比和路径，完整验证后单事务创建草稿。首期不导入旧运行数据库，只支持规范比赛包。

### 13. 平台设置、双语 UI 与可观测性

`platform_settings` 只保存经过 schema 校验的品牌、Logo 引用、主题、默认语言、公开注册和已实现登录方式。Session、数据库、Redis、对象存储和 Worker 密钥只来自 Secret。UI、状态和邮件模板支持 `zh-CN`、`en`，题目、公告和比赛内容保持录入原文。

请求入口生成 request id 和 trace context；任务继续关联 job、instance、contest、team。日志使用 JSON 和集中 redaction。指标至少覆盖 API、登录失败、邮件 outbox、提交、排行榜、任务队列、实例状态、Provider 延迟与 Reconcile 偏差。

`/health/live` 只检查进程，`/health/ready` 检查必要依赖与迁移版本。生产目标为赛时 99.9%，备份 RPO 5 分钟、RTO 30 分钟；容量测试使用 300 队、1000 并发、1000 实例和 200 提交/秒短峰值，普通同步提交 p95 小于 300ms，排行榜 5 秒内更新。

### 14. 非 AWD 后续能力保留独立扩展设计

这些能力不创建首期 API、表或任务；后续 change 复用以下边界，不能把半实现路径预埋进首期：

**个人训练：** 题库不可变版本可发布到个人训练题单，训练提交、解题进度、提示和实例以用户为 owner，不依赖队伍或参赛记录，不产生全站训练排行榜，也不改变正式比赛事实。动态实例复用实例编排但使用独立作用域和配额。

**通用 OIDC：** 平台设置扩展为 `password_only`、`oidc_only`、`password_and_oidc`。Provider 以 issuer 配置和发现文档建立信任；首次登录只有在可信 issuer 明确返回 `email_verified=true` 时才能按规范化邮箱自动创建或合并账号，并始终持久化唯一 `(issuer, subject)`。未验证邮箱、歧义邮箱或冲突 subject 必须失败并审计，不能静默创建第二账号。

**平台 MCP：** 只允许用户为自己创建个人 MCP 令牌，不提供管理员或后台集成 Token。令牌命名、一次展示、只存摘要、最长 90 天并可撤销；scope 至少区分读取、队伍写入、提交/Writeup 和实例操作。`/mcp` 复用网页领域服务、限流和审计，Bearer Token 只允许访问 MCP audience，不能作为通用管理 API 凭证。

**动态附件：** 正式比赛按队伍、个人训练按用户生成。控制面保存生成器不可变版本、输入摘要和期望产物，未来统一 Worker 在沙箱 Job 中执行并把不可变对象提交到 S3；生成器不得访问控制面凭据或其他 owner 数据，失败结果可重试且不得发放部分产物。

**Checker/Bot 判题：** 提交先写 `pending` 事实，控制面发出版本化沙箱任务，Worker 只回写严格结果，Nuxt 再以幂等事务创建 solve 和计分事件。不可信 Checker 不进入 Nitro 进程，超时和平台错误不得伪装成选手答案错误。

**Challenge Gateway 与 PCAP：** 默认题目流量继续由 Gateway/Ingress 直达服务；仅按题显式启用独立数据面网关的访问令牌、限流或抓包。PCAP 信封加密保存，只有 organizer/admin 可带原因下载，默认赛后七天删除，Nuxt 和 Worker 均不转发数据包。

## Risks / Trade-offs

- [Nuxt 成为登录和计分关键路径] → 固定 Node LTS、无状态多副本、独立连接池预算、事件循环告警和容量测试。
- [sealed Cookie 仍需每次读取用户状态] → 用户读取使用窄索引查询；不缓存影响封禁和版本失效的结论。
- [固定默认管理员凭证可能被抢先使用] → 限制账号能力、强制改密与邮箱验证、改密递增 Session 版本、在部署检查中持续告警。
- [三种全局角色无法隔离不同主办团队] → 管理界面明确全局范围，所有操作记录操作者；比赛级隔离作为未来独立变更。
- [干净重建无法保留旧运行数据] → 上线前只允许从规范比赛包迁移内容，旧环境保持只读备份，不做隐式转换。
- [数据库任务队列在实例峰值成为瓶颈] → 批量领取、短事务、索引、历史归档和队列年龄告警；只在测量超过阈值后替换传输层。
- [Redis 故障造成 PostgreSQL 读洪峰] → 请求合并、限频重建、持久排行榜快照和 stale-if-error。
- [Kubernetes 创建成功但回写失败产生孤儿] → 确定性命名、标签、fencing、幂等 Ensure/Inspect 和周期 Reconcile。
- [首期缺少异步 Checker 和流量抓包] → API 与任务协议拒绝未实现种类，避免半成品入口；后续通过独立 change 扩展。

## Migration Plan

### Phase 0: 冻结新契约

1. 将现有 smoke flow 和测试仅作为行为参考，逐项确认目标规范是否保留该行为。
2. 生成新的 Zod/OpenAPI 契约和空 PostgreSQL schema。
3. CI 明确禁止 AWD 分类、接口、表和任务类型进入首期产物。

**Rollback:** 无运行行为变化。

### Phase 1: 建立新运行基础

1. 建立 PostgreSQL、Redis、S3 兼容存储和本地邮件接收器。
2. 建立 `apps/web` Nuxt server 分层、迁移框架、`nuxt-auth-utils`、安全中间件、outbox 和遥测。
3. 建立只含 Jeopardy 和实例编排的新数据模型。

**Rollback:** 删除新环境并继续使用旧开发实现；不涉及旧数据回放。

### Phase 2: 完成 Jeopardy 控制面

1. 实现身份、通知、队伍、比赛、题库、提交、计分、排行榜、内容和管理领域。
2. 完成独立 Nuxt 页面与 API，不代理旧 Go 业务接口。
3. 从规范比赛包导入需要保留的题目内容，不导入旧账号和比赛运行事实。

**Rollback:** 在正式接收新平台事实前可整体回到旧环境；不得双写两个平台。

### Phase 3: 抽取实例 Worker

1. 实现 `instance_jobs`、fencing、Reconciler、Docker Engine API 和 `client-go` Provider。
2. 验证 Docker 与测试 k3s 的实例创建、续期、销毁、崩溃恢复和孤儿对账。
3. 确认 `apps/worker` Go 构建产物不再暴露用户业务路由，并删除临时遗留 Go 单体。

**Rollback:** 停止接收新实例请求，等待或人工收敛带标签资源，再整体回退部署；不得恢复同步 Docker CLI 写路径。

### Phase 4: 生产验收与切换

1. 在空生产 PostgreSQL 环境完成默认管理员改密和邮箱验证。
2. 执行端到端、容量、安全、故障、备份恢复和首期无 AWD 检查。
3. 一次性将入口切换到 Nuxt，新平台成为唯一事实写入者；旧环境保持离线只读备份。

**Rollback:** 若尚未产生必须保留的新事实，可整体回退；产生新正式提交后优先修复新平台，避免与旧数据源分叉。

### Phase 5: 后续 changes

1. `add-awd-competition` 在核心平台稳定后独立实施。
2. 个人训练、OIDC、MCP、动态附件、异步判题和 Challenge Gateway 分别通过后续 change 扩展。
3. 后续 change 不得通过预埋半实现路由绕过首期边界。
