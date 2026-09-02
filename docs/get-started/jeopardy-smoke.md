# Jeopardy 空环境与冒烟验证

本文用于验证一名新成员能从空环境启动当前首期平台，并完成一条最小但完整的 Jeopardy 业务链路。所有命令均在仓库根目录执行。

## 自动验证

先安装固定工具链和锁定依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

如果本机 Docker Engine 可用，可运行完整 onboarding：

```bash
bash ./scripts/test-onboarding.sh
```

该命令会创建随机命名且相互隔离的 PostgreSQL 和 Mailpit 容器，并使用临时本机 Blob 目录；它会迁移空数据库，应用 Worker 限权角色，构建并启动真实 Nitro 控制面与 Go Worker，检查两者的 live/ready 端点，然后执行完整 Jeopardy smoke。默认路径不需要 S3 或 MinIO。成功标志为：

```text
DOCS_ONBOARDING {"status":"passed","dependencies":"fresh-postgresql-mailpit-local-blob","control_plane":"ready","worker":"ready-private","jeopardy_smoke":"passed"}
```

脚本退出时会删除自己创建的容器、进程和临时日志。不要把这套随机测试凭据用于开发共享环境或生产环境。

只验证业务链路时，先准备一个已迁移的隔离 PostgreSQL，再运行：

```bash
bash ./scripts/test-jeopardy-smoke.sh
```

该测试覆盖默认管理员引导、注册与邮箱验证、建队、本机附件上传与授权读取、创建和发布比赛、题库版本和挂题、报名、正式提交、排行榜、Writeup 审核、赛后练习隔离，以及动态实例启动、续期、销毁时的 PostgreSQL 任务闭环。它不会复用或修改 `.env` 中的日常开发数据库。

## 手工启动

复制环境变量模板并启动开发依赖：

```bash
cp .env.example .env
docker compose -f compose.dev.yml up -d --wait postgres mailpit
pnpm db:migrate
pnpm dev
```

另开终端，为 Worker 创建独立登录角色。先以数据库所有者执行 `deploy/postgres/worker-role.sql`，再创建部署专用 LOGIN 并授予 `sauryctf_worker` 组角色。将凭据写入本地 `.env` 的 `WORKER_DATABASE_URL`，然后启动：

```bash
pnpm worker
```

控制面默认地址为 `http://127.0.0.1:3000`。Worker 健康端点默认只监听私有地址 `127.0.0.1:18081`。

## 健康检查

```bash
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
curl --fail http://127.0.0.1:18081/health/live
curl --fail http://127.0.0.1:18081/health/ready
```

`live` 只表示进程仍能处理请求；`ready` 才能进入服务流量。控制面 ready 会验证必需配置、PostgreSQL 连接和精确迁移版本。Worker ready 会验证限权数据库角色、任务表和所有启用 Provider。

## 手工产品检查清单

1. 使用空库默认账号 `admin / sauryctf` 登录；确认不能直接进入管理操作。
2. 在账号维护页修改初始密码、设置邮箱并完成邮箱验证；确认旧 Cookie 已失效，需要重新登录。
3. 注册并验证一个普通选手账号，创建队伍并确认邀请码轮换和成员权限。
4. 使用管理员创建比赛、题库模板和不可变版本，把题目快照挂载到比赛，完成发布前检查后发布。
5. 使用选手队伍报名并被接受，确认题目只在正确比赛阶段显示。
6. 提交错误 Flag，再提交正确 Flag；确认正式解只记一次、首解稳定、排行榜更新且管理查询不显示完整答案。
7. 验证封榜公共视图与管理员实时视图分离；比赛结束后练习解不得改变正式榜。
8. 保存并提交 Writeup，由管理员审核和导出。
9. 对动态题启动、续期和销毁实例；确认未 ready 时不显示入口，题目流量直接走 Gateway/Ingress/Service。
10. 在管理监控页核对提交、线索、实例任务、邮件、Writeup 和审计记录，并确认 Worker 没有任何认证或比赛业务路由。

结束开发环境：

```bash
docker compose -f compose.dev.yml down
```
