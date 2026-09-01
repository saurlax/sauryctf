# 工具链与锁文件

项目使用可复现的构建工具链：

- Node.js `24.20.0`（LTS），由 `.node-version` 与 `.nvmrc` 固定；
- pnpm `10.34.5`，由根 `package.json#packageManager` 固定；
- Go `1.26.3`，由 `.go-version`、`go.work`、`apps/worker/go.mod` 与遗留 module 的 `go.mod` 固定。

本地应先切换到上述 Node 和 Go 版本，再启用仓库指定的 pnpm：

```bash
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install --frozen-lockfile
```

## 锁文件规则

- `pnpm-lock.yaml` 必须提交；有外部依赖的 Go module 必须提交各自的 `go.sum`。当前遗留锁文件位于 `legacy/go-monolith/go.sum`。
- 只有明确升级依赖时才能运行会改写锁文件的安装命令，并必须同时提交 manifest 与锁文件变化。
- 禁止删除锁文件解决依赖冲突，也禁止在 CI 中使用浮动 Node、Go 或 pnpm 版本。
- `api/openapi.yaml` 变更后运行 `pnpm generate:api`，并提交 OpenAPI 与 `apps/web` TypeScript 生成结果。Worker 不生成公网 Server。
- 无契约源变化时，生成命令执行后 Git diff 必须为空。

CI 使用相同版本执行冻结安装、首期 scope guard、契约测试、API 生成一致性、Nuxt typecheck、Nitro build 与 Go 测试。任何一步失败都会阻止合并。
