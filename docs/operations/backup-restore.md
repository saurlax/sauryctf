# 备份与恢复

## 目标与范围

赛时目标为 RPO 不超过 5 分钟、RTO 不超过 30 分钟。备份必须同时覆盖：

- PostgreSQL custom-format dump 或等价的一致恢复点；
- S3 模式下启用版本保留的兼容对象存储镜像，或 fs 模式下持久化 Blob 目录的文件级快照；
- 发布版本、NuxtHub migration 版本、Blob 驱动、时间戳和 SHA-256 清单。

进程内 single-flight 状态和本地临时上传不备份；前者可从 PostgreSQL 权威事实与持久快照自然恢复。部署 Secret 使用独立的 Secret 管理系统备份，不能写进数据库 dump 或对象镜像。

## 备份

1. 记录权威截止时间和当前发布版本。
2. 使用 `pg_dump --format=custom --no-owner --no-privileges` 创建 PostgreSQL dump。
3. S3 模式将内容 bucket 镜像到启用版本控制、访问隔离的备份 bucket；fs 模式在暂停内容写入或卷快照屏障内复制 `NUXTHUB_BLOB_DIR`，包括 NuxtHub 元数据 sidecar。
4. 计算 dump SHA-256，并按数据库中 `status = 'committed'` 的对象清单记录对象数量、大小和内容 SHA-256。
5. 对备份产物执行加密、访问控制、异地保存和保留策略；备份账号不得拥有生产写权限。

持续归档或增量机制必须确保任一已声明恢复点的数据库引用与对象版本可共同恢复。赛时每 5 分钟内形成可用恢复点，并监控备份落后时间。

## 隔离恢复

1. 创建与生产隔离的新 PostgreSQL，以及空对象 bucket 或空的专用 Blob 目录，不覆盖现有生产环境。
2. 校验 dump SHA-256 和对象版本清单。
3. 使用 `pg_restore --no-owner --no-privileges --exit-on-error` 恢复数据库。
4. 恢复对应版本的 S3 镜像或 fs 目录快照；fs 部署恢复后仍只能运行一个控制面写入副本。
5. 使用当前发布的 readiness 验证迁移 journal 完全匹配。
6. 抽样并自动核对 `content_objects.sha256_digest`、对象大小和实际对象内容。
7. 从正式解、计分调整和题目快照重放排行榜，并核对 PostgreSQL 持久快照。
8. 执行 Jeopardy smoke，检查用户/角色、比赛、提交、榜单、Writeup、实例期望与审计。
9. 记录最后恢复事实时间、实际 RPO/RTO、校验结果和审批人后，才允许切换流量。

## 自动演练

```bash
bash ./scripts/test-backup-recovery.sh
BACKUP_BLOB_DRIVER=fs bash ./scripts/test-backup-recovery.sh
```

默认命令演练 PostgreSQL + S3，第二条命令演练 PostgreSQL + 本机 Blob。脚本生成权威比赛事实和附件，执行 custom dump 与对应 Blob 快照，停止源服务，在全新环境恢复，验证附件 SHA-256 并重建排行榜。任一摘要错误、缺失对象、恢复命令失败、RPO 超过 300 秒或 RTO 超过 1800 秒都会阻断。成功输出包含 `blob_driver`：

```text
BACKUP_RECOVERY {"status":"passed","blob_driver":"s3|fs",...,"scoreboard_rebuilt":true}
```

至少每个发布候选运行一次自动演练；生产环境按季度以及数据库、对象存储、加密或部署拓扑重大变更后执行受控恢复演练。保存命令版本、产物摘要、对象数量、RPO/RTO、验证日志和整改项，且不得在证据中保留 Flag、Cookie 或 Secret。
