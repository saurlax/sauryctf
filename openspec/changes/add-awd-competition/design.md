## Context

参见 [proposal.md](./proposal.md)。本设计假设 `rebuild-platform-with-nuxt-control-plane` 已完成并归档：Nuxt/Nitro 是唯一公网控制面，PostgreSQL 保存权威事实，Redis 只保存派生状态，S3 兼容存储保存对象，Go Worker 通过 PostgreSQL 租约任务操作 Docker/Kubernetes。首期核心只支持 Jeopardy 和 `instance_jobs`。

AWD 引入持续服务、全局 Tick、短时 Flag、Checker、攻击网络和服务修补，不能复用 Jeopardy“一次提交得到一次静态判定”的模型。本 change 只准备规划产物，未收到独立 apply 请求前不得实施。

目标拓扑：

```text
Player browser -----> Nuxt control plane -----> PostgreSQL / Redis
      |                       |
      |                       +---- creates worker_jobs
      |                                      |
      v                                      v
VPN gateway --------------------------> Go Worker pool
      |                                      |
      v                                      v
isolated attack network <---------- Kubernetes / Docker
      |                           team services + checker jobs
      v
team service endpoints

Terminal client ---> terminal gateway ---> own team service only
Service traffic ---> optional capture gateway ---> encrypted object storage
```

## Goals / Non-Goals

**Goals:**

- 以独立 `awd` 比赛模式实现经典 Tick 攻防，不污染 Jeopardy 提交和计分模型。
- 保证 Tick、Flag、Checker、攻击归功与三分量计分在故障和并发下可重放。
- 让单一 Go Worker 池安全执行实例与 Checker 任务，但不拥有业务裁决权。
- 通过赛事 VPN、NetworkPolicy 和受控终端隔离攻击网、管理网和其他队伍写权限。
- 为 organizer 提供暂停、豁免、重算、恢复、证据和 PCAP 的受控运维路径。

**Non-Goals:**

- 不支持同场混合 Jeopardy 与 AWD。
- 不允许选手获得 Kubernetes、Docker 或宿主机管理凭据。
- 不让 Nuxt 或 Worker代理攻击数据面流量。
- 不实现零和分数转移、动态 Tick 时长变化或全自动作弊处罚。
- 不在该 change 中实现多集群调度、跨地域 VPN 或比赛级 RBAC。

## Decisions

### 1. AWD 作为独立比赛聚合

为 `contests` 增加 `mode`，迁移时全部现有记录回填 `jeopardy` 并设为必填。`awd` 比赛使用独立服务、Tick、攻击和分数 API；公共比赛列表只共享身份、队伍、报名、公告、审计和基础元数据。领域入口先检查 mode，禁止跨赛制调用。

主要表：

| 聚合 | 核心表 | 说明 |
|---|---|---|
| 服务模板 | `awd_service_templates`, `awd_service_versions` | 镜像、端口、Checker、资源和基线不可变版本 |
| 比赛服务 | `awd_services` | 固定比赛快照、服务权重、启用状态 |
| 队伍服务 | `awd_team_services`, `awd_service_generations` | 每队每服务期望/观察状态、地址、写层和代次 |
| Tick | `awd_ticks` | 连续序号、时间窗口、状态、调度 owner |
| Flag | `awd_flags` | 队伍、服务、Tick、HMAC 摘要、加密投放材料和有效期 |
| Checker | `awd_checker_runs`, `awd_checker_evidence` | 动作、结果、证据摘要、任务关联与豁免 |
| 攻击 | `awd_attack_submissions`, `awd_flag_claims` | 追加提交与每攻击队唯一归功 |
| 计分 | `awd_score_events`, `awd_score_versions`, `awd_score_snapshots` | 三分量事实与可重建投影 |
| 网络 | `awd_vpn_peers`, `awd_terminal_sessions`, `awd_capture_objects` | 接入、会话与受限证据 |

数据库唯一约束保证 `(contest_id, tick_number)`、`(tick_id, service_id, participation_id)` Flag、以及 `(flag_id, attacker_participation_id)` 归功唯一。

**Alternatives considered:** 把 AWD 表塞进 `contest_challenges/submissions/solves` 会产生大量可空字段并污染唯一解语义；每个服务作为动态题会无法表达 Tick 和跨队攻击。

