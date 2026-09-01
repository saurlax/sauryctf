## Purpose

定义经典 AWD 攻防赛从服务发布、Tick 调度、Flag 轮换、Checker 判定、攻击提交到三分量计分的完整行为，并约束赛事 VPN、受控终端、数据面抓包、故障豁免与结果重放，使其能够作为独立赛制安全运行。

## ADDED Requirements

### Requirement: AWD 只能在核心平台完成后启用
平台 SHALL 仅在核心 Jeopardy 平台的身份、队伍、比赛、参赛、审计、对象存储和实例编排能力完成并通过发布验收后启用 AWD；未启用部署 MUST 不暴露 AWD 页面、API、任务类型或网络入口。

#### Scenario: 首期部署探测 AWD 接口
- **WHEN** 客户端在尚未应用本 change 的部署请求 AWD 接口
- **THEN** 平台返回不存在或未启用，且不创建任何 AWD 数据或任务

### Requirement: AWD 是独立且不可混合的比赛模式
平台 SHALL 为比赛声明 `jeopardy` 或 `awd` 模式；AWD 比赛 MUST 不挂载 Jeopardy 题目或使用 Jeopardy Flag 提交与计分路径，同一比赛 MUST 不同时启用两种赛制。

#### Scenario: 管理员向 AWD 比赛挂载 Jeopardy 题目
- **WHEN** 管理员尝试把普通比赛题目挂载到 AWD 比赛
- **THEN** 平台拒绝操作并保持比赛服务配置不变

### Requirement: AWD 服务使用不可变版本快照
AWD 服务 SHALL 由可复用模板与不可变版本描述，并在加入比赛时创建包含镜像、端口、Checker 版本、资源限制、网络策略和基础文件系统的比赛服务快照；模板后续修改 MUST 不改变已发布比赛。

#### Scenario: 比赛发布后更新服务模板
- **WHEN** organizer 发布新的服务模板版本
- **THEN** 运行中比赛继续使用原服务快照，新的比赛可显式选择新版本

### Requirement: 每支参赛队拥有隔离服务部署
每个已接受队伍对每个启用 AWD 服务 SHALL 拥有一个独立、稳定标识的服务部署与攻击网地址；队伍服务的期望状态、观察状态和当前代次 SHALL 可独立查询和对账。

#### Scenario: 一支队伍服务重启
- **WHEN** organizer 或队伍执行获权重启
- **THEN** 仅该队该服务进入新观察周期，其他队伍和服务不得受影响

### Requirement: Tick 由唯一权威时钟推进
AWD 比赛 SHALL 按配置 Tick 时长推进，默认 120 秒；任一 Tick SHALL 具有唯一序号、开始时间、结束时间和状态，控制面副本并发调度 MUST 至多创建一个相同 Tick。

#### Scenario: 调度主节点在 Tick 边界失联
- **WHEN** 两个控制面副本竞争创建下一 Tick
- **THEN** 平台只持久化一个 Tick，失败副本读取已存在结果并继续服务

### Requirement: Tick 生命周期可暂停和恢复
organizer SHALL 能以带原因的命令暂停新 Tick、恢复调度或结束比赛；暂停 MUST 不静默修改已结算 Tick，恢复 SHALL 从下一个连续序号开始。

#### Scenario: 平台网络故障时暂停
- **WHEN** organizer 因平台故障暂停 AWD
- **THEN** 当前 Tick 按声明策略结束或作废，新 Tick 停止创建，操作和原因进入审计

### Requirement: Flag 按队伍服务与 Tick 唯一轮换
平台 SHALL 为每个队伍、服务和 Tick 生成不可预测且唯一的 Flag，并保存校验摘要、归属、有效窗口与受保护的投放材料；Flag 明文 MUST 不进入普通日志、公共事件或选手管理响应。

#### Scenario: 两支队伍同一服务进入相同 Tick
- **WHEN** 平台生成该 Tick 的服务 Flag
- **THEN** 两队获得不同 Flag，任一 Flag 均可确定归属到唯一队伍、服务和 Tick

