# 比赛参与与动态实例

## 参赛资格

首期比赛均按 Jeopardy 规则运行。选手必须完成邮箱验证、属于一个有效队伍，并取得该比赛的 `accepted` 参赛记录，才能读取受保护题目、提交 Flag 或管理动态实例。

报名支持自动接受和人工审核。人工接受时会重新检查邮箱状态、队伍人数、邀请码、允许邮箱域和比赛阶段。队伍一旦被尚未结束的比赛接受，普通成员变更会被锁定；只有管理员能执行带原因且留审计的纠正。

比赛阶段由 UTC 时间和发布状态统一派生。未发布、未到题目发布时间或无参赛资格时，接口不得返回 Flag 材料、私有附件或实例入口。赛后练习必须显式启用，并与正式提交、解题、动态题值、首解和排行榜隔离。

## 动态实例流程

浏览器只调用 Nuxt 控制面：

- `GET /api/contests/{contestId}/challenges/{challengeId}/instance` 查询当前实例；
- `POST /api/contests/{contestId}/challenges/{challengeId}/instance` 请求创建；
- `POST /api/contests/{contestId}/challenges/{challengeId}/instance/renew` 请求续期；
- `DELETE /api/contests/{contestId}/challenges/{challengeId}/instance` 请求销毁。

控制面在 PostgreSQL 事务中判断身份、参赛资格、比赛阶段、租约窗口和每队实例上限，再写实例期望状态与 `instance_jobs`。创建请求只表示已接受，初始状态为 `pending` 或 `starting`；只有 Go Worker 确认 workload、Service 和路由均 Ready 后，控制面才向对应队伍成员或管理员返回 `running` 和外部入口。

Worker 只支持 `ensure`、`inspect`、`destroy`、`reconcile`。它使用数据库租约、fencing token、幂等键和确定性资源名操作 Docker Engine API 或 Kubernetes `client-go` Provider。重复创建、续期、销毁、Worker 崩溃和租约转移必须收敛到同一实例代次。

题目流量直接通过 Gateway/Ingress/Service 到达实例，不经过 Nuxt 或 Worker。选手不得获得 Docker socket、Kubernetes 凭据、内部 Service 地址或未就绪入口。

## 租约与状态

- `pending` / `starting`：任务已持久化或资源正在就绪，不显示入口；
- `running`：观察代次等于期望代次，且外部入口已经验证；
- `stopping`：控制面已经请求销毁，资源尚未完全收敛；
- `stopped`：资源已不存在或已确认销毁；
- `error`：存在安全摘要错误，管理员可在监控页查看任务尝试并修复后对账。

控制面负责初始时长、续期增量、续期窗口和队伍配额。Worker 只执行任务给出的有效截止时间，不能扩大租约。过期实例由期望状态和周期 Reconciler 回收。

## 隔离要求

所有资源都必须具有平台、比赛、题目、队伍、实例和代次标签，并限制 CPU、内存和临时存储。Kubernetes 工作负载默认非 root、只读根文件系统、禁用权限提升和 ServiceAccount token，并应用题目网络策略。缺少完整所有权标签的资源只报告，不由 Worker 接管或删除。

动态 Flag 通过版本化信封加密传给 Worker，只在 Provider 调用前短暂解密；明文不得进入任务查询、日志、标签或普通管理页面。

## 排障

管理员先在 `/console/admin/monitoring` 按比赛、题目、队伍和状态检查实例观察、任务尝试、陈旧时间和错误分类。确认根因后可在 `/console/admin/operations` 执行：

- `dead_letter_replay`：重放已修复根因的死信任务；
- `instance_reconcile`：为当前实例代次创建显式对账任务。

不要直接修改实例表或删除无标签 Provider 资源。完整流程见 [运维 Runbook](../operations/runbook.md)。