### 2. PostgreSQL 是 Tick 唯一时钟与事实来源

Nuxt 内部 scheduler 使用 PostgreSQL advisory lock 按比赛竞争调度权。每次事务读取最后 Tick、比赛状态和数据库时间，创建下一个连续 Tick、对应 Flag 记录和 outbox，再提交 Worker 任务。应用节点本地时间只用于观测，不决定 Tick 序号或有效期。

Tick 状态：

```text
scheduled -> active -> grace -> finalized
              |          |
              +-------> voided
paused controls creation of the next tick, not history
```

默认 active 120 秒；新 Tick 开始后上一 Tick 进入一个 Tick 长度的 grace。暂停阻止创建新 Tick；当前 Tick 由 organizer 明确选择自然结束或 void。恢复从最后持久化序号加一。

**Alternatives considered:** Redis 锁无法作为长期事实；固定 cron 容易在副本切换时重复；修改已经开始 Tick 的结束时间会破坏 Flag 有效性和重放。

### 3. Flag 由控制面生成并最小化明文保留

Nuxt 使用密码学随机数生成符合公开格式的 Flag。数据库保存：

- 带独立服务端 pepper 的 HMAC 摘要，用于提交查找与长期审计。
- 使用版本化信封密钥加密的明文，只在 put/get Checker 重试和宽限期内可解密。
- 队伍、服务、Tick、投放状态、有效起止时间与密钥版本。

宽限期和可重试窗口结束后清除密文，仅保留摘要、归属和遮罩。任务敏感载荷使用短期信封加密；Worker 只在 tmpfs 解密，不把 Flag 放入命令行、标准日志、标签或普通任务查询。

提交时规范化输入后计算 HMAC 索引，锁定 Flag 与攻击队归功键。当前/上一 Tick、成功投放、非本队且尚未被该攻击队认领时，事务创建 claim 与计分 outbox。

**Alternatives considered:** 可推导 HMAC Flag 减少存储但扩大主密钥影响面；长期保存明文便于调查但不符合最小暴露；把目标队编码进可读 Flag 会泄露归属。

### 4. Checker 使用版本化容器协议

每个服务版本引用不可变 Checker 镜像摘要和 `checker-v1` manifest。支持动作：

```text
check_service
put_flag
get_flag
```

Nuxt 创建带 action、目标、超时、payload schema 和密文引用的 `worker_jobs`。Worker 启动受限容器，将输入写入只读 tmpfs 文件并从专用结果文件读取严格 JSON；不把输入或结果正文转发到普通 stdout。沙箱使用非 root、只读根、无 ServiceAccount token、CPU/内存/PID/时间限制和只允许目标服务的 egress。

结果分类：

- `up`: 协议和预期状态正确。
- `down`: 无法连接或服务不可用。
- `mumble`: 可连接但协议/内容错误。
- `checker_error`: Checker 自身异常或结果 schema 无效，进入 organizer 复核且暂不计分。
- `platform_error`: Worker、调度或平台网络故障，自动排除计分分母。

Nuxt 消费 Worker 观察结果，在事务中创建 Checker 事实、更新 Flag 投放状态和推进分数；Worker 永不直接写 score events。

**Alternatives considered:** 在 Nitro 请求内运行 Checker 会让不可信代码进入控制面；外部 Webhook 难以统一隔离、证据和幂等；Worker 直接计分会形成第二套业务规则。

### 5. instance_jobs 演进为单一 worker_jobs

AWD migration 将未完成 `instance_jobs` 转换为 `worker_jobs`，保留 job id、状态、lease、fencing 和 attempt 历史。统一结构增加：

```text
kind, priority, capability, payload_version, result_version
subject_type, subject_id, desired_generation
```

任务种类至少包括：

```text
instance.ensure / inspect / destroy / reconcile
awd.checker.run
awd.service.restart / reset / reconcile
```

仍部署一个可横向扩容的 Worker 池。进程内使用独立 semaphore 和加权领取预算：Checker 高优先且保留固定并发槽，实例与维护任务不能占满 Checker 配额；任务 lease/fencing 规则保持不变。Worker 数据库角色只读任务敏感引用、只写 attempt/result/observation，不写 Flag claim、Tick 或 score。

