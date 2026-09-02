# 备份与恢复

## 目标与范围

赛时目标为 RPO 不超过 5 分钟、RTO 不超过 30 分钟。备份必须同时覆盖：

- PostgreSQL custom-format dump 或等价的一致恢复点；
- 启用版本保留的 S3 兼容对象存储镜像；
- 发布版本、迁移版本、对象 bucket、时间戳和 SHA-256 清单。

Redis、进程内缓存、SSE 恢复窗口和本地临时上传不备份。它们必须从 PostgreSQL 和对象存储重建。部署 Secret 使用独立的 Secret 管理系统备份，不能写进数据库 dump 或对象镜像。

## 备份

1. 记录权威截止时间和当前发布版本。
2. 使用 `pg_dump --format=custom --no-owner --no-privileges` 创建 PostgreSQL dump。
3. 将内容 bucket 镜像到启用版本控制、访问隔离的备份 bucket。
4. 计算 dump SHA-256，记录对象数量、版本标识和备份完成时间。
5. 对备份产物执行加密、访问控制、异地保存和保留策略；备份账号不得拥有生产写权限。

持续归档或增量机制必须确保任一已声明恢复点的数据库引用与对象版本可共同恢复。赛时每 5 分钟内形成可用恢复点，并监控备份落后时间。

## 隔离恢复

1. 创建与生产隔离的新 PostgreSQL 和空对象 bucket，不覆盖现有生产环境。
2. 校验 dump SHA-256 和对象版本清单。
3. 使用 `pg_restore --no-owner --no-privileges --exit-on-error` 恢复数据库。
4. 恢复对应版本的对象存储镜像。
5. 使用当前发布的 readiness 验证迁移 journal 完全匹配。
6. 抽样并自动核对 `content_objects.sha256_digest`、对象大小和实际对象内容。
7. 从正式解、计分调整和题目快照重放排行榜；不能恢复 Redis 快照代替重放。
8. 执行 Jeopardy smoke，检查用户/角色、比赛、提交、榜单、Writeup、实例期望与审计。
9. 记录最后恢复事实时间、实际 RPO/RTO、校验结果和审批人后，才允许切换流量。

## 自动演练

```bash
pnpm test:backup-recovery
```

脚本会创建隔离 PostgreSQL、源/备份/恢复对象存储，生成权威比赛事实和附件，执行 custom dump 与版本化对象镜像，停止源服务，在全新环境恢复，验证附件 SHA-256 并重建排行榜。超过 300 秒 RPO 或 1800 秒 RTO 会直接失败。成功输出包含：

```text
BACKUP_RECOVERY {"status":"passed",...,"scoreboard_rebuilt":true}
```

至少每个发布候选运行一次自动演练；生产环境按季度以及数据库、对象存储、加密或部署拓扑重大变更后执行受控恢复演练。保存命令版本、产物摘要、对象数量、RPO/RTO、验证日志和整改项，且不得在证据中保留 Flag、Cookie 或 Secret。
