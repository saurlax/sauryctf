# NuxtHub 数据管理改造发布验收报告

## 结论

- change：`adopt-nuxthub-data-management`；
- 验收日期：2026-09-02（Asia/Shanghai）；
- 验收基线：`3fce3bdb2a74626bac2bb39983cd009d7535e4f8` 加本 change 的未提交实现；
- 总门禁：`bash ./scripts/test-release-acceptance.sh`；
- 结果：**通过**；
- 总门禁实测耗时：225 秒；
- 发布判定：NuxtHub PostgreSQL/Blob、无 Redis 运行路径与 Jeopardy 首期门禁满足，可进入部署审批；任一后续运行失败必须阻止发布。

本次本地执行环境为 macOS arm64、Node `v26.7.0`、pnpm `10.34.5`、Go `1.26.5`、Docker Engine `29.7.2`、kubectl `v1.36.1`。仓库固定 Node `24.20.0`、pnpm `10.34.5`、Go `1.26.3`；本机 Node/Go 版本较新并产生 engine warning，但固定版本文件、冻结锁文件和 CI 配置检查均通过。正式发布仍必须要求固定工具链工作流成功。

## 数据管理基线

- Web 使用 `@nuxthub/core` `0.10.8` 管理 PostgreSQL Database 与 Blob；数据库驱动为 `postgres-js`。
- 迁移基线包含 22 个原有迁移（`0000_control_plane_baseline` 至 `0021_data_retention`）和 1 个当前迁移（`0022_rate_limit_windows`），合计 23 个；权威 journal 为 NuxtHub `_hub_migrations`。
- 普通构建、开发和生产启动均不会自动执行迁移；发布显式运行 `pnpm db:migrate`。
- 完整 S3 环境变量组选择 S3 Blob；完全未配置 S3 时选择本机 fs Blob；partial S3 配置会拒绝启动，不会回退。
- 默认 onboarding 只启动 PostgreSQL 与 Mailpit，并使用临时本机 Blob 目录。MinIO 只在显式 S3 集成、备份恢复和发布验收中启动。
- PostgreSQL 是唯一共享协调后端：限流、榜单版本与快照、通知、邮件和实例任务均由数据库协调。Worker 仅通过受限 PostgreSQL 角色和 Docker/Kubernetes Provider 工作。

## 门禁结果

| 范围 | 权威命令或证据 | 结果 |
| --- | --- | --- |
| 冻结依赖 | `pnpm install --frozen-lockfile` | 通过，lockfile 无改写 |
| 仓库检查 | `pnpm check` | 通过，固定工具链、Monorepo 边界、Jeopardy-only 范围与 Nuxt 类型均有效 |
| Web 与 Worker 测试 | `pnpm test` | 通过；无外部依赖的 Vitest 与全部 Worker package 测试通过 |
| 空环境 onboarding 与 smoke | `bash ./scripts/test-onboarding.sh` | 通过；新 PostgreSQL、Mailpit、本机 fs Blob、迁移、受限 Worker、Nitro/Worker ready，以及管理员、附件、比赛、提交、榜单、Writeup 和实例任务闭环均通过 |
| 身份、迁移与安全 | `bash ./scripts/test-security-acceptance.sh` | 通过；空库迁移、旧 journal 接管、未知 schema 拒绝、失败回滚、PostgreSQL 限流与 Blob 路由授权均通过 |
| 容量 | `bash ./scripts/test-capacity-acceptance.sh` | 通过，见下方实测指标 |
| 依赖故障 | `bash ./scripts/test-fault-recovery.sh` | PostgreSQL、fs/S3 Blob、SMTP、Worker 与 Provider 故障场景全部通过 |
| S3 备份恢复 | `BLOB_BACKUP_DRIVER=s3 bash ./scripts/test-backup-recovery.sh` | 通过，见下方恢复指标 |
| fs 备份恢复 | `BLOB_BACKUP_DRIVER=fs bash ./scripts/test-backup-recovery.sh` | 通过，见下方恢复指标 |
| 实例生命周期 | `bash ./scripts/test-instance-lifecycle.sh` | PostgreSQL 5 tests、Worker lease/reconcile、真实 Docker、临时 k3s 全通过 |
| 应用构建 | `pnpm build` | 通过，Nitro node-server 与 Worker 构建成功；Secret 扫描通过 |
| 已移除后端扫描 | 发布脚本的直接依赖、配置、源码与构建产物扫描 | 通过，无 Redis 运行时配置、客户端或打包代码 |
| OpenSpec | `openspec validate adopt-nuxthub-data-management --strict` | 通过 |
| 工作树格式 | `git diff --check` | 通过 |

