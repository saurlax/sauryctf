# Jeopardy 首期发布验收报告

## 结论

- change：`rebuild-platform-with-nuxt-control-plane`；
- 验收日期：2026-09-02（Asia/Shanghai）；
- 验收基线：`d6a4125d30a72081480132d362fbf729f192abc6` 加本任务中的总门禁与报告改动；
- 总门禁：`pnpm test:release`；
- 结果：**通过**；
- 总门禁实测耗时：213 秒；
- 发布判定：Jeopardy 首期门禁满足，可进入部署审批；任一后续运行失败必须阻止发布。

本次本地执行环境为 macOS arm64、Node `v26.7.0`、pnpm `10.34.5`、Go `1.26.5`、Docker Engine `29.7.2`、kubectl `v1.36.1`。仓库和 Pull Request 工作流固定 Node `24.20.0`、pnpm `10.34.5`、Go `1.26.3`；本机较新的 Node/Go 产生 engine warning，但固定版本文件、冻结锁文件和 CI 配置检查均通过。正式发布仍必须要求固定工具链工作流成功。

## 门禁结果

| 范围 | 权威命令或证据 | 结果 |
| --- | --- | --- |
| 冻结依赖 | `pnpm install --frozen-lockfile` | 通过，lockfile 无改写 |
| 工具链 | `pnpm check:toolchain` | 通过，声明版本 Node 24.20.0 / pnpm 10.34.5 / Go 1.26.3 |
| Monorepo 边界 | `pnpm check:boundaries` | 通过，活动应用仅 `apps/web` 与 `apps/worker` |
| Jeopardy-only | `pnpm check:jeopardy-scope` | 通过，数据库、OpenAPI、Web 路由、Worker 协议和部署清单无首期禁入实现 |
| OpenAPI | `pnpm generate:api` + scoped `git diff --exit-code` | 通过，生成物与共享契约一致 |
| 运行时契约 | `pnpm test:contracts` | 20 files，95 passed，1 个有条件 Redis 测试 skipped；Redis 真实故障由 fault suite 覆盖 |
| 空环境 onboarding | `pnpm test:onboarding` | 通过，新 PostgreSQL/Redis/MinIO/Mailpit、迁移、限权 Worker、Nitro/Worker ready |
| Jeopardy smoke | `pnpm test:smoke` | 通过，默认管理员、注册验证、队伍、比赛、题目、提交、榜单、练习、Writeup |
| 身份与安全 | `pnpm test:security` | Web 28 files / 172 tests 全通过；Worker 安全包全通过 |
| 容量 | `pnpm test:capacity` | 通过，见下方实测指标 |
| 依赖故障 | `pnpm test:faults` | Redis、Worker、Kubernetes API、对象存储、SMTP、控制面副本全部通过 |
| 备份恢复 | `pnpm test:backup-recovery` | 通过，见下方恢复指标 |
| 实例生命周期 | `pnpm test:instances:lifecycle` | PostgreSQL 5 tests、Worker lease/reconcile、真实 Docker、临时 k3s 全通过 |
| Nuxt | `pnpm typecheck`、`pnpm build` | 通过，Nitro node-server 构建并预渲染公开首页 |
| Go Worker | `pnpm test:worker`、`pnpm build:worker` | 全部 package 测试与构建通过 |
| OpenSpec | `openspec validate rebuild-platform-with-nuxt-control-plane --strict` | 通过 |
| 临时资源 | 总门禁结束后的 Docker 名称检查 | 通过，无验收容器残留 |

## 容量实测

夹具规模为 300 支队伍、1000 名并发选手、300 条接受参赛、1000 个运行实例、20 道题和 200 次提交/秒短峰值。实测：

- 提交 arrival span：993.11 ms；
- 提交 p50：5.36 ms；
- 提交 p95：9.09 ms，要求小于 300 ms；
- 提交 p99：17.18 ms；
- 提交最大值：17.88 ms；
- 排行榜可见延迟：62.34 ms，要求小于 5000 ms；
- 1000 并发榜单读取 p95：655.28 ms。

容量报告 `passed=true`，两项发布阈值均满足。

## 备份恢复实测

测试创建 PostgreSQL custom dump 和版本化对象存储镜像，在隔离 PostgreSQL/MinIO 中恢复并验证附件 SHA-256 与排行榜重建：

- RPO：0 秒，要求不超过 300 秒；
- RTO：4 秒，要求不超过 1800 秒；
- 备份耗时：0 秒（测试夹具规模）；
- 对象数量：1；
- `scoreboard_rebuilt=true`；
- 数据库 dump SHA-256：`1017d866ea1ba8dd783d74f092322160289c5ad2e8d105d4716842d5da211ac2`。

该数值证明本次隔离演练通过，不替代生产数据规模的定期恢复演练。

## 发布阻断规则

根 `pnpm test:release` 使用 `set -euo pipefail` 和逐门禁非零退出；Pull Request 的 `Release acceptance` 工作流安装固定工具链与 OpenSpec `1.11.0` 后运行同一命令。以下任一情况都必须阻止发布：

- OpenAPI 生成产生未提交差异；
- 数据库迁移或 control-plane/Worker ready 失败；
- 身份、权限、CSRF、Turnstile、上传、归档、Flag 脱敏或 Worker RBAC 失败；
- 提交 p95 或排行榜可见延迟超过阈值；
- 故障、备份、真实 Docker/k3s 生命周期未通过；
- Nuxt typecheck/build、Go test/build 或 strict OpenSpec 失败；
- 首期范围检查发现禁入的比赛模式、网络、终端或 Checker 生产 surface；
- 验收脚本遗留随机测试容器。

分支保护应将 `Release acceptance / jeopardy-first-release` 设为必需检查。未获得该检查的绿色结果不得仅依据本地报告发布。
