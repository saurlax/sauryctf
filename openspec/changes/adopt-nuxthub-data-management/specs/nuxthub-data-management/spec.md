## Purpose

定义控制面使用 NuxtHub 统一管理 PostgreSQL 与 Blob、完全不依赖 Redis 的行为契约，并约束数据库共享、限流、榜单读取、迁移接管、S3 与本机存储选择、授权、持久化和故障恢复边界。

## ADDED Requirements

### Requirement: 控制面数据服务由 NuxtHub 统一提供
Nuxt/Nitro 控制面 SHALL 通过 NuxtHub 的 PostgreSQL Database 与 Blob 能力访问业务数据库和内容对象；API Handler 与页面 MUST 不自行创建数据库或存储供应商客户端。

#### Scenario: 控制面启动数据服务
- **WHEN** 部署配置通过校验且控制面启动
- **THEN** 所有领域仓储和内容服务使用同一套 NuxtHub 管理的数据服务，而不是并行维护第二套连接或对象写入路径

### Requirement: 平台无 Redis 运行依赖
控制面和 Go Worker MUST 不要求 Redis、Redis 兼容服务或其他共享 KV/Cache/消息代理才能启动、就绪或完成业务流程。部署配置 MUST 不包含 `REDIS_URL`；应用 MUST 不创建 Redis 客户端，且 Redis 不得作为限流、排行榜、任务、事件或实时状态的权威或派生后端。

#### Scenario: 无 Redis 的标准启动
- **WHEN** 环境只提供有效 PostgreSQL、所选 Blob 后端和其他业务必需配置，且不存在 Redis 服务或配置
- **THEN** 控制面与 Worker 能够 ready，并能完成身份、队伍、比赛、提交、排行榜、内容、邮件和动态实例业务流程

#### Scenario: 多控制面副本
- **WHEN** 多个控制面副本同时处理请求且没有共享缓存或消息代理
- **THEN** 所有需要跨副本一致性的业务结果仍由 PostgreSQL 事务、约束、租约或版本记录协调

### Requirement: PostgreSQL 继续作为共享权威数据库
控制面 SHALL 使用 `DATABASE_URL` 指向的 PostgreSQL 作为权威数据库；生产、开发和集成环境 MUST 不自动降级为 SQLite、PGlite 或其他仅进程内可见的数据库。Go Worker SHALL 继续通过独立受限 LOGIN 访问同一个 PostgreSQL 实例中的实例任务表，并 MUST 不依赖 Redis 或控制面 HTTP API 领取任务和写回观察。

#### Scenario: 缺少数据库连接配置
- **WHEN** 控制面没有有效的 `DATABASE_URL`
- **THEN** 控制面就绪检查失败并指出数据库配置缺失，且不得创建嵌入式替代数据库继续提供业务写入

#### Scenario: Worker 与控制面协作
- **WHEN** 控制面提交动态实例任务且 Worker 使用获授 `sauryctf_worker` 的独立登录连接
- **THEN** Worker 能从同一个 PostgreSQL 领取任务并写回观察，而不能读取身份、Flag、提交或排行榜事实

### Requirement: 安全限流由 PostgreSQL 跨副本执行
平台 SHALL 通过 PostgreSQL 原子维护身份、网络与 Flag 提交限流窗口。相同限流身份在不同控制面副本和进程重启前后 MUST 共享同一窗口计数；达到限制时 SHALL 返回 429 和有效的 `Retry-After`，且持久记录 MUST 不包含原始 IP、用户凭据或 Flag。

#### Scenario: 跨副本累计请求
- **WHEN** 同一限流身份在一个窗口内交替请求两个控制面副本
- **THEN** 两个副本对同一共享计数做出一致限制，不能分别获得完整配额

#### Scenario: 控制面进程重启
- **WHEN** 限流窗口尚未到期而处理请求的控制面进程重启
- **THEN** 新进程继续使用窗口中已经消耗的计数和原到期时间

#### Scenario: PostgreSQL 无法执行限流
- **WHEN** 安全敏感写请求无法原子消费 PostgreSQL 限流额度
- **THEN** 请求失败且不得降级为每进程内存计数后继续执行受保护操作

#### Scenario: 限流窗口过期
- **WHEN** 限流窗口到期且后台保留任务运行
- **THEN** 过期记录可被分批删除，同时新窗口计数不受旧记录影响