### Requirement: 当前与上一 Tick Flag 有效
攻击提交 SHALL 接受当前 Tick 和紧邻上一 Tick 中已经成功投放的 Flag；更早、未成功投放或已作废 Tick 的 Flag MUST 不得计分。

#### Scenario: Tick 切换后的网络延迟提交
- **WHEN** 攻击队在新 Tick 开始后提交上一 Tick 的有效对手 Flag
- **THEN** 平台在宽限窗口内接受并按上一 Tick 归属计分

### Requirement: Checker 结果具有明确分类
Checker 运行 SHALL 产生 `up`、`down`、`mumble`、`checker_error` 或 `platform_error` 之一，并保存服务、队伍、Tick、Checker 版本、开始结束时间与证据摘要；平台故障 MUST 与队伍服务故障分离。

#### Scenario: Checker 沙箱无法启动
- **WHEN** 因平台调度故障无法运行 Checker
- **THEN** 结果记为 `platform_error`，不把该次检查作为队伍可用性失败

#### Scenario: 服务响应格式错误
- **WHEN** Checker 能连接服务但响应不满足协议
- **THEN** 结果记为 `mumble` 并进入该队可用性分母

### Requirement: 攻击提交按攻击队唯一归功
成功提交 SHALL 记录攻击队、受害队、服务、Flag Tick 和服务端时间；同一攻击队对同一 Flag 最多获得一次攻击归功，不同攻击队可分别获得一次，本队 Flag、重复或无归属 Flag MUST 不得计分。

#### Scenario: 两支攻击队提交同一受害 Flag
- **WHEN** 两支不同队伍在有效期内分别提交同一个受害 Flag
- **THEN** 两队各获得一次攻击归功，受害队 Flag 保全状态只失败一次

#### Scenario: 攻击队重复提交同一 Flag
- **WHEN** 同一攻击队再次提交已计分 Flag
- **THEN** 平台返回重复结果且不增加攻击分或计分事件

### Requirement: 攻击提交不泄露额外归属信息
无效、过期、本队和已经重复的攻击提交 SHALL 使用不会帮助枚举受害队或 Tick 的稳定响应边界；完整归属和证据只向 organizer/admin 开放。

#### Scenario: 选手提交随机字符串
- **WHEN** 字符串无法匹配有效 Flag
- **THEN** 平台返回统一未接受结果，不公开是否曾存在相同前缀、目标队伍或服务

### Requirement: 总分由三项非零和分量组成
AWD 总分 SHALL 默认由攻击 40%、可用性 30%、Flag 保全 30% 加权组成；攻击分按已获取的可获取对手 Flag 比例计算，可用性按已完成 `up`、`down`、`mumble` 检查中的 `up` 比例计算，Flag 保全按未被任何对手成功提交的本队有效 Flag 比例计算。`platform_error` SHALL 自动排除，`checker_error` SHALL 保持待复核且在重跑、豁免或重分类前不得进入分母。

#### Scenario: 某 Tick 发生平台级 Checker 故障
- **WHEN** 某批检查结果为 `platform_error`
- **THEN** 这些检查不进入可用性分母，重算前后不会降低相关队伍可用性分

### Requirement: 分数在宽限窗口关闭后确定
仍在上一 Tick Flag 有效窗口内的防守结果 SHALL 标记为暂定；宽限窗口关闭后平台 SHALL 结算该 Tick 的 Flag 保全结果并生成不可变计分事件，晚到提交 MUST 不改写已关闭结果。

#### Scenario: 上一 Tick 最后一秒发生有效攻击
- **WHEN** 攻击提交在宽限窗口关闭前由服务器接收
- **THEN** 该 Flag 记为未保全并参与最终防守分结算

### Requirement: AWD 计分可完整重放
排行榜 SHALL 只由比赛服务快照、Tick、Checker 结果、有效攻击归功、Flag 保全结算和显式调整派生；缓存和实时事件 MUST 不作为事实来源，平台 SHALL 支持按服务、队伍、Tick 和整场比赛重建相同结果。

