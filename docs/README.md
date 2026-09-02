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
- `deployment`
  - 面向生产构建、网络边界、Secret、发布和回滚
- `operations`
  - 面向日常运维、故障处置、备份与恢复

## 建议阅读顺序

1. [开始使用](./get-started/overview.md)
2. [开发依赖](./get-started/development-dependencies.md)
3. [工具链与锁文件](./get-started/toolchain.md)
4. [Jeopardy 空环境与冒烟验证](./get-started/jeopardy-smoke.md)
5. [Nuxt 控制面运行方式](./architecture/control-plane-runtime.md)
6. [控制面代码边界](./architecture/control-plane-boundaries.md)
7. [公网 API 约定](./architecture/api-conventions.md)
8. [Jeopardy 首期能力边界](./architecture/jeopardy-first-release-scope.md)
9. [生产部署](./deployment/production.md)
10. [运维 Runbook](./operations/runbook.md)

## Get Started

- [工具链与锁文件](./get-started/toolchain.md)
- [开发依赖](./get-started/development-dependencies.md)
- [开始使用](./get-started/overview.md)
- [Jeopardy 空环境与冒烟验证](./get-started/jeopardy-smoke.md)

## Deployment

- [生产部署](./deployment/production.md)

## Operations

- [运维 Runbook](./operations/runbook.md)
- [应急响应](./operations/incident-response.md)
- [备份与恢复](./operations/backup-restore.md)

## Guide

`guide/` 中的页面与流程文档用于说明当前 Jeopardy 产品行为；架构、部署与运行约束以 `architecture/`、`deployment/`、`operations/` 和有效 OpenSpec change 为准。
