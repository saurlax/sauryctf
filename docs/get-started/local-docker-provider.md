# 本地 Docker Dynamic 题

这份说明面向“想让动态题在本机真的 `docker run` 起来”的最小联调场景。

## 开启方式

在 `.env` 里加入：

```env
INSTANCE_DOCKER_PROVIDER_ENABLED=true
INSTANCE_DOCKER_HOST=127.0.0.1
```

然后重启后端。

默认情况下，即使题目写了 `runtime.provider = docker`，平台仍然只会走 skeleton 租约，不会真的起容器。

## 推荐最小题目模板

管理端 `/console/admin` 的“动态容器”按钮现在会预填一份更接近真实本地运行的模板，核心结构是：

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
- 如果你需要“每队固定入口 URL”而不是随机宿主机端口，当前更适合继续用 `每队独立入口` mock 模板沉淀交互，再往后补网关层

## 适合现在做的题

- 本地 Web 服务题
- 只需要一个 HTTP 端口的演示型动态题
- 想先验证 GZCTF 风格实例生命周期，而不是一次把完整容器平台做完的题
