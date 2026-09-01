# 公网 API 约定

首期公网 API 由共享 Zod Schema 生成 OpenAPI 与客户端类型。本文固定跨领域的错误、分页和并发写入规则；领域资源不得自行设计第二套包络。

## 稳定错误

所有非成功响应使用：

```json
{
  "error": {
    "code": "contest.not_running",
    "message": "当前不在正式提交时间内",
    "request_id": "018f47a2-4ef8-7e2c-9c24-6d68b7451f2c",
    "fields": {}
  }
}
```

- `code` 是小写、带领域命名空间的稳定机器标识；客户端逻辑不得匹配 `message`。
- `message` 是本次请求的安全可展示说明，不承诺作为稳定标识。
- `request_id` 是入口生成并贯穿日志、审计与下游任务的 UUID。
- `fields` 始终是对象；字段校验失败时，键为请求字段路径，值为一个或多个安全说明。非字段错误使用空对象。
- 响应不得附带堆栈、SQL、Flag、Cookie、密码、内部地址或 Provider 凭证。

控制面为每个请求接受合法 UUID 或生成新的 `x-request-id`，并在响应、错误、日志与后续任务中传递。JSON 请求默认最大 1 MiB；`Content-Length` 会在中间件快速拒绝，实际读取仍按 UTF-8 字节数再次限制。所有新 Handler 必须使用共享 `readValidatedJsonBody`，畸形 JSON 返回 `request.malformed_json`。

结构化日志递归遮罩 authorization、cookie、credential、password、secret、session、token、Flag 和 answer 类字段。未知异常只记录错误类型与稳定错误码，不记录可能含敏感输入的原始 message。

## Cursor 分页

列表请求统一接受 `cursor` 和 `limit`。`cursor` 是服务端签发的 opaque base64url 字符串，客户端不得解析；`limit` 默认为 20，范围为 1 至 100。不支持把 `offset/page/page_size` 混入同一稳定接口。

列表响应统一为：

```json
{
  "items": [],
  "page": {
    "next_cursor": null,
    "has_more": false
  }
}
```

游标必须编码稳定排序所需的边界与查询上下文。过滤器、排序规则或调用者可见范围变化时，旧游标必须被拒绝，不能回退成无界查询。

## 资源版本与幂等

- 可修改聚合返回正整数 `version`，每次成功变更单调递增。
- 更新、删除及高风险命令使用强 `ETag: "<version>"`；客户端通过 `If-Match` 提交预期版本。
- 缺少前置条件返回 `resource.precondition_required`，版本冲突返回 `resource.version_conflict`，均不得静默覆盖。
- 创建任务、导入、批量操作等可安全重试的管理写请求使用 16 至 128 字符的 `Idempotency-Key`。相同身份、作用域和键必须收敛到同一结果；载荷不同则返回 `request.idempotency_conflict`。
- 资源版本属于业务聚合并发控制，不得用 Redis 版本替代；缓存版本和排行榜版本是独立命名的派生版本。

可执行定义与边界测试位于 `apps/web/shared/contracts/http.ts` 和 `apps/web/shared/contracts/http.test.ts`。

`pnpm generate:api` 先从共享 Zod Schema 生成 `api/openapi.yaml`，再生成 `apps/web/app/types/control-plane-api.d.ts`。Go Worker 不实现公网 API，因此新 OpenAPI 不生成 Go HTTP Server。`legacy/go-monolith/internal/http/api.gen.go` 只随待退役单体保留，不能作为活动契约生成目标。
