# 控制面代码边界

以下路径均相对于 `apps/web/`；Go 运行边界独立位于 `apps/worker/`。

依赖方向固定为：

```text
app pages -> Nitro API -> domains -> ports
                              ^         |
                              |         v
                         infrastructure adapters

shared/contracts 可被页面、API 与领域共同使用，但不依赖其中任何一层。
```

- 页面只能调用 API/composable，不能导入服务端模块、数据库客户端或表 Schema。
- `server/api` 是薄 H3 适配层，不能直接查询表或开启业务事务。
- `server/domains` 拥有授权、事务和状态机，通过端口使用基础设施。
- `server/infrastructure` 实现端口，不能反向依赖页面或 Handler。
- `shared/contracts` 保存运行时协议 Schema，不导入页面或服务端实现。
- `db/migrations` 是 PostgreSQL schema 的唯一演进入口。

`pnpm check:boundaries` 在 CI 检查禁止的 import、常见直接数据库调用和反向依赖。该检查是快速防线，代码审查仍需确认领域事务没有被拆进 Handler。
