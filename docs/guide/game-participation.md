# 比赛参与闭环

这一轮对齐了 GZCTF 中最基础的一段比赛体验：选手先加入队伍，再报名比赛，随后以当前队伍视角查看题目和提交 Flag。

## 当前能力

- 新增 `GET /api/games/{id}/participation`
  - 返回当前用户是否有队伍
  - 返回当前队伍是否已报名该比赛
  - 返回当前参与状态与队伍摘要
- 比赛报名默认进入 `pending`
  - 需要管理员在管理端审核为 `accepted`
  - `rejected` 状态下队伍可以根据提示重新提交报名
- `GET /api/games/{id}/challenges`
  - 如果当前用户所属队伍已报名，会返回队伍视角的题目状态
  - 包括 `solved` 和 `blood_team`
- `GET /api/games/{id}/scoreboard`
  - 会包含已报名但暂未出分的队伍

## 前端行为

- 比赛详情页会展示：
  - 当前报名状态
  - 当前队伍名称
  - 管理员填写的比赛公告
  - 待审核 / 已拒绝 / 已通过的区别说明
  - 报名比赛 / 退出比赛操作
  - 当前是否可报名 / 可退赛 / 可提交 Flag 的原因说明
  - 每道题目的题面、提示列表和附件入口
- 比赛列表页也会展示当前用户的参赛入口状态：
  - 未登录
  - 未加入队伍
  - 可报名
  - 已报名
- 管理员在比赛详情页概览侧边可直接跳转：
  - `/console`
  - `/console/admin`
- 管理端比赛页可以直接处理参赛队伍：
  - 修改 `pending / accepted / rejected`
  - 移除错误报名
- 队伍页统一改为通过 `$api` 调用后端，直接复用 cookie 会话
- `$api` 已支持 OpenAPI 风格路径参数，例如 `/api/games/{id}`

## 当前约束

- 只有 `accepted` 状态的队伍可以在比赛进行中提交 Flag
- `pending` / `rejected` 队伍不会获得正式参赛资格
- 已通过的队伍仍然只能在开赛前退赛

## 题目内容格式

- 当前管理员通过题目表单直接维护：
  - `description`：题面正文
  - `hints`：JSON 字符串数组
  - `attachments`：JSON 字符串数组
- 比赛页会自动解析 `hints` 和 `attachments` 并展示为可读列表

## 计分说明

- 当前平台已统一普通题目提交和比赛内题目提交的动态计分逻辑
- 前三解仍保留 `first / second / third` 血标记
- 当前血标记只作为展示元数据，不额外乘分
- 动态分数按 `min_score + (base_score - min_score) * e^(-decay_rate * solves_before)` 计算