**Alternatives considered:** 分三个 Worker 部署能缩小 RBAC，但用户选择单池；无配额 FIFO 会在批量实例重建时饿死 Tick Checker；消息中间件会增加尚未需要的持久化系统。

### 6. 三分量计分以追加事件结算

对队伍、服务和 Tick 计算可计分集合：

- 攻击分：该攻击队认领的不同对手有效 Flag 数 / 可获取的其他队伍成功投放 Flag 数。
- 可用性分：`up` 数 / (`up` + `down` + `mumble`)；`platform_error` 排除，`checker_error` 保持 pending，复核或重跑后才进入分母。
- Flag 保全分：宽限关闭时未产生任何对手 claim 的本队成功投放 Flag 数 / 本队成功投放 Flag 数。

默认总分：

```text
total = attack_ratio * 0.40
      + availability_ratio * 0.30
      + defense_ratio * 0.30
```

各服务默认权重 1，比赛发布前可配置正权重；发布后修改需要显式修订和重新结算。宽限期内 defense 为 provisional；finalize 事务追加 score events 并推进 score version。调整、void 和豁免通过补偿事件表达，不覆盖原始 Checker 或 claim。

排名为总分降序、攻击分降序、可用性分降序、稳定队伍 ID 升序。Redis 保存版本化快照缓存，PostgreSQL 事实可重建全部分量。

**Alternatives considered:** 零和转移容易滚雪球；只看 SLA 无法衡量 Flag 保全；直接更新累计列无法可靠重放豁免和 Tick 作废。

### 7. 每队使用隔离命名空间与稳定攻击网地址

Kubernetes 为每个比赛/队伍建立带完整标签的隔离 namespace，服务地址由比赛网段、参与记录和服务序号稳定分配。赛事 VPN 首选 WireGuard 接入层；Peer 绑定用户和设备，可单独轮换/撤销并设置比赛结束时间。

NetworkPolicy 分离：

- 攻击网只能访问所有队伍明确暴露的服务端口。
- 队伍服务不能访问 Nuxt、PostgreSQL、Redis、对象存储管理端、Kubernetes API 或其他队伍内部管理端口。
- Checker namespace 只能访问本次目标服务和必要结果出口。
- Worker 和终端网关使用独立 ServiceAccount 与最小网络路径。

Docker 开发 Provider 使用等价的专用 bridge/network 与标签，但生产验收以 Kubernetes 隔离为准。

**Alternatives considered:** 公网暴露每个服务简化接入但难以识别攻击来源并扩大 DDoS 面；向选手发 kubeconfig 无法限制管理能力；单共享 namespace 增加横向移动风险。

### 8. 受控终端管理可持久写层

每个服务由不可变基线镜像加队伍专属可写层组成。终端网关在 Nuxt 授权后签发短期一次性会话，绑定用户、队伍、比赛、服务、目的地址和过期时间；网关只连接目标容器的受限 shell/SSH sidecar，不代理任意地址。

普通重启保留写层并创建审计事件。恢复基线需要队长或 organizer 明确确认，创建新 service generation、销毁旧 runtime、替换写层并从不可变快照重建；历史 Tick、Checker、Flag 和分数不变。终端会话到期、用户退赛、Peer 撤销或比赛结束时主动关闭。

**Alternatives considered:** 只接受补丁包更易审计但反馈慢；直接 exec Kubernetes Pod 需要扩大网关 RBAC；允许宿主机 SSH 会破坏租户隔离。

### 9. 抓包是显式启用的独立数据面

默认攻击流量直接通过 VPN 和 Service。服务配置显式启用 capture 时，由独立 capture gateway 或 CNI 流量镜像记录 PCAP；Nuxt 和 Worker不处理数据包。捕获对象以独立信封密钥加密写入 S3，数据库保存服务、队伍、时间范围、摘要、大小、保留期限和审计引用。

只有 organizer/admin 可通过 Nuxt 重新授权后取得短期下载 URL；每次查看和下载记录原因与审计。默认比赛结束七天后删除密文并保留删除证明。选手不得查看自身或他队 PCAP。

**Alternatives considered:** 全流量强制代理形成中心瓶颈和额外故障域；只记录连接元数据不足以满足复盘；向队伍开放 PCAP 可能泄露攻击者和敏感载荷。

### 10. API 与实时投影按比赛 mode 隔离

新增主要接口组：

