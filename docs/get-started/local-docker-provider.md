# 本地 Docker Dynamic 题

这份说明面向“想让动态题在本机真的 `docker run` 起来”的最小检查场景。

## 开启方式

默认情况下，即使题目写了 `runtime.provider = docker`，平台仍然只会走 skeleton 租约，不会真的起容器。

如果你是手动启动自己的后端进行检查，需要在 `.env` 里加入：

```env
INSTANCE_DOCKER_PROVIDER_ENABLED=true
INSTANCE_DOCKER_HOST=127.0.0.1
```

然后重启后端。

## 最快检查

如果你只是想最快检查真实本地 Docker provider，可以直接运行：

```bash
pnpm smoke:local:docker
```

这条命令现在会自动：

- 启动一份临时隔离后端
- 为这份后端自动开启 `INSTANCE_DOCKER_PROVIDER_ENABLED=true`
- 使用独立 SQLite 文件，不污染仓库主库
- 跑完后自动关闭并清理

随后脚本会自动创建一场比赛、一题静态题和一题 `nginx:alpine` 动态题，并检查：

- 能正常启动实例
- 实例返回了真实 `127.0.0.1:<随机端口>` 入口
- 入口能返回 nginx 默认页
- 销毁实例后会重新回到 `idle`

这条链路仍然要求本机 Docker daemon 可用。以当前 Windows 常见环境来说，至少需要：

- Docker Desktop 已启动
- 当前 Docker context 对应的 Linux engine 可用
- `docker version` 能看到 `Server` 段，而不只是 `Client`

如果脚本在前置检查阶段失败，优先手动运行：

```bash
docker version
docker info
```

根据 Docker CLI 官方文档，`docker version` 会同时输出 `Client` 和 `Server` 信息；如果 daemon 没起来，`Server` 信息就拿不到，脚本也会直接停在前置检查阶段。

如果你更想从管理端直接走一遍最小链路，现在 `/console/admin` 里也提供了“创建本地 Docker 比赛”入口：

- 会自动创建一场公开比赛
- 会自动创建一道 `Local Docker Web Instance` 动态题
- 会自动完成挂题
- 随后可以直接用普通用户去公开比赛页检查真实本地 Docker Web 实例链路

## 推荐最小题目模板

管理端 `/console/admin` 的“本地 Docker Web”按钮现在会预填一份更接近真实本地运行的模板，核心结构是：

```json
{
  "runtime": {
    "provider": "docker",
    "image": "nginx:alpine",
    "expose": [80]
  },
  "connection": {
    "note": "启用 INSTANCE_DOCKER_PROVIDER_ENABLED 后，平台会回填实际 host / port / launch_url。"
  }
}
```

这份模板额外强调两件事：

- 实例真正启动前，不需要手写固定 `url`，平台会在租约响应里回填真实 `host / port / launch_url`
- 这份模板优先服务于“先把本地真实 Docker provider 跑通”，而不是一开始就做每队固定入口网关

## 当前行为

当选手在比赛页启动这道动态题实例时，后端会：

- 调用 `docker run -d`
- 按 `runtime.expose` 自动发布容器端口
- 调用 `docker inspect` 读回实际宿主机端口
- 在实例响应里回填：
  - `host`
  - `port`
  - `launch_url`
- 在实例被销毁或租约过期清理时调用 `docker rm -f`

## 当前限制

- 仍然是“每条租约一个本地容器”的最小实现
- 还没有卷挂载、环境变量注入、自定义网络、registry 登录、资源限制
- 还没有接到真正的反向代理或平台网关
- 如果你需要“每队固定入口 URL”而不是随机宿主机端口，当前更适合继续用 `每队独立入口` 模板沉淀交互，再往后补网关层

## 适合现在做的题

- 本地 Web 服务题
- 只需要一个 HTTP 端口的基础动态题
- 想先检查实例生命周期，而不是一次把完整容器平台做完的题
