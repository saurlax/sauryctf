## Purpose

定义面向选手、主办方和管理员的身份生命周期、sealed Cookie 会话与全局授权边界，确保邮箱门槛、凭证变更、敏感写操作和默认管理员都可以安全验证与审计。

## ADDED Requirements

### Requirement: 浏览器使用 sealed Cookie Session
平台 SHALL 通过 `HttpOnly`、生产环境 `Secure`、`SameSite=Lax` 的 sealed Cookie 认证浏览器，Session 载荷 SHALL 只包含稳定用户标识、`session_version` 和登录时间；平台 MUST 不建立服务端 Session 记录或设备会话列表。

#### Scenario: 用户成功登录
- **WHEN** 用户通过有效凭证完成登录
- **THEN** 平台设置 sealed Cookie，且浏览器和数据库中均不存在可用于冒充该用户的明文 Session Token

### Requirement: Session 版本支持全局失效
平台 SHALL 在用户记录中维护单调递增的 `session_version`，每个受保护请求 SHALL 校验 Cookie 中的版本、当前用户状态和数据库版本；改密、密码找回、封禁和角色变化 MUST 递增版本并使旧 Cookie 失效。

#### Scenario: 用户修改密码后旧设备请求资源
- **WHEN** 其他设备携带密码修改前签发的 Cookie 请求受保护资源
- **THEN** 平台拒绝请求并清除该 Cookie，因为其 `session_version` 已过期

#### Scenario: 被封禁用户持有未过期 Cookie
- **WHEN** 已封禁用户请求受保护资源
- **THEN** 平台拒绝请求且不得仅依赖 Cookie 内保存的旧账号状态

### Requirement: 邮箱验证是参与平台活动的门槛
注册 SHALL 要求唯一且规范化的邮箱地址；未验证邮箱的用户 SHALL 只能登录、浏览公开内容、维护账号和重发验证邮件，MUST 不允许组队、训练、报名、提交、保存 Writeup 或操作实例。

#### Scenario: 未验证用户创建队伍
- **WHEN** 已登录但邮箱未验证的用户请求创建队伍
- **THEN** 平台拒绝操作并返回需要验证邮箱的稳定错误码

#### Scenario: 验证链接被重复使用
- **WHEN** 已使用或已失效的邮箱验证凭证再次提交
- **THEN** 平台不重复改变账号状态，并允许用户安全请求新的验证邮件

### Requirement: 密码找回凭证单次有效
密码找回凭证 SHALL 随机生成、只存摘要、具有短期有效期并在使用后失效；找回成功 MUST 递增 `session_version`，且接口响应 MUST 不泄露邮箱是否存在。

#### Scenario: 不存在邮箱请求找回
- **WHEN** 用户为未注册邮箱请求密码找回
- **THEN** 平台返回与已注册邮箱相同的接受响应，且不创建可利用的账号存在性线索

### Requirement: 状态修改请求防伪造与滥用
所有依赖 Cookie 身份的状态修改请求 SHALL 验证同源策略和 CSRF 证明；登录、注册、邮箱验证、找回密码和提交 Flag SHALL 按网络来源、用户与动作执行分层速率限制。平台 SHALL 支持可配置 Turnstile，并在未配置时继续执行本地限流与冷却。

#### Scenario: 缺少 CSRF 证明的跨站请求
- **WHEN** 第三方站点携带用户 Cookie 发起状态修改请求但没有有效 CSRF 证明
- **THEN** 平台拒绝请求且不执行任何业务操作

#### Scenario: 未配置 Turnstile
- **WHEN** 部署没有启用 Turnstile 且用户正常注册
- **THEN** 平台允许请求进入本地限流与注册校验，而不是因缺少外部验证码而拒绝启动

### Requirement: 全局角色基于服务端能力授权
平台 SHALL 只保存 `user`、`organizer`、`admin` 三种全局角色；`organizer` SHALL 对全部比赛具有主办和裁判能力，`admin` SHALL 额外管理用户、平台设置和角色，队长能力 SHALL 从队伍关系派生。前端隐藏入口 MUST 不被视为授权措施。

#### Scenario: 普通用户直接调用管理 API
- **WHEN** `user` 绕过界面调用比赛管理或用户管理接口
- **THEN** 服务端返回拒绝结果且不产生目标数据修改

#### Scenario: organizer 管理另一场比赛
- **WHEN** `organizer` 请求维护并非由自己创建的比赛
- **THEN** 平台按全局主办角色授权操作并记录操作者，而不是应用比赛级角色绑定

### Requirement: 凭证使用内存困难算法存储
平台 MUST 使用 scrypt 保存密码摘要，MUST 不记录明文密码、Cookie 载荷、Flag 或内部服务凭证，并 SHALL 支持在成功登录时升级低于当前策略的摘要参数。

#### Scenario: 旧参数用户成功登录
- **WHEN** 用户提供正确密码且现有 scrypt 参数低于当前策略
- **THEN** 平台在不要求用户再次操作的情况下更新密码摘要

### Requirement: 空库创建受限制的默认管理员
仅当用户表完全为空时，平台 SHALL 创建 `admin / sauryctf` 默认管理员并标记为必须改密和补充已验证邮箱；该账号在完成两项要求前 SHALL 只能访问账号维护和登出能力，不得执行普通管理操作，且完成改密 MUST 递增 `session_version`。

#### Scenario: 空数据库首次启动
- **WHEN** 控制面连接到用户表为空的新 PostgreSQL 数据库
- **THEN** 平台只创建一个受限制默认管理员，不创建独立初始化页面

#### Scenario: 默认管理员尝试创建比赛
- **WHEN** 默认管理员尚未完成改密或邮箱验证便请求创建比赛
- **THEN** 平台拒绝管理操作并引导其进入现有账号维护流程

### Requirement: 安全事件产生站内与邮件通知
邮箱验证、密码找回、密码变化、角色变化和账号封禁 SHALL 产生可追踪站内通知；需要外部送达的安全事件 SHALL 通过事务 Outbox 投递邮件，邮件失败 MUST 不回滚已经提交的安全事务。

#### Scenario: 改密邮件发送失败
- **WHEN** 密码修改成功但邮件服务暂时不可用
- **THEN** 新密码和 Session 版本保持生效，邮件进入可重试投递状态且站内通知可见
