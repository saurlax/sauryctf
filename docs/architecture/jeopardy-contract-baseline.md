# Jeopardy 首期行为基线

本文记录重建前 smoke flow、`api/openapi.yaml` 与 Go 测试中可观察行为的取舍。它只用于回答“哪些产品行为值得保留”，不是旧 API 的兼容声明，也不是新 API 的机器可读契约。

新契约的唯一来源依次为：

1. `openspec/changes/rebuild-platform-with-nuxt-control-plane/specs/` 中的首期规格；
2. 后续由 `shared/contracts/` 生成并经契约测试验证的 OpenAPI；
3. 实现测试与本文件引用的回归场景。

旧路径、请求字段、响应字段、状态码、Cookie 名称、数据库主键、枚举值和错误文案，除非在新 OpenSpec 与新生成契约中再次明确声明，否则全部不兼容。

## 取舍标记

- **纳入新契约**：保留业务意图，但必须按新 OpenSpec 重新建模；不代表保留旧 HTTP 或数据库形状。
- **明确废弃**：不得带入新实现；旧测试只能作为反例或迁移完成后的删除依据。

## 行为取舍矩阵

| 编号 | 现有行为参考 | 主要来源 | 取舍 | 新基线或废弃原因 |
|---|---|---|---|---|
| ID-01 | 注册要求用户名、邮箱和密码 | OpenAPI `RegisterRequest`；auth handler/service tests | 纳入新契约 | 邮箱规范化且唯一；注册后仍受邮箱验证能力门槛约束，输入输出由新 Zod 契约重定。 |
| ID-02 | 用户名或邮箱加密码登录 | OpenAPI `LoginRequest`；`TestLogin`；smoke 登录 | 纳入新契约 | 首期只支持密码登录；密码改用 `nuxt-auth-utils` scrypt 工具。 |
| ID-03 | 注册或登录返回 JWT，并把 JWT 写入 Cookie | OpenAPI `AuthResponse.token`；RBAC tests；auth service | 明确废弃 | 改为 sealed HttpOnly Cookie；响应不得返回 bearer token，Cookie 只含 `user_id`、`session_version`、`logged_in_at`。 |
| ID-04 | 数据库保存 Session 记录，登出按 Token 删除 | `internal/models/session.go`；`TestLogout` | 明确废弃 | 新 schema 不得存在 Session 表或设备会话列表；登出只清除 sealed Cookie。 |
| ID-05 | JWT 内保存角色并由 Go 中间件直接授权 | auth/rbac tests；OpenAPI `BearerAuth` | 明确废弃 | 每个受保护请求从 PostgreSQL 读取状态、角色和 `session_version`，不能信任 Cookie 中的角色快照。 |
| ID-06 | `user/team_captain/judge/admin/super_admin` 全局角色 | OpenAPI `UserInfo.role`；auth tests | 明确废弃 | 只允许 `user/organizer/admin`；队长由成员关系派生，organizer 对全部比赛生效。 |
| ID-07 | 空用户表创建 `admin / sauryctf` | server/auth bootstrap tests；smoke | 纳入新契约 | 仅空库创建；账号必须先改密并补充、验证邮箱，完成前不能管理平台；不增加初始化页。 |
| ID-08 | 默认管理员只收到“建议改密”，仍可直接建赛 | `TestServer_BootstrapAdminCanCreateGame`；security-status | 明确废弃 | `must_change_password` 与未验证邮箱是服务端强制门槛，不是 UI 提醒。 |
| ID-09 | 改密删除服务端 Session | auth service tests | 明确废弃 | 改密、找回、封禁与角色变化递增 `session_version`，使所有旧 Cookie 失效。 |
| ID-10 | 注册后无邮箱验证即可建队、报名和提交 | smoke player flow | 明确废弃 | 未验证账号只能浏览公开内容、维护账号、重发验证邮件和登出。 |
| ID-11 | 登录、注册页保留安全的站内 redirect，拒绝 `//` 回跳 | `check-auth-redirects.ps1` | 纳入新契约 | 保留产品行为并用前端测试覆盖；不承诺旧查询参数之外的未声明跳转细节。 |
| ID-12 | 管理员可修改用户状态和角色 | OpenAPI admin users；auth tests | 纳入新契约 | 通过新全局能力矩阵执行，角色或封禁变化必须推进 Session 版本并写不可变审计。 |
| TM-01 | 用户创建队伍、邀请码加入、退出和移除成员 | teams handler/service tests；smoke | 纳入新契约 | 用 PostgreSQL 事务与唯一约束保证单用户单队伍。 |
| TM-02 | 队长轮换邀请码和转让队长 | team tests；OpenAPI | 纳入新契约 | 邀请码需高熵、可撤销、不可枚举；队伍始终恰有一名队长。 |
| TM-03 | 已接受且未结束比赛锁定成员关系 | games/teams tests；OpenAPI lock summary | 纳入新契约 | 普通成员变更全部阻止；管理员纠正必须带原因并审计。 |
| CT-01 | 创建、更新、列出和读取公开比赛 | games handler/service tests；smoke | 纳入新契约 | 由 Nuxt 领域服务实现；所有公开与管理读取使用新投影和新分页契约。 |
| CT-02 | 持久化 `draft/active/ended` 状态并自动把过期 active 显示为 ended | OpenAPI `Game.status`；game lifecycle tests | 明确废弃 | 持久状态改为 `draft/published/archived`；`upcoming/running/ended` 统一由 UTC 时间派生。 |
| CT-03 | 公开/私有、邀请码、自动通过/人工审核彼此独立 | games tests；smoke `auto_accept` | 纳入新契约 | 保留独立配置；私有比赛的直接标识访问不得泄露存在性。 |
| CT-04 | 报名状态包含 pending、accepted、rejected 和撤回 | participation tests | 纳入新契约 | 采用显式状态机；接受时重新校验邮箱、人数和比赛条件。 |
| CT-05 | 已接受报名不可由队伍撤回 | `TestService_LeaveGame_RejectsAcceptedWithdrawal` | 纳入新契约 | 与赛中成员锁定共同作为首期规则；管理员纠正走高风险命令。 |
| CT-06 | 开始、结束、封榜与 Writeup 截止时间校验 | game timeline tests | 纳入新契约 | 全部使用 UTC；结束晚于开始，封榜位于窗口内，Writeup 截止不早于结束。 |
| CT-07 | draft/private 比赛不向游客公开 | public game tests | 纳入新契约 | 公开投影继续隐藏未发布或无权比赛，且不泄露敏感元数据。 |
| CT-08 | 比赛发布前至少挂一道题 | activation tests | 纳入新契约 | 扩展为基本信息、题目、Flag、附件与动态实例配置的完整性检查。 |
| CT-09 | 比赛删除会清理比赛关系但保留题库记录 | delete game tests | 纳入新契约 | 仅作为带专门权限、非空原因、明确确认和审计的高风险命令；不承诺旧 DELETE 路径。 |
| CT-10 | 比赛公告可创建、修改、删除 | announcement tests | 纳入新契约 | 改为创建、修改、撤回与定时发布，并产生可去重公开事件。 |
| CT-11 | 旧平台没有稳定的精选公开时间线 | 现有 OpenAPI 与测试缺项 | 明确废弃 | 不复用管理审计作为公共时间线；只发布规范列出的公告、题目/提示、首解、封榜和阶段事件。 |
| CH-01 | 题库 CRUD 后把可变题目记录挂到比赛 | challenge/game tests | 明确废弃 | 改为不可变题库版本；挂题复制完整比赛题目快照，模板更新不得污染历史比赛。 |
| CH-02 | `static/dynamic` 单一题型枚举同时暗示 Flag、计分和实例能力 | OpenAPI `Challenge.type` | 明确废弃 | 内容、Flag、计分与实例改为正交策略并校验组合。 |
| CH-03 | 展示分类包含 `web/pwn/crypto/reverse/misc/forensics/awd` | OpenAPI；model enum | 明确废弃 | 只保留前六类；任何创建、导入或发布中的 `awd` 均拒绝。 |
| CH-04 | 未接受或未开赛用户只能看到题目基础元数据 | challenge visibility tests；smoke manual checks | 纳入新契约 | 题面、提示、附件、Flag 材料和实例信息统一由选手投影控制。 |
| CH-05 | 题目附件保存到本地 `/attachments/**` | attachment tests；旧导入导出 | 明确废弃 | 权威内容进入 S3 兼容对象存储，以不可变摘要对象和业务引用授权。 |
| CH-06 | 存在不属于比赛的 standalone challenge submit | `/api/challenges/{id}/submit`；challenge tests | 明确废弃 | 首期没有个人训练；提交必须属于比赛题目快照与参赛记录。 |
| SC-01 | 正确/错误 Flag、重复解和动态衰减计分 | challenge/game scoring tests | 纳入新契约 | 以追加提交事实、正式解唯一事务和 `fixed-v1/decay-v1` 快照策略重建。 |
| SC-02 | first/second/third blood 元数据稳定展示但不默认加成 | scoring tests；项目约定 | 纳入新契约 | 首解次序在事务内确定；只有比赛明确配置奖励时才影响总分。 |
| SC-03 | 最大错误提交次数，正式与练习分别计数 | max-attempt tests | 纳入新契约 | 作为题目快照策略执行，并与 IP/用户/动作限流共同生效。 |
| SC-04 | 赛后 practice 提交不影响正式榜 | practice tests | 纳入新契约 | 正式与练习在提交和解题事实中使用显式 mode，禁止共享正式计分状态。 |
| SC-05 | 共享错误 Flag 形成反作弊线索 | cheat clue tests | 纳入新契约 | 线索保留证据并人工复核，不能自动处罚用户或删分。 |
| SB-01 | 排行榜展示队伍总分、题目统计和最后解题时间 | scoreboard tests；smoke | 纳入新契约 | 只从正式事实与显式调整重建，排序为总分降序、最后计分时间升序、稳定 ID 升序。 |
| SB-02 | 支持总榜和 division 过滤 | division scoreboard tests | 纳入新契约 | 分组属于参赛记录；过滤不改变同一队伍的总榜分数事实。 |
| SB-03 | 封榜后公共榜冻结但内部成绩继续更新 | freeze tests | 纳入新契约 | 形成角色相关视图和持久快照，内部榜不得进入公共缓存。 |
| IN-01 | 实例有初始时长、续期增量、续期窗口和队伍并发上限 | instance tests；smoke | 纳入新契约 | 配额由 Nuxt 在事务内裁决，期限随版本化任务传给 Worker。 |
| IN-02 | 旧同步 POST 在 Provider 完成后直接返回 `running` | smoke；instance handler tests | 明确废弃 | 创建请求原子写实例期望与 `instance_jobs` 后返回 `pending`；只有 Worker 确认入口 Ready 才返回 `running`。 |
| IN-03 | Go 进程内定时清理数据库 lease | cleanup tests | 明确废弃 | 过期与偏差由私有 Worker Reconciler 根据权威期望状态收敛。 |
| IN-04 | Docker provider 通过拼接并执行 `docker` CLI | docker provider tests；smoke docker | 明确废弃 | Docker 必须使用 Engine API；Kubernetes 使用 `client-go`，均实现统一 Ensure/Inspect/Destroy 契约。 |
| IN-05 | 连接模板可包含游戏、题目、队伍和 team hash | instance rendering tests | 纳入新契约 | 仅作为受控版本化实例策略；未解析模板、内部地址和未就绪入口不得返回选手。 |
| IN-06 | `/mock-instance/**` 和 `/local-instance/**` 是本地占位入口 | legacy web routes；smoke | 明确废弃 | 生产题目流量经 Gateway/Ingress/Service；不把本地占位页写入新公网契约。 |
| CO-01 | 比赛包可导出并重新导入为 draft，保留挂题与附件 | smoke；import/export tests | 纳入新契约 | 使用新的版本化 Jeopardy 清单、文件摘要和原子导入；不承诺旧 `sauryctf.export.v1/v2` 格式。 |
| CO-02 | 导入只按版本检查并可恢复旧本地附件 | import tests | 明确废弃 | 新导入增加路径、大小、条目数、压缩比和摘要校验；不得任意抓取外部 URL。 |
| CO-03 | 队伍 Writeup 可保存、提交、审核和导出 | writeup tests | 纳入新契约 | 改为不可变版本历史；截止后普通用户不可修改，管理员纠正需授权和审计。 |
| AD-01 | 管理员可查看用户、审计、参赛、提交、线索、实例和 Writeup | admin handler/service tests；前端管理路由 | 纳入新契约 | 统一为 Nuxt 管理投影，明确数据库事实、缓存时间和 Worker 观察时间。 |
| AD-02 | 审计日志允许可变详情字符串和整数目标 ID | old `AuditLog` schema/model | 明确废弃 | 改为不可变、结构化、UUID 目标与请求关联标识，并与业务事务同边界提交。 |
| PL-01 | Nuxt `generate` 产出纯 SSG，浏览器 `/api/**` 代理到公网 Go | package scripts；Nuxt config | 明确废弃 | Nuxt/Nitro 成为唯一公网控制面，Go 只保留私有实例 Worker。 |
| PL-02 | SQLite 可作为默认业务数据库和测试语义 | db implementation；smoke | 明确废弃 | PostgreSQL 是唯一权威数据库和标准集成测试语义。 |
| PL-03 | 整数数据库 ID 与 GORM JSON 形状直接成为 API DTO | OpenAPI schemas；models | 明确废弃 | 新模型使用稳定 UUID，API 由 Zod 契约定义，数据库表不得直接透传到 Handler 或页面。 |
| PL-04 | `/api/healthz` 只返回单一健康状态 | smoke；health test | 明确废弃 | 每个组件分别提供 live 与 ready；ready 必须验证必要依赖和迁移状态。 |