### Requirement: 排行榜只依赖 PostgreSQL 与进程内协调
公开和内部排行榜 SHALL 以 PostgreSQL 中的计分事实、版本和持久快照为准。平台 MUST 不要求共享缓存或分布式缓存锁；同一控制面进程 SHALL 合并相同榜单版本的并发构建，多副本重复构建 MUST 通过数据库唯一约束产生同一可观察结果。

#### Scenario: 首次读取新版本榜单
- **WHEN** 当前版本不存在可用的 PostgreSQL 榜单快照
- **THEN** 控制面从权威计分事实构建快照并返回结果，而不访问外部缓存

#### Scenario: 多副本同时构建
- **WHEN** 两个控制面副本同时构建相同比赛、视图、范围和版本的榜单
- **THEN** 数据库至多保留一个唯一快照，两个请求返回语义等价且版本一致的结果

#### Scenario: 重复读取已有快照
- **WHEN** PostgreSQL 已存在请求版本的有效榜单快照
- **THEN** 控制面直接读取该快照而无需 Redis 或共享缓存

### Requirement: 榜单更新使用普通 HTTP 读取
平台 SHALL 通过普通排行榜 HTTP API 返回当前版本化榜单，并 MUST 不提供依赖消息代理的比赛事件 SSE 或事件恢复窗口。需要自动更新的 Web 页面 SHALL 仅在页面可见时按受控间隔重新读取榜单，并在离开页面或页面不可见时停止轮询。

#### Scenario: 页面观察榜单更新
- **WHEN** 可见的榜单页面轮询到高于当前显示版本的响应
- **THEN** 页面用新版本替换榜单内容且不需要长连接或事件订阅

#### Scenario: 页面不可见
- **WHEN** 榜单页面进入后台、卸载或导航离开
- **THEN** 客户端停止定时读取，不继续消耗控制面和数据库资源

#### Scenario: 访问旧比赛事件路由
- **WHEN** 客户端请求已移除的比赛事件 SSE 路由
- **THEN** 平台返回 404 且不建立事件流

### Requirement: 事务通知不依赖消息代理
需要发送邮件或创建站内通知的业务事务 SHALL 在同一 PostgreSQL 事务中记录通知来源与待处理投递；邮件调度 SHALL 直接从 PostgreSQL 领取任务。平台 MUST 不为没有消费者的通用领域广播或榜单刷新写入待发布消息。

#### Scenario: 创建安全邮件
- **WHEN** 身份事务需要发送验证或重置邮件
- **THEN** 来源记录与邮件投递在同一数据库事务中持久化，后台邮件调度无需 Redis 即可领取和发送

#### Scenario: 提交改变榜单版本
- **WHEN** 正式提交或计分调整递增 PostgreSQL 榜单版本
- **THEN** 事务不再额外创建只用于 Redis 广播的榜单刷新事件

### Requirement: NuxtHub 迁移接管不得重复执行历史迁移
平台 SHALL 使用显式、可审计且与 NuxtHub 迁移目录及 `_hub_migrations` journal 兼容的数据库迁移命令推进 schema，并 SHALL 禁止在普通应用构建或生产进程启动时隐式修改数据库。执行器 MUST 正确保留 PostgreSQL dollar-quoted 函数体，MUST 在任一迁移失败时回滚该迁移、返回非零退出码且不得写入成功 journal。已存在 Drizzle migration journal 的数据库 MUST 先验证历史 schema 与仓库基线一致，再将对应历史迁移认领到 NuxtHub journal；认领操作 MUST 幂等且不得重新执行历史 DDL。

#### Scenario: 新数据库执行迁移
- **WHEN** 运维对空 PostgreSQL 执行标准迁移命令
- **THEN** 所有基线迁移按顺序执行并记录在 NuxtHub migration journal 中

#### Scenario: PostgreSQL 函数迁移失败
- **WHEN** 迁移包含 dollar-quoted PL/pgSQL 函数体，或其中任一语句执行失败
- **THEN** 执行器不得按函数体内部分号拆分 SQL；失败时回滚整个迁移、返回非零退出码且不记录该迁移

#### Scenario: 已部署数据库切换 journal
- **WHEN** 数据库已经记录全部旧 Drizzle 迁移且 schema 与预期基线一致
- **THEN** 接管流程只记录等价的 NuxtHub 历史迁移项，然后只执行尚未应用的新迁移

#### Scenario: 历史 schema 无法确认
- **WHEN** 旧 journal、迁移数量或 schema 指纹与仓库基线不一致
- **THEN** 接管流程失败且不写 NuxtHub journal、不执行后续迁移

