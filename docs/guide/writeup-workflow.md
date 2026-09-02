# Writeup 工作流

比赛可以配置是否要求 Writeup 和截止时间。只有邮箱已验证、参赛状态为 `accepted` 的队伍才能读写本队 Writeup。

选手接口：

- `GET /api/contests/{contestId}/writeup` 读取当前状态与最新版本；
- `PUT /api/contests/{contestId}/writeup` 保存新版本；
- `POST /api/contests/{contestId}/writeup/submit` 提交审核。

正文和附件引用版本化保存，已提交版本不会被静默覆盖。截止后普通选手不能继续保存或提交；管理员纠正必须带原因并留审计。

管理接口位于 `/api/admin/contests/{contestId}/writeups/**`，支持筛选、审核、纠正和批量导出。审核决定与备注对有权队伍可见。导出包保留版本和附件引用，下载仍需重新授权。

Writeup 事实与正式计分分离；未提交或审核状态不能改写提交、解题或排行榜。对象存储故障时不得把控制面本地磁盘当作权威附件存储。
