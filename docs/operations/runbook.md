# 运维 Runbook

## 日常观察

以 PostgreSQL 中的事实为判断依据。进程内状态只用于 single-flight 等无损优化，不能用于裁决成绩、权限或实例所有权。

基础检查：

```bash
curl --fail https://ctf.example/api/health/live
curl --fail https://ctf.example/api/health/ready
curl --fail http://worker.private/health/live
curl --fail http://worker.private/health/ready
curl --fail http://worker.private/metrics
```

结构化日志应携带 `request_id`，实例链路还应携带 `job_id` 和 `instance_id`。OpenTelemetry 可通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 或分信号 endpoint 启用；控制面默认 service name 为 `sauryctf-control-plane`。告警和仪表盘不得记录 Flag、提交答案、sealed Cookie、邮箱令牌、对象存储签名 URL 或 Provider 凭据。

管理员在 `/console/admin/monitoring` 检查以下 PostgreSQL 投影：

- 提交与反作弊线索；
- 实例观察和陈旧状态、任务重试与死信；
- 公告、通知与邮件投递；
- Writeup 与不可变审计。

同一页面的数据服务卡片只显示 PostgreSQL 健康、NuxtHub migration 是否为当前版本，以及所选 `fs|s3` Blob 是否健康。不得把数据库 URL、bucket、endpoint、绝对目录或凭据复制到工单和聊天记录。

至少监控 PostgreSQL 可用性和连接数、Blob 错误率、邮件积压、实例任务队列深度/租约丢失/死信、Provider 延迟、排行榜版本延迟和控制面 p95。

登录、邮箱安全操作和 Flag 提交的限流记录位于 PostgreSQL；热点、锁等待或保留任务积压会直接影响安全写请求。平台没有共享 cache 或 SSE，排行榜客户端使用 3–5 秒可见性 HTTP 轮询，排障时不要寻找消息代理消费者。

## 受控运维命令

所有命令从 `/console/admin/operations` 或 `POST /api/admin/operations` 发起，只允许 `admin`，必须提供目标 UUID、至少 10 个字符的原因、确认字段以及幂等键。命令会写不可变审计。禁止通过生产数据库直接 UPDATE/DELETE 代替命令。

| 命令 | 目标 | 用途 |
| --- | --- | --- |
| `dead_letter_replay` | 死信任务 | 修复根因后重新排队，重复请求保持幂等 |
| `instance_reconcile` | 实例 | 创建当前代次的显式对账任务 |
| `session_invalidate` | 用户 | 递增 `session_version`，使全部旧 Cookie 失效 |
| `result_recalculate` | 比赛 | 从不可变提交、解题与调整事实重放成绩 |

执行前记录事件号、目标、当前版本和预期结果；执行后核对命令结果、审计、版本推进和下游观察。失败时不要直接改表，先确认权限、前置状态和根因。

## 赛前

- 验证最近一次备份、RPO/RTO 演练和恢复证据；
- 运行发布验收门禁和 Jeopardy smoke；
- 检查控制面/Worker ready、数据库连接预算和 Blob 存储容量；
- 检查 SMTP 投递、域名、TLS、Gateway/Ingress、NetworkPolicy 和实例配额；
- 对每道题执行发布完整性检查，确认 Flag、附件、题目快照、计分策略、路由和资源限制；
- 验证公共榜、封榜时间、分组、公告和 Writeup 截止时间；
- 清空测试账号、测试比赛和测试实例只能通过受控业务流程完成。

## 赛中

- 观察提交 p95、排行榜版本延迟、邮件和实例队列；
- Worker 或 Provider 故障时保留静态题、登录和提交能力，不把 pending 伪报为 running；
- 修题、成绩调整、队伍纠正和实例处置必须带原因并留审计；
- 封榜后只向 organizer/admin 显示内部实时榜，公开快照不得包含内部视图。

## 赛后

- 结束并公开结算后重放成绩，核对稳定排名和分组榜；
- 导出比赛包、榜单、提交、Writeup 和审计证据；
- 销毁过期实例并处理孤儿报告；
- 复核死信、失败邮件和反作弊线索；
- 保留正式赛事实；审计默认一年、安全日志 90 天、临时未引用上传 24 小时，按策略清理派生数据。

## 常见降级

- Worker 不可用：实例请求保持 pending/retry 状态；静态题和控制面业务继续运行。
- Kubernetes API 不可用：暂停相关 Provider 领取或降低并发，不修改实例事实；恢复后显式对账。
- 对象存储不可用：阻止新上传和受影响下载；提交计分与无附件页面继续运行。
- SMTP 不可用：安全事务保持成功，邮件进入可重试队列；站内通知继续可见。
- 单个控制面副本故障：从负载均衡摘除，不依赖本地内存恢复权威状态。

fs 模式目录不可写时保持进程 live 但摘除 ready；修复持久卷所有权和挂载后再恢复流量，禁止临时改用另一台机器的空目录。S3 模式故障时不得降级到 fs。驱动切换必须先运行 `pnpm --filter sauryctf-web blob:migrate` 并看到完整摘要校验通过；失败时保留源端配置和对象，不删除已复制的目标对象，以便幂等重跑。

更严重的事件按 [应急响应](./incident-response.md) 处理。
