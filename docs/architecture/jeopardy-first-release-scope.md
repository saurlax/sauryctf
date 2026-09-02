# Jeopardy 首期能力边界

此清单用于代码审查与 `pnpm check` 中的自动范围检查。首期交付只有 Jeopardy；未列入的未来能力不能以隐藏路由、兼容枚举、空数据表或未调用 Worker operation 的形式预埋。

## 首期纳入

- Nuxt/Nitro 唯一公网控制面、PostgreSQL 权威事实与协调、NuxtHub Blob 内容存储；
- 密码登录、sealed Cookie、邮箱验证与找回、全局角色、默认管理员治理；
- 队伍、邀请、报名审核、分组和成员锁定；
- Jeopardy 比赛生命周期、公告、公开时间线、封榜和赛后练习；
- 题库不可变版本、比赛题目快照、同步 Flag 校验、固定与衰减计分；
- PostgreSQL 版本化排行榜、可见页面普通 HTTP 轮询、Writeup、比赛包、通知、审计和运维命令；
- 只处理动态实例的 Go Worker，以及 Docker/Kubernetes Provider。

## 首期排除

- AWD 比赛、AWD 题目分类、混合赛制、Tick、Flag 攻击提交与 Checker；
- 赛事 VPN、选手终端或 SSH 网关；
- 通用代码执行、动态附件生成和异步 Bot/Checker 判题；
- 个人训练、OIDC、平台 MCP、Challenge Gateway 访问令牌与 PCAP。

其中 AWD 的未来设计只存在于 `openspec/changes/add-awd-competition/`，该规划目录不属于首期构建输入。

## 自动检查范围

`pnpm check` 中的 Jeopardy scope 检查会在以下首期产物中检查禁入标识：

- `apps/web/shared/contracts` 的 Schema 与枚举；
- `apps/web/db/migrations/`；
- `apps/web/app/pages/` 与 `apps/web/server/api/` 的路由名；
- `apps/web/app/` 中的 AWD UI/类型入口；
- `apps/worker/` 中的生产任务协议与实现；
- `deploy/`、`deployments/` 与 `k8s/` 部署清单。

普通 Pwn 题目的终端图标、命令行示例不等同于“选手终端网关”，因此不按单个 `terminal` 单词误判；终端会话或网关的路由、任务、资源名称仍会被拒绝。未来为了验证拒绝行为而加入的测试夹具应放在测试目录，不得把对应 operation 注册到生产协议。

## 合并要求

首期相关变更必须同时通过：

```bash
pnpm check
openspec validate rebuild-platform-with-nuxt-control-plane --strict
```

若检查发现排除能力，应删除实现或先建立独立 OpenSpec change；不得通过改名、关闭 UI 或仅依赖部署开关绕过边界。
