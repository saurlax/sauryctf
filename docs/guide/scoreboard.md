# 排行榜

排行榜只从 PostgreSQL 中的比赛题目快照、正式解和显式计分调整派生。练习解、Redis、SSE 和客户端状态不参与权威计分。

## 排名规则

总榜和分组榜使用同一套事实，分组只改变参与排序的队伍集合。稳定排序顺序为：

1. 总分降序；
2. 最后一次计分事件时间升序；
3. 稳定参赛标识升序。

每道题的 `fixed-v1` 或 `decay-v1` 参数在比赛题目快照中固定。动态题值、正式解数、前三解和总分都可从不可变事实重放。

## 接口与视图

公共榜使用 `GET /api/contests/{contestId}/scoreboard`，支持总榜和比赛分组视图。管理员内部实时榜使用 `/api/admin/contests/{contestId}/scoreboard`，不得写入公共缓存或返回给普通选手。

配置封榜后，公共视图固定在封榜时可见事实；封榜后的正确提交继续写入正式事实并更新内部榜。比赛公开结算后再按策略展示最终排名。

## 缓存与实时更新

Redis key 包含 schema、比赛、视图、分组和排行榜版本。影响榜单的事务先提交 PostgreSQL 事实和 Outbox，再发布可去重的版本失效与 SSE 事件。客户端携带 `Last-Event-ID` 重连；恢复窗口不足时收到 reset，并重新拉取完整榜单。

Redis 清空或不可用时，控制面使用进程内 single-flight、短锁、限频重建和 PostgreSQL 持久快照降级。缓存故障不得改变权限、重复计分、泄露内部榜，也不得令每个请求独立执行全量重建。

## 运维核对

排行榜超过 5 秒未更新时，依次检查 PostgreSQL scoreboard version、Outbox、Redis、SSE 和客户端版本。修复根因后由 `admin` 在 `/console/admin/operations` 执行 `cache_rebuild`；若怀疑权威派生结果错误，执行 `result_recalculate` 并核对不可变提交、解题和调整事实。禁止直接修改缓存或榜单快照来裁决正式成绩。
