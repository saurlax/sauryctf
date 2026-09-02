# Infrastructure adapters

此目录实现 PostgreSQL、邮件、对象存储和遥测适配器。适配器实现领域端口，不得反向导入页面或 API Handler；基础设施错误必须在领域边界转换为稳定错误。
