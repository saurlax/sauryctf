## Purpose

定义平台各运行组件的职责、数据所有权和信任边界，使 Web 业务、缓存和基础设施编排可以独立演进且不会形成第二套事实来源。

## ADDED Requirements

### Requirement: Nuxt 控制面是唯一公网业务入口
平台 SHALL 只通过 Nuxt/Nitro 控制面对浏览器和外部 API 客户端提供业务接口；Go Worker MUST 不暴露用户、队伍、比赛、提交或管理员公网接口。

#### Scenario: 浏览器创建动态实例
- **WHEN** 已授权用户请求创建题目实例
- **THEN** 请求由 Nuxt 控制面完成身份、比赛和配额判断，并写入内部任务，而不是由浏览器直接访问 Worker 或集群

### Requirement: Go Worker 只执行基础设施期望状态
Go Worker SHALL 只消费经过持久化的实例任务、操作获准的运行时 Provider、执行对账并回写观察状态；它 MUST 不实现用户登录、比赛报名、Flag 判定或排行榜规则。

#### Scenario: Worker 收到越权任务数据
- **WHEN** 任务要求 Worker 修改非实例领域数据或访问未授权命名空间
- **THEN** Worker 拒绝执行、记录结构化错误并保持业务事实数据不变

### Requirement: PostgreSQL 是权威事实来源
平台 SHALL 将身份、业务事务、提交、解题、实例期望状态、任务和审计记录保存在 PostgreSQL；Redis、进程内缓存和实时通道 MUST 只保存可重建的派生数据。

#### Scenario: Redis 数据全部丢失
- **WHEN** Redis 被清空但 PostgreSQL 可用
- **THEN** 平台能够从 PostgreSQL 重建缓存且不得丢失比赛成绩、权限、租约所有权或任务状态

### Requirement: 组件故障相互隔离
控制面 SHALL 在 Worker 或运行时不可用时继续提供不依赖实例编排的读写能力；Worker SHALL 在控制面滚动重启时继续完成已领取任务或安全释放任务租约。

#### Scenario: Kubernetes 暂时不可达
- **WHEN** Worker 无法访问 Kubernetes API
- **THEN** 登录、比赛浏览和静态题提交仍可工作，实例请求显示可重试的明确状态而非伪装为运行中

### Requirement: API 契约可验证和可演进
所有公网 API SHALL 具有版本化、机器可读的契约和统一错误结构；契约生成、运行时输入校验和客户端类型 MUST 在 CI 中验证一致。

#### Scenario: 实现响应偏离契约
- **WHEN** API 实现新增未声明的必填输入或改变已声明字段类型
- **THEN** 契约测试在合并前失败
