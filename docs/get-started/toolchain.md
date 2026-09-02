# 工具链与锁文件

项目使用可复现的构建工具链：

- Node.js `24.20.0`（LTS），由 `.node-version` 与 `.nvmrc` 固定；
- pnpm `10.34.5`，由根 `package.json#packageManager` 固定；
- Go `1.26.3`，由 `.go-version`、`go.work` 与 `apps/worker/go.mod` 固定。

本地应先切换到上述 Node 和 Go 版本，再启用仓库指定的 pnpm：

```bash
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install --frozen-lockfile
```

## 锁文件规则

- `pnpm-lock.yaml` 与 `apps/worker/go.sum` 必须提交。
- 只有明确升级依赖时才能运行会改写锁文件的安装命令，并必须同时提交 manifest 与锁文件变化。
- 禁止删除锁文件解决依赖冲突，也禁止在 CI 中使用浮动 Node、Go 或 pnpm 版本。
- 公网 API 的输入输出类型直接来自 `apps/web/shared/contracts` 的 Zod schema；仓库不提交独立 OpenAPI 生成物。
- 运行 `pnpm check` 验证固定工具链、架构边界、Jeopardy scope 和 Nuxt 类型。

CI 使用相同版本执行冻结安装、仓库检查、Web 与 Worker 测试以及应用构建。任何一步失败都会阻止合并。
