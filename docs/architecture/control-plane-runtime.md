# Nuxt 控制面运行方式

`apps/web/` 构建为 Nitro `node-server`，是浏览器与外部 API 客户端唯一可访问的业务进程。生产启动入口为：

```bash
pnpm build
node apps/web/.output/server/index.mjs
```

`/api/**` 由 Nitro 自身处理，不再代理到旧 Go HTTP 服务。`apps/worker/` 只构建私有实例 Worker，不能注册用户、队伍、比赛或管理路由。迁移参考位于 `legacy/go-monolith/`，不属于生产拓扑。

稳定公开首页 `/` 在构建期预渲染并随 Nitro public assets 发布。比赛列表、比赛详情、控制台和管理页面依赖实时身份或领域状态，不作为纯静态站点发布。

控制面提供动态存活入口：

```text
GET /api/health/live
```

它只证明 Nitro 进程可处理请求。`GET /api/health/ready` 独立检查必需部署配置；缺少 `NUXT_SESSION_PASSWORD`、PostgreSQL、Redis、对象存储引用或实例敏感载荷密钥环时返回 503。后续数据库连接与迁移版本探针会继续加入 ready，但生产平台和反向代理从现在起就不得把 live 误当作 ready。

Session 密钥、数据库 URL、Redis URL、对象存储访问密钥和 `INSTANCE_SECRET_KEYS` 只从部署环境读取，不进入 `platform_settings` 或任何业务表。控制面使用 `INSTANCE_SECRET_ACTIVE_KEY_ID` 选择新 envelope 的包装密钥；Worker 保留仍被活动实例引用的旧密钥用于解密和对账。ready 错误只返回缺失字段名，不回显配置值。