#### Scenario: 删除 AWD 排行榜缓存
- **WHEN** organizer 清空某场比赛的 AWD 排行榜缓存并请求重建
- **THEN** 新快照的三项分量、总分和稳定排名与相同事实集的旧快照一致

### Requirement: 排名规则稳定且公开
AWD 排名 SHALL 按总分降序、攻击分降序、可用性分降序、稳定队伍标识升序排列；比赛规则页 SHALL 展示 Tick 时长、Flag 窗口、分量权重和排序规则。

#### Scenario: 两队三项分数完全相同
- **WHEN** 两队总分、攻击分和可用性分均相同
- **THEN** 平台按稳定队伍标识给出可重复顺序

### Requirement: 赛事 VPN 隔离攻击网络
AWD SHALL 通过独立赛事 VPN 向参赛者提供攻击网络访问；每个 Peer SHALL 可单独轮换和撤销，攻击网络 MUST 不允许访问 Nuxt 控制面、PostgreSQL、Redis、对象存储管理端或 Kubernetes 管理面。

#### Scenario: 选手从 VPN 访问控制面内部地址
- **WHEN** VPN Peer 尝试连接被保护的管理网段
- **THEN** 网络策略拒绝连接并产生可观察安全事件

### Requirement: 受控终端不授予集群凭据
队伍 SHALL 能通过独立终端或 SSH 网关访问本队服务环境并持久修改允许的写层；会话 MUST 绑定用户、队伍、比赛和服务，MUST 不提供 Kubernetes 凭据、宿主机访问或其他队伍文件系统。

#### Scenario: 队员打开本队服务终端
- **WHEN** 已接受且已验证的队员请求终端会话
- **THEN** 平台创建短期、可撤销、可审计的本队服务会话，并阻止跨服务与跨队访问

### Requirement: 服务可以恢复到不可变基线
队伍或 organizer SHALL 能按比赛策略重启服务或恢复到比赛服务快照；恢复 SHALL 创建新代次、清除队伍写层并记录确认、原因、操作者和结果，MUST 不改变历史 Checker、Flag 或计分事实。

#### Scenario: 队伍执行恢复基线
- **WHEN** 队长确认恢复本队某服务
- **THEN** 平台创建新服务代次并保留历史运行和计分记录，不影响其他队伍

### Requirement: AWD 服务流量绕过控制面
攻击和服务流量 MUST 不通过 Nuxt 或 Go Worker 代理；按服务显式启用抓包时 SHALL 由独立数据面捕获并加密保存，只有 organizer/admin 可审计下载，默认 SHALL 在比赛结束七天后删除。

#### Scenario: 普通选手请求 PCAP
- **WHEN** 普通队员知道抓包对象标识并直接请求下载
- **THEN** 平台拒绝访问且不泄露对象元数据或签名 URL

### Requirement: 高风险 AWD 操作必须审计
暂停 Tick、作废 Tick、豁免 Checker、调整分数、恢复服务基线、轮换 VPN、打开完整证据和下载 PCAP SHALL 要求获权角色、非空原因和明确确认，并产生不可变审计事件。

#### Scenario: organizer 豁免一次错误检查
- **WHEN** organizer 确认该检查属于平台故障并填写原因
- **THEN** 平台追加豁免与重算事件，保留原 Checker 结果且不原地覆盖证据

### Requirement: AWD 实时状态可恢复
Tick、服务观察、Checker 汇总和排行榜版本事件 SHALL 具有稳定事件标识；客户端断线重连 SHALL 能补发有限窗口内事件或收到 reset 并重新读取当前权威投影。

#### Scenario: Tick 切换时客户端断线
- **WHEN** 客户端错过 Tick 与排行榜事件后携带最后事件标识重连
- **THEN** 平台补发可用事件或要求完整刷新，不展示无法验证的中间 Tick
