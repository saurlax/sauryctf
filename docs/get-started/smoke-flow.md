# 本地冒烟流程

这份文档面向空库首次启动后的最小验证流程。

目标不是把所有功能都点一遍，而是确认这套项目已经能完成一条最基础的管理员建赛链路，以及一条最基础的选手参赛链路。

## 前置条件

先启动后后端与前端：

```bash
pnpm dev
```

默认验证入口：

- 前端：`http://127.0.0.1:3000`
- 后端：`http://127.0.0.1:8080`

当前动态题实例的最小容器策略也可以直接通过环境变量调整：

- `INSTANCE_LEASE_DURATION_MINUTES`
- `INSTANCE_EXTENSION_DURATION_MINUTES`
- `INSTANCE_RENEWAL_WINDOW_MINUTES`
- `INSTANCE_TEAM_ACTIVE_LIMIT`
- `INSTANCE_CLEANUP_INTERVAL_SECONDS`

默认分别是：

- 首次启动租约：`30` 分钟
- 每次续期追加：`30` 分钟
- 可续期窗口：到期前 `10` 分钟
- 每支队伍同时运行实例上限：`3`
- 过期实例后台清理间隔：`60` 秒

这组语义现在采用 `defaultLifetime / extensionDuration / renewalWindow` 这一组更清晰的实例生命周期划分，适合本地 smoke 流程。

动态题 provider 目前分两档：

- 默认不额外配置时，`runtime.provider = docker` 仍然走本地 skeleton lease，仅验证租约与入口展示
- 当你显式开启 `INSTANCE_DOCKER_PROVIDER_ENABLED=true` 后，后端会改用本机 `docker` CLI 真正执行 `docker run / inspect / rm -f`
- 如果使用真实 Docker provider，建议同时设置：
  - `INSTANCE_DOCKER_HOST=127.0.0.1`
  - 动态题 `runtime.expose` 为容器内端口列表，例如 `[80]`
  - `runtime.image` 使用本机可拉取的公开镜像，例如 `nginx:alpine`

如果当前数据库是空的，后端启动后会自动创建：

- 用户名：`admin`
- 密码：`sauryctf`

如果数据库里已经存在任意用户，登录页会明确提示默认管理员入口已关闭，这时请直接使用已有账号登录。

## 自动跑一遍

如果你当前就是空库，并且后端已经启动，可以直接运行：

```bash
pnpm smoke:local
```

这条命令现在默认会先临时启动一份独立后端：

- 使用自动挑选的空闲本地端口
- 使用单独 SQLite 文件，不污染仓库根目录现有 `sauryctf.db`
- 跑完后自动关闭并清理临时产物

这条脚本随后会直接调用后端 API，自动完成：

1. `admin / sauryctf` 登录
2. 创建公开比赛
3. 创建一题静态题并挂题
4. 创建一题动态题并挂题
5. 激活比赛
6. 注册普通用户
7. 创建队伍
8. 报名比赛
9. 检查动态题实例初始 `idle` 状态
10. 启动动态题实例租约，并确认模板入口已解析成当前队伍专属地址
11. 确认实例响应里已经带回当前 lease policy，并且刚启动时还不能立刻续期
12. 提交静态题正确 Flag
13. 以游客身份检查公开榜单

为了减少 Windows PowerShell 编码差异带来的误判，这条脚本当前不会再强依赖某一段固定的中文续期提示文案，而是优先校验 `policy`、`can_renew` 和入口字段是否正确返回。

如果你已经手动启动了自己的后端，也支持覆写参数改成“只跑检查，不代启后端”：

```powershell
./scripts/smoke-local.ps1 -BaseUrl http://127.0.0.1:8080
```

如果你想保留临时后端的数据库和日志做排查，也可以加：

```powershell
./scripts/smoke-local.ps1 -StartBackend -KeepArtifacts
```

这条脚本依然刻意要求目标数据库是“无任何用户”的状态；一旦库里已有用户，它会直接退出，而不是尝试补建 `admin`。

如果你本机 Docker Server 可用，也可以直接运行真实 Docker 版本：

```bash
pnpm smoke:local:docker
```

这条命令和 `pnpm smoke:local` 一样，也会先自启临时隔离后端；区别是它会额外为这份临时后端开启真实 Docker provider。

这条脚本会把动态题切成 `nginx:alpine + runtime.expose = [80]`，并额外验证：

- 实例响应里返回了真实的本机 `127.0.0.1:<随机端口>`
- 这个入口能直接返回 HTTP 200
- 返回内容符合预期的 nginx 默认页
- 销毁实例后，接口会回到 `idle`

当前前置条件也更严格一些：

- Docker Desktop 已启动
- 当前 `docker` CLI 能连到可用的 daemon
- `docker version` 能正常看到 `Server` 信息

