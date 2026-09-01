## Purpose

定义控制面与 Go Worker 之间可持久化、可重试的动态实例协议，并约束 Docker/Kubernetes 资源隔离、租约、就绪与垃圾回收行为。

## ADDED Requirements

### Requirement: 实例由期望状态和观察状态描述
每个队伍参赛记录与比赛题目组合 SHALL 至多存在一个当前实例聚合，分别保存控制面期望状态、期望代次和 Worker 观察状态；浏览器响应 MUST 不把“任务已接受”等同于“实例已就绪”。

#### Scenario: 用户请求启动实例
- **WHEN** 合格队伍没有活动实例并请求启动
- **THEN** 控制面原子写入新代次和启动任务，立即返回 `pending`，直到 Worker 报告入口就绪才返回 `running`

### Requirement: 实例命令通过持久化任务传递
启动、续期、销毁和对账命令 SHALL 写入 PostgreSQL 任务表，并包含任务标识、幂等键、实例标识、期望代次、操作类型、载荷版本和创建时间。

#### Scenario: 控制面提交任务后重启
- **WHEN** 控制面在写入启动任务后立即重启
- **THEN** 未完成任务仍可被 Worker 领取且不会要求用户重新创建业务记录

### Requirement: Worker 领取具有租约和幂等语义
Worker SHALL 通过原子领取获得任务租约，定期续约并记录尝试次数；租约到期的任务可由其他 Worker 重试，相同幂等键和期望代次的重复执行 MUST 收敛到同一资源结果。

#### Scenario: Worker 创建资源后失联
- **WHEN** Worker 已创建运行资源但尚未回写成功便失去任务租约
- **THEN** 后续 Worker 通过确定性标识发现并复用或修复该资源，而不是无界创建副本

### Requirement: 失败分类和死信可操作
Worker SHALL 区分可重试故障、永久配置错误和取消；超过策略上限的任务 SHALL 进入死信状态并保留最后错误、尝试历史和关联实例，管理员可以在修复后显式重放。

#### Scenario: 镜像不存在
- **WHEN** Provider 确认配置的镜像无法拉取且重试不会自动恢复
- **THEN** 任务进入永久失败或死信，实例显示可理解错误且不会无限快速重试

### Requirement: Provider 遵守统一生命周期契约
Docker 和 Kubernetes Provider SHALL 实现相同的确保存在、检查、确保销毁和入口解析语义，并对不存在资源的销毁返回成功；Provider 特有字段 MUST 受版本化配置约束。

#### Scenario: 重复销毁不存在的实例
- **WHEN** 同一实例销毁任务被重复执行且资源已不存在
- **THEN** Provider 返回已收敛结果，实例最终状态保持 `stopped`

### Requirement: 运行资源受到强隔离
Worker MUST 为每个资源设置平台、比赛、题目、队伍、实例和代次标签，限制 CPU、内存和临时存储，默认关闭特权、宿主机挂载与 ServiceAccount Token，并按题目网络策略限制通信。

#### Scenario: Worker 对账发现无平台标签资源
- **WHEN** 对账扫描到命名空间内缺少平台所有权标签的资源
- **THEN** Worker 不接管也不删除该资源，并记录可观测警告

### Requirement: 租约和队伍配额由控制面裁决
控制面 SHALL 在事务中执行初始时长、续期增量、续期窗口、每队活动实例上限和比赛阶段规则；Worker SHALL 执行任务给出的有效到期边界但不得自行扩大配额。

#### Scenario: 过早续期
- **WHEN** 队伍在续期窗口开始前请求续期
- **THEN** 控制面拒绝创建续期任务并返回下一次可续期时间

### Requirement: 对账清理过期和孤儿资源
Worker SHALL 周期性比较数据库期望状态与带平台标签的运行资源，清理已过期或应销毁资源，修复可恢复偏差，并将无法安全判断的孤儿资源提交人工处置而非直接删除。

#### Scenario: 数据库实例已停止但资源仍存在
- **WHEN** 对账发现相同实例代次的资源仍在运行而期望状态为停止
- **THEN** Worker 幂等销毁资源并回写观察状态

### Requirement: 入口信息只在就绪且获权时返回
实例主机、端口、URL 和临时凭证 SHALL 只返回给对应队伍成员和获权管理员，且仅在健康检查确认入口就绪后返回；内部集群地址和未解析模板 MUST 不暴露给选手。

#### Scenario: Pod 已创建但尚未 Ready
- **WHEN** Kubernetes 已接受 Pod 和 Service 但容器尚未通过就绪检查
- **THEN** 选手看到 `starting` 状态且不会收到不可用的伪入口