### Requirement: Blob 驱动由 S3 环境变量确定
平台 SHALL 在运行部署配置中按确定性规则选择 Blob 驱动：`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BUCKET` 和 `S3_REGION` 全部存在时使用 S3，且 `S3_ENDPOINT` 可选；这些变量与 `S3_ENDPOINT` 全部缺失时使用本机文件系统；任意部分配置 MUST 被视为配置错误，不得静默回退本机存储。

#### Scenario: 配置完整 S3
- **WHEN** 四个必需 S3 变量均有效且可选 endpoint 合法
- **THEN** 控制面使用 NuxtHub S3 Blob 驱动保存和读取内容对象

#### Scenario: 未配置任何 S3 变量
- **WHEN** 所有 S3 变量均为空或缺失
- **THEN** 控制面使用 NuxtHub 本机文件系统 Blob 驱动，且重启后仍从同一配置目录读取对象

#### Scenario: S3 只配置一部分
- **WHEN** 任一 S3 变量存在但四个必需变量没有全部提供
- **THEN** 控制面启动或就绪校验失败，并列出缺失字段但不回显凭据值

### Requirement: 本机 Blob 模式具有明确持久化边界
本机 Blob 模式 SHALL 使用可配置且默认位于应用 `.data/blob` 下的专用目录，目录 MUST 被排除在 Git 和构建产物之外。使用本机 Blob 作为权威内容时，部署 MUST 挂载持久化卷并限制为单个控制面写入副本；多副本部署 MUST 使用共享 S3，或在切换前完成显式对象迁移。

#### Scenario: 单机进程重启
- **WHEN** 使用本机 Blob 的控制面进程在保留数据目录的情况下重启
- **THEN** 已提交内容仍能通过原对象键和数据库元数据读取

#### Scenario: 多副本误用本机存储
- **WHEN** 生产部署声明多个控制面写入副本但选择本机 Blob
- **THEN** 发布检查失败或阻止扩容，并指示改用共享 S3

#### Scenario: 切换存储驱动
- **WHEN** 运维从本机 Blob 切换到 S3 或从一个 S3 bucket 切换到另一个 bucket
- **THEN** 平台不得隐式复制或假定对象已存在，切换前必须完成并验证显式对象迁移

### Requirement: 存储后端不得绕过内容授权
数据库中的对象标识、摘要、大小、媒体类型、状态和引用关系 SHALL 继续决定内容生命周期与授权。无论使用 S3 还是本机 Blob，下载 MUST 经控制面重新授权，平台 MUST 不暴露可枚举的通用 Blob 路由或永久公开 URL 来绕过题目、Writeup、比赛包和 Logo 的访问规则。

#### Scenario: 未授权用户猜测对象键
- **WHEN** 用户提交一个存在但不属于其可访问资源的对象键
- **THEN** 控制面拒绝读取，且存储驱动不会直接向用户返回对象内容或供应商地址

#### Scenario: 相同对象键跨驱动读取
- **WHEN** 已验证迁移把对象从本机 Blob 移到 S3 并保留对象键与摘要
- **THEN** 业务引用和 API 响应语义保持不变，无需改写领域记录

### Requirement: 就绪与备份只识别权威数据后端
控制面就绪检查 SHALL 验证 PostgreSQL 配置与迁移版本，并验证所选 Blob 驱动可访问；就绪检查 MUST 不探测 Redis 或其他共享缓存。安全的管理投影 SHALL 显示数据库与 Blob 驱动种类和健康状态但 MUST 不显示目录绝对路径、S3 endpoint 细节或凭据。备份恢复流程 SHALL 根据实际驱动备份 PostgreSQL 加 S3 bucket，或 PostgreSQL 加本机 Blob 持久化目录。

#### Scenario: 本机目录不可写
- **WHEN** 本机 Blob 目录不存在且无法安全创建，或运行身份没有读写权限
- **THEN** 控制面保持 live 但不 ready，且不得接受新的内容上传

#### Scenario: S3 暂时不可用
- **WHEN** 已选择 S3 但 bucket 无法访问
- **THEN** 控制面保持 live 但不 ready，既不切换到本机目录也不改变权威存储后端

#### Scenario: 恢复本机 Blob 部署
- **WHEN** 运维从同一恢复点恢复 PostgreSQL 与本机 Blob 数据目录
- **THEN** 内容摘要和引用完整性校验通过后才允许部署重新 ready
