# 用户管理

`/console/admin/users` 只允许全局 `admin` 访问。首期角色只有：

- `user`：普通选手；
- `organizer`：可管理全部比赛并执行裁判操作；
- `admin`：额外管理用户、角色、平台设置和全局运维。

不存在 `super_admin`、比赛级角色绑定或浏览器角色快照。队长能力由 `team_members` 关系派生。

管理员可以筛选用户、修改全局角色以及封禁或恢复账号。角色或状态变化必须在 PostgreSQL 事务中写不可变审计、创建安全通知并递增 `session_version`，使全部旧 Cookie 失效。操作者不能依赖前端按钮隐藏作为授权，领域服务会再次校验能力。

用户查询不得返回密码摘要、Session 密钥、邮箱/找回令牌、Cookie、完整安全邮件 payload 或 Flag。需要强制注销时使用 `/console/admin/operations` 的 `session_invalidate`，填写原因并保留审计，不直接修改数据库。
