# 文档索引

## 架构

- [Jeopardy 首期行为基线](./architecture/jeopardy-contract-baseline.md)
- [Jeopardy 首期能力边界](./architecture/jeopardy-first-release-scope.md)
- [公网 API 约定](./architecture/api-conventions.md)
- [Nuxt 控制面运行方式](./architecture/control-plane-runtime.md)
- [控制面代码边界](./architecture/control-plane-boundaries.md)

当前文档按两组组织：

- `get-started`
  - 面向本地启动、联通验证与最小演练
- `guide`
  - 面向具体功能、页面和运维流程

## 建议阅读顺序

1. [开始使用](./get-started/overview.md)
2. [开发依赖](./get-started/development-dependencies.md)
3. [工具链与锁文件](./get-started/toolchain.md)
4. [Nuxt 控制面运行方式](./architecture/control-plane-runtime.md)
5. [控制面代码边界](./architecture/control-plane-boundaries.md)
6. [公网 API 约定](./architecture/api-conventions.md)
7. [Jeopardy 首期能力边界](./architecture/jeopardy-first-release-scope.md)
8. [迁移期本地烟测流程](./get-started/smoke-flow.md)

## Get Started

- [工具链与锁文件](./get-started/toolchain.md)
- [开发依赖](./get-started/development-dependencies.md)
- [开始使用](./get-started/overview.md)
- [迁移期本地烟测流程](./get-started/smoke-flow.md)
- [遗留本地 Docker Provider](./get-started/local-docker-provider.md)

## Guide

`guide/` 中的页面与流程文档描述迁移前行为，只用于核对旧契约；新控制面按
OpenSpec 任务逐步替换这些内容，不应据此恢复旧 Go 公网业务架构。
