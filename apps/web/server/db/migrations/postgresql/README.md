# PostgreSQL migrations

此目录保存显式、有序、只面向 PostgreSQL 的迁移。迁移由控制面部署步骤执行，应用启动不得通过 ORM 自动修改生产 schema。

首期迁移不能创建 AWD、VPN、终端或 Checker 领域对象。