```text
GET  /api/contests/:id/awd/state
GET  /api/contests/:id/awd/services
POST /api/contests/:id/awd/flags
GET  /api/contests/:id/awd/scoreboard
POST /api/contests/:id/awd/vpn-peers
DELETE /api/contests/:id/awd/vpn-peers/:peerId
POST /api/contests/:id/awd/services/:serviceId/terminal-sessions
DELETE /api/contests/:id/awd/terminal-sessions/:sessionId
```

管理接口位于 `/api/admin/contests/:id/awd/**`，覆盖服务快照、Tick pause/resume/void、Checker 证据、豁免、重算、服务重启/恢复、VPN 和 PCAP。所有契约由共享 Zod Schema 生成 OpenAPI。

SSE 发布 Tick、服务观察、Checker 汇总和 scoreboard version，不发布 Flag、终端 Token、VPN 私钥或证据正文。断线使用 `Last-Event-ID` 恢复或 reset 后全量拉取。

## Risks / Trade-offs

- [单一 Worker 池拥有实例和 Checker 所需的较宽权限] → 沙箱容器、最小数据库列权限、任务 kind allowlist、并发配额和 Worker 行为审计。
- [控制面或数据库时间漂移影响 Tick 公平性] → 只使用 PostgreSQL 时间、唯一锁、连续序号、时钟偏差指标和暂停命令。
- [Checker 缺陷错误惩罚队伍] → `checker_error` 暂停计分、保留证据、支持重跑/豁免与补偿事件。
- [Flag 明文必须短期传给 Checker] → 信封加密、tmpfs、短期保留、日志隔离、密钥轮换和完成后清除。
- [VPN 或网络策略配置错误泄露管理面] → 默认拒绝、部署前连通矩阵测试、持续探针和安全事件告警。
- [队伍终端扩大容器逃逸风险] → 非特权、安全配置、禁止宿主挂载、独立网关、运行时检测和一键关闭全部会话。
- [宽限期使防守分暂时变化] → UI 明确 provisional/final 状态，只有 finalize 事件进入最终快照。
- [PCAP 包含敏感数据] → 按服务显式启用、加密、最小权限、审计、七天删除和容量上限。

## Migration Plan

### Phase 0: 依赖门禁

1. 确认核心 Jeopardy change 已实现、验收和归档。
2. 备份 PostgreSQL 与对象存储，并验证核心平台仍无 AWD 半实现资源。
3. 在隔离测试环境演练 contest mode、worker_jobs 和网络迁移。

**Rollback:** 尚未执行生产迁移，无运行影响。

### Phase 1: Schema 与任务协议扩展

1. 为 contests 添加可空 mode，回填全部既有记录为 `jeopardy`，再设为非空。
2. 创建 AWD 表、约束和只读投影，但保持功能开关关闭。
3. 将 instance_jobs 迁移到 worker_jobs，并运行实例生命周期回归。

**Rollback:** 功能未启用且没有 AWD 事实时可恢复旧 Worker 与 schema 备份；不得同时运行两种任务领取器。

### Phase 2: Checker、网络与终端

1. 部署升级后的单一 Worker 池与 Checker 沙箱。
2. 部署 VPN、攻击网、NetworkPolicy 和终端网关，在测试比赛验证隔离矩阵。
3. 部署可选 capture 数据面并验证加密、授权和删除。

**Rollback:** 禁用 AWD 功能开关、关闭 Peer/终端、销毁带 AWD 标签资源；Jeopardy 实例继续由 worker_jobs 处理。

### Phase 3: Tick 与计分影子运行

1. 创建内部测试 AWD 比赛，运行 Tick、Flag、Checker 和攻击提交全流程。
2. 对每个 Tick 执行离线重放并比较实时快照，不向公开用户开放。
3. 完成故障、容量、安全和暂停/恢复演练。

**Rollback:** 作废测试 Tick并销毁测试网络；没有正式公开成绩。

### Phase 4: 正式启用

1. 开启 AWD 创建与管理入口，但只允许 organizer/admin 配置草稿。
2. 通过发布前检查后开放首场正式比赛。
3. 比赛期间监控 Tick 延迟、Checker pending、Worker 队列、VPN、服务可用性和 score version lag。

**Rollback:** 正式 Tick 开始后不切回旧模型；严重故障使用暂停、void、豁免和恢复命令保持单一事实源。