## 容量实测

测试覆盖 1000 名并发用户、200 次提交/秒短峰值和 PostgreSQL 限流热点。实测：

- 并发排行榜请求总耗时：606.15 ms；
- 1000 并发榜单读取 p95：587.69 ms；
- 提交 arrival span：993.04 ms；
- 提交 p95：24.98 ms，要求小于 300 ms；
- 排行榜可见延迟：56.87 ms，要求小于 5000 ms；
- 网络限流热点 p95：103.43 ms；
- 题目限流热点 p95：64.60 ms；
- 提交限流热点 p95：17.27 ms；
- PostgreSQL 连接数：40；等待锁：0。

容量报告满足全部发布阈值。限流记录只保存 bucket 摘要、窗口和计数，不保存原始 IP、用户输入、凭据或 Flag。

## 备份恢复实测

两条路径均从同一恢复点备份 PostgreSQL 与对应 Blob 后端，在隔离数据库和对象命名空间中恢复，校验附件 SHA-256，并从权威计分事实重建排行榜。

| Blob 后端 | RPO | RTO | 备份耗时 | 对象数 | dump SHA-256 | 排行榜重建 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| S3 | 1 秒 | 3 秒 | 0 秒 | 1 | `89c91e5b8dfb65e643c2a23b520636aa7c83a2e7231fb5711f59a5bb097e9e1e` | 通过 |
| fs | 0 秒 | 2 秒 | 0 秒 | 1 | `f933e9bde17db05b568e01f29a08633a484883245a6947018ecb5a96469b05e9` | 通过 |

该结果证明本次隔离演练通过，不替代生产数据规模下的定期恢复演练。生产 fs 模式必须使用持久卷且保持单控制面写入副本；多副本必须使用共享 S3。

## 发布与回滚证据

- 空数据库迁移一次性应用 23 个迁移，重复运行不会重放。
- 旧库接管测试验证 22 个历史迁移及 schema 指纹后，才在单一事务中写入 `_hub_migrations`；旧 `control_plane.__drizzle_migrations` journal 保留，历史 DDL 不重放。
- 未知 schema、缺失迁移、hash 不符和迁移中途失败均在写入成功 journal 前失败；失败迁移整体回滚并返回非零退出码。
- Blob 迁移按数据库清单复制并校验大小与 SHA-256，可幂等重跑；在切换和至少一个回滚窗口内保留源 Blob，避免旧版本或回滚环境丢失内容。
- fs 和 S3 故障均不会切换到另一后端；readiness 失败并阻止新内容写入。
- Worker 的数据库权限测试证明它只能操作获准的实例任务与观察表，不能读取身份、队伍、比赛、答案、提交、解题或排行榜数据。

## 发布阻断规则

`scripts/test-release-acceptance.sh` 使用 `set -euo pipefail` 和逐门禁非零退出。以下任一情况都必须阻止发布：

- 冻结安装、固定工具链、Nuxt typecheck/build 或 Go test/build 失败；
- 空库迁移、旧 journal 接管、迁移回滚或 control-plane/Worker ready 失败；
- 身份、权限、CSRF、Turnstile、上传、Flag 脱敏、Blob 授权或 Worker RBAC 失败；
- 提交、限流热点或排行榜容量超过发布阈值；
- PostgreSQL、Blob、SMTP、Worker、Provider 故障恢复未通过；
- S3 或 fs 备份恢复、真实 Docker/k3s 生命周期未通过；
- 直接依赖、配置、源码或构建产物仍引用已移除的 Redis 运行后端；
- Secret 扫描、strict OpenSpec、Jeopardy-only 范围或 `git diff --check` 失败。

分支保护应将 `Release acceptance / jeopardy-first-release` 设为必需检查。未获得该检查的绿色结果不得仅依据本地报告发布。
