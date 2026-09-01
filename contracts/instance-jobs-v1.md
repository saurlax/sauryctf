# `instance_jobs` v1 内部契约

`instance_jobs` 是 Nuxt 控制面到私有 Go Worker 的持久化边界。数据库列
`operation`、`payload_version`、`instance_id`、`desired_generation` 和
`idempotency_key` 与 JSON envelope 同时参与校验；Worker 不对未知版本或未知
操作执行猜测性降级。

v1 只允许以下操作：

- `ensure`：按规范确保运行资源存在，必须携带完整 runtime spec。
- `inspect`：只观察当前代次资源，不改变期望状态。
- `destroy`：幂等确保当前代次资源不存在。
- `reconcile`：向显式 `running` 或 `stopped` 期望状态收敛；运行态必须携带
  spec，停止态不得携带 spec。

每个 payload 都固定 `schema: instance-job.v1`、Provider、到期边界以及比赛、
比赛题目、参赛和队伍 owner 标识。Owner 标识直接进入任务，是因为受限 Worker
不得查询用户、队伍或比赛业务表。runtime spec 使用规范化镜像、入口、非敏感
环境变量、资源上限和网络策略；`SAURYCTF_` 前缀保留给平台注入。敏感环境只能
通过不透明的 `instance-secrets.v1` envelope 传递，不能作为普通环境变量明文出现。
该 envelope 使用随机数据密钥加密载荷，再由部署密钥环中的 AES-256-GCM 密钥包装
数据密钥；认证附加数据绑定 Provider、比赛、比赛题目、队伍、实例和期望代次。
Worker 只在调用 Provider 前解密，并在调用完成后清零明文缓冲区。Kubernetes 通过
属于同一实例代次的 SecretKeyRef 注入，Docker 只通过 Engine API 创建请求注入；
普通任务投影、结构化日志和资源标签不得包含 Flag 明文。旧包装密钥必须保留到
引用它的实例代次被销毁，以支持声明式对账重建。

运行时定义分别位于：

- TypeScript：`apps/web/shared/contracts/instance-jobs.ts`
- Go：`apps/worker/internal/contracts/instance_jobs.go`
- 跨语言夹具：`contracts/fixtures/instance-jobs/`

两个实现都执行严格字段检查，并用同一组 `ensure`、`inspect`、`destroy`、
`reconcile` JSON 夹具做语义往返测试。新增字段或改变语义时必须发布新的
`payload_version`，不能静默改变 v1。
