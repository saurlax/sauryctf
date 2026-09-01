## Why

首期 Jeopardy 平台稳定后，需要以独立竞赛领域增加经典 AWD，而不是把攻防赛塞进普通题目分类或复用同步 Flag 提交模型。独立 change 可以完整定义 Tick、Checker、服务网络、Flag 轮换和三分量计分，同时确保首期重构不被 AWD 的基础设施复杂度阻塞。

## What Changes

- 在已完成的 Jeopardy 核心平台上新增 `awd` 比赛模式；既有比赛回填为 `jeopardy`，同一比赛不支持混合赛制。
- 新增 AWD 服务与不可变服务版本、队伍服务部署、Tick、Flag、Checker 运行、攻击提交、计分事件、排行榜快照、VPN Peer 和终端会话。
- 使用 120 秒默认 Tick，并通过 PostgreSQL 协调唯一 Tick 调度者；当前与上一 Tick Flag 有效。
- 使用攻击 40%、可用性 30%、Flag 保全 30% 的非零和计分；同一 Flag 每个攻击队最多得分一次。
- 将 `instance_jobs` 扩展为版本化 `worker_jobs`，由单一可横向扩容 Go Worker 池执行实例、Checker 和服务维护任务，但业务计分仍只由 Nuxt 完成。
- 新增独立赛事 VPN、稳定攻击网地址和受控终端/SSH 网关；队伍不得获得 Kubernetes 凭据或访问控制面网络。
- AWD 服务流量不经过 Nuxt；按服务显式启用的抓包由独立数据面执行，PCAP 加密保存且仅 organizer/admin 可审计下载。
- 新增 AWD 选手与管理 API、实时 Tick 状态、三分量排行榜、重算和故障豁免流程。
- 本 change 当前只准备规划产物，MUST NOT 在首期 Jeopardy change 完成前实施。

## Capabilities

### New Capabilities

- `awd-competition`: 定义经典 AWD 的比赛模式、服务生命周期、Tick、Flag、Checker、攻击提交、计分、VPN、受控终端、数据面与运维验收行为。

### Modified Capabilities

无。该 change 通过独立能力扩展已完成的核心平台；应用前须确认核心 Jeopardy 规范已经归档并作为依赖基线。

## Impact

- PostgreSQL 新增 AWD 领域表，并为比赛增加模式字段及 Jeopardy 数据回填迁移。
- Nuxt 新增 Tick scheduler、AWD 领域服务、攻击提交、三分量排行榜、管理操作、SSE 和公开页面。
- Go Worker 任务协议从实例专用扩展为带任务种类、优先级与并发配额的统一协议，并增加沙箱 Checker 执行。
- Kubernetes 部署新增赛事攻击网络、VPN 接入、终端网关、Checker Job、服务隔离策略和可选抓包数据面。
- 对象存储新增受限 PCAP 与服务修订产物引用；审计、指标、备份和故障演练扩展到 AWD。
- 该 change 不改变首期发布完成条件，只有在独立 apply 请求后才允许实现。
