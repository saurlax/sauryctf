# Nuxt 控制面运行方式

`apps/web/` 构建为 Nitro `node-server`，是浏览器与外部 API 客户端唯一可访问的业务进程。生产启动入口为：

```bash
pnpm build
node apps/web/.output/server/index.mjs
```

`/api/**` 由 Nitro 自身处理，不代理到 Go HTTP 服务。`apps/worker/` 只构建私有实例 Worker，不能注册用户、队伍、比赛或管理路由。

NuxtHub 是 Web 的数据服务装配入口：`hub:db` 提供唯一控制面 PostgreSQL 客户端，官方 Blob storage 通过运行时严格配置选择 `fs` 或 `s3` driver。PostgreSQL 是唯一共享协调后端；平台没有共享 KV、cache 或消息代理。排行榜自动更新使用页面可见时的普通 HTTP 轮询，不提供比赛事件 SSE。

稳定公开首页 `/` 在构建期预渲染并随 Nitro public assets 发布。比赛列表、比赛详情、控制台和管理页面依赖实时身份或领域状态，不作为纯静态站点发布。

控制面提供动态存活入口：

```text
GET /api/health/live
```

它只证明 Nitro 进程可处理请求。`GET /api/health/ready` 独立检查必需部署配置；缺少 `NUXT_SESSION_PASSWORD`、PostgreSQL、所选 Blob 后端或实例敏感载荷密钥环时返回 503。配置有效后，ready 会真实连接 PostgreSQL，将 NuxtHub `_hub_migrations` 与当前构建清单精确比对，并探测所选 Blob。数据库不可达、空库、迁移落后/超前、fs 目录不可写或 S3 不可访问均返回 503。安全投影只显示 `postgresql`、迁移状态、`fs|s3` 和健康状态。生产平台和反向代理不得把 live 当作 ready。

Session 密钥、数据库 URL、对象存储访问密钥和 `INSTANCE_SECRET_KEYS` 只从部署环境读取，不进入 `platform_settings` 或任何业务表。控制面使用 `INSTANCE_SECRET_ACTIVE_KEY_ID` 选择新 envelope 的包装密钥；Worker 保留仍被活动实例引用的旧密钥用于解密和对账。ready 错误只返回安全的字段或依赖摘要，不回显配置值、数据库错误或连接信息；响应沿用请求中间件生成的 `request_id`。