## 新 smoke flow 的继承边界

旧 `scripts/smoke-local.ps1` 的端到端顺序仍是回归输入：管理员登录、创建比赛、创建并挂载题目、发布、注册选手、建队、报名、实例生命周期、正式提交、排行榜、导入导出。新 smoke 必须增加并调整以下步骤：

1. 默认管理员先改密、补充邮箱并完成验证，旧初始 Cookie 随 `session_version` 失效；
2. 普通用户必须验证邮箱后才能建队；
3. 比赛从 `draft` 发布为 `published`，`running` 由 UTC 时间派生；
4. 题库发布不可变版本，再挂载为比赛题目快照；
5. 动态实例首次请求先观察到 `pending/starting`，Worker 确认就绪后才是 `running`；
6. 比赛结束后验证练习事实与正式结果隔离；
7. Writeup 验证版本、提交、截止与审核；
8. 所有请求只访问 Nuxt，测试不得调用旧 Go 公网业务端口。

旧 smoke 对同步 `running`、未验证注册用户、旧整数 ID、固定响应文案、旧 endpoint 和旧导出格式的断言不得复制到新验收套件。

## 文档审查结论

- [x] 已覆盖现有 smoke flow 的每个业务步骤，并为变化后的断言给出新基线。
- [x] 已覆盖 `api/openapi.yaml` 的认证、用户、队伍、题库、比赛、报名、提交、排行榜、实例、公告、Writeup、导入导出和审计能力族。
- [x] 已覆盖现有 auth、rbac、teams、challenges、games、scoring、instance、audit 与 server 测试族中的产品行为。
- [x] 所有条目均明确标为“纳入新契约”或“明确废弃”，无“尽量兼容”“暂时沿用”或待定项。
- [x] “纳入新契约”只保留业务意图，不保留未在新 OpenSpec 与生成契约中声明的旧协议细节。
- [x] AWD、VPN、终端和 Checker 不属于本文的实施基线，也未作为隐藏兼容行为保留。

结论：重建是有选择地继承 Jeopardy 产品行为的干净实现，不是旧 Go API、SQLite/GORM schema、JWT Session 或旧导出包的兼容迁移。
