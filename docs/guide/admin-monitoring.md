# 管理监控

`/console/admin/monitoring` 使用专用 `GET /api/admin/monitoring`，从 PostgreSQL 返回生成时间明确的安全投影。可按比赛、题目、队伍、状态和条数筛选：

- `submissions`、`cheat_clues`；
- `instances`、`instance_jobs`；
- `announcements`、`notifications`、`mail_deliveries`；
- `writeups`、`audit_events`。

实例与任务项包含 Worker 最近观察时间和是否超过 `WORKER_OBSERVATION_STALE_SECONDS`。页面不得把 Redis 数据当作权威状态，也不得显示完整提交答案、Flag、邮件 payload、Cookie、令牌、签名 URL 或 Provider 凭据。

值班人员应关联 `request_id`、`job_id` 和 `instance_id` 查看结构化日志与 trace，并结合 Worker 私有 `/metrics` 判断队列、租约丢失、重试、死信和 Provider 延迟。修复根因后，通过 `/console/admin/operations` 执行受控缓存重建、死信重放、实例对账、Session 失效或结果重算，禁止直接修改生产数据库。
