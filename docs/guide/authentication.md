# 身份认证与账号安全

浏览器认证使用 `nuxt-auth-utils` sealed Cookie。Session 只保存 `user_id`、`session_version` 和登录时间，不保存角色、邮箱或凭据，也不建立服务端 Session 表。Cookie 为 HttpOnly、生产环境 Secure、SameSite=Lax。

## 账号流程

- 注册：`POST /api/auth/register`，邮箱必填，密码使用 scrypt；
- 登录：`POST /api/auth/login`，支持用户名或邮箱；
- 当前账号：`GET /api/auth/me`；
- 登出：`POST /api/auth/logout`；
- 改密：`POST /api/auth/password/change`；
- 找回：`POST /api/auth/password/reset/request` 和 `/confirm`；
- 邮箱：`POST /api/auth/email/change`、`/verification/request`、`/verification/confirm`；
- CSRF：`GET /api/auth/csrf`。

找回和验证令牌随机生成、只存摘要、短期有效且单次使用。找回请求对存在和不存在的邮箱返回相同外部响应。成功改密、找回、封禁或角色变化会递增 `session_version`，所有旧 Cookie 随后失效。

## 邮箱门槛

未验证邮箱的账号只能浏览公开页面、维护账号、重发验证邮件和登出。队伍、报名、提交、实例和管理操作都在服务端领域入口重新校验账号状态。

## 默认管理员

只有用户表完全为空时才创建 `admin / sauryctf`。该账号初次登录后必须改密、设置邮箱并完成验证；此前只能访问账号维护与登出。首次改密会使初始登录 Cookie 失效，不存在单独初始化页面或公开 setup 状态接口。

## 请求安全

所有依赖 Cookie 的状态修改请求都验证 Origin 和 CSRF。注册、登录、找回、邮箱验证和 Flag 提交同时执行按 IP、用户和动作分层限流。Turnstile 可选；启用时 site key 与 secret 必须成对配置，未启用时仍执行本地限流和冷却。

生产必须提供至少 32 字符的 `NUXT_SESSION_PASSWORD`。Cookie、密码、令牌、Flag 和内部凭据不得进入日志、监控详情或审计 payload。