如果这一步失败，脚本现在会直接把 Docker CLI 的原始报错打印出来，方便区分“Docker 没启动”和“业务逻辑异常”。

## 管理员最小链路

1. 打开 `http://127.0.0.1:3000/login`
2. 用 `admin / sauryctf` 登录
3. 进入 `/console/admin`
4. 在“创建比赛”里新建一场比赛
5. 建议先使用这组最小配置：
   - 名称：任意，例如 `Local Smoke CTF`
   - 开始时间：当前时间前 5 分钟
   - 结束时间：当前时间后 2 小时
   - `is_public = true`
   - `registration_mode = auto_accept`
   - 其他配置保持默认
6. 在“创建题目”里新建一道题目
7. 建议先使用这组最小配置：
   - 标题：任意，例如 `Welcome`
   - 分类：`misc`
   - Flag：`flag{smoke-test}`
   - 描述：任意一段题面文本
8. 在“比赛挂题”里把这道题挂到刚创建的比赛
9. 在“比赛设置”里把比赛状态切到 `active`
10. 打开公开页 `/games`，确认这场比赛已经可见

如果以上 10 步全部正常，说明最基础的管理闭环已经跑通：

- 管理员登录正常
- 比赛创建正常
- 题目创建正常
- 挂题正常
- 比赛公开与激活正常

如果你还想顺手验证当前最小动态题链路，建议把第 6 步题目改成动态题模板，或直接使用管理端里的 `每队独立入口` 模板：

- `runtime.provider = docker`
- `runtime.image = nginx:alpine`
- `runtime.expose = [80]`
- `connection.url = /mock-instance/{{game_id}}/{{challenge_id}}/{{team_hash}}?team={{team_id}}`

默认这一步不会真的起容器，但比赛页会先显示模板入口，启动实例后再显示已经为当前队伍解析好的租约地址，并能直接跳到本地 mock instance 页面。

如果你已经开启 `INSTANCE_DOCKER_PROVIDER_ENABLED=true`，也可以把同一结构改成最小真实容器模板，例如：

- `runtime.provider = docker`
- `runtime.image = nginx:alpine`
- `runtime.expose = [80]`
- `connection.note = docker local instance`

此时后端会用本机 Docker 随机分配宿主机端口，并把解析后的 `host / port / launch_url` 回填到实例响应里。

当前最小动态题冒烟还会顺手确认两件事：

- 实例接口已经返回 `policy.lease_duration_minutes / extension_duration_minutes / renewal_window_minutes / team_active_limit`
- 实例刚启动时不会立刻开放续期；只有进入续期窗口后才允许继续追加租约

## 选手最小链路

1. 打开一个新的无痕窗口
2. 访问 `http://127.0.0.1:3000/register`
3. 注册一个普通用户
4. 如果是直接访问注册页，注册成功后会直接进入 `/console/team?onboarding=created`
5. 进入 `/console/team`
6. 创建一支新队伍
7. 返回 `/games`
8. 打开刚才那场 `active` 比赛详情页
9. 确认页面顶部已经显示：
   - 当前队伍名称
   - 已报名 / 可直接参赛一类的状态提示
10. 进入“题目”标签
11. 找到刚才创建的题目
12. 提交 `flag{smoke-test}`
13. 确认出现成功提示，并且题目显示为已解决
14. 打开“排行榜”标签，确认当前队伍已经出现在榜单中

如果以上 14 步全部正常，说明最基础的选手闭环已经跑通：

- 注册与自动登录正常
- 队伍创建正常
- 比赛报名正常
- 题面开放逻辑正常
- Flag 提交正常
- 排行榜记分正常

如果你是从某个比赛详情页里的“注册”入口进入注册页，注册成功后会先跳到 `/console/team?onboarding=created&redirect=原比赛地址`，建队或入队成功后才会自动回到原比赛继续报名。

## 额外快速检查

如果还想再多确认两件关键行为，可以顺手检查：

1. 用未登录窗口打开同一场比赛详情页
   - 应该只能看到题目基础信息
   - 不应该直接看到完整题面、提示和附件
2. 刷新已登录窗口
   - 导航栏仍应保持登录态
   - `/api/auth/me` 应仍能识别当前用户

## 常见卡点

- 登录后还是访客态：
  - 确认浏览器访问的是 `http://127.0.0.1:3000`
  - 确认请求走的是同源 `/api/**`
- 看不到比赛：
  - 确认比赛 `is_public = true`
  - 确认比赛状态已经切到 `active`
- 不能提交 Flag：
  - 确认当前用户已经有队伍
  - 确认队伍已经报名并处于 `accepted`
  - 确认比赛当前已经开始且尚未结束
