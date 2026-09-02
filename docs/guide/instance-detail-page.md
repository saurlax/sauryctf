# 动态实例详情

动态实例状态由比赛题目页和控制面实例接口提供，不以本地占位页面作为生产入口。控制面只向对应队伍成员和获权管理员返回当前实例代次的安全投影。

详情应展示：

- `pending`、`starting`、`running`、`stopping`、`stopped` 或安全摘要错误；
- 租约到期时间、是否进入续期窗口和当前可执行动作；
- 仅在 Worker 确认 workload 与路由 Ready 后展示的外部入口。

页面不得展示内部 Service 地址、Docker/Kubernetes 标识、Provider 凭据、任务敏感 payload 或动态 Flag。创建、续期和销毁请求先由 Nuxt 判断参赛资格、比赛阶段和队伍配额，再写 PostgreSQL 持久任务。浏览器不能直接访问 Worker、Docker Engine 或 Kubernetes API。

题目连接流量直接进入 Gateway/Ingress/Service。故障时页面保持真实 pending/error 状态，不把“任务已接受”显示成“实例可用”。详细生命周期见 [比赛参与与动态实例](./game-participation.md)。
