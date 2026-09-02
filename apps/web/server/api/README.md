# API adapters

此目录只包含 H3/Nitro 协议适配：读取请求、调用领域入口、映射响应。Handler 可以依赖 `server/domains` 与 `shared/contracts`，不得导入数据库、表 Schema、对象存储或 Provider 客户端。
