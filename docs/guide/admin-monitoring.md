# 管理端赛事监控

当前 `/console/admin` 已经把一场比赛的赛时监控入口前置到了管理页中部。

## 当前能力

- 先选中一场比赛，再进入“赛事监控”面板
- 总览当前比赛的最近提交、正确提交、错误 Flag、重复提交、可疑线索与公告数量
- 快速看到当前最值得处理的事项：
  - 待审核报名
  - 待审 Writeup
  - 跨队重复错误 Flag 线索
  - 已出现正确提交后的赛况变化
- 使用分栏标签查看：
  - `总览`
  - `榜单`
  - `提交流`
  - `线索`
  - `时间线`
  - `运维`

## 当前设计

- 不新增监控专用后端接口
- 直接复用现有管理接口：
  - `GET /api/games/{id}/participants`
  - `GET /api/admin/games/{id}/writeups`
  - `GET /api/admin/games/{id}/submissions`
  - `GET /api/admin/games/{id}/cheat-clues`
  - `GET /api/admin/games/{id}/announcements`
- 页面保持 Nuxt UI 极简卡片结构，优先强调“先发现，再处理”
- 榜单页直接复用公开接口：
  - `GET /api/games/{id}/scoreboard`
  - 支持切换总榜 / 分组榜
  - 会直接提示封榜状态，并保留榜单导出入口
- 时间线会把这些赛时事件统一按时间排序：
  - 管理员公告
  - 正确提交
  - 可疑重复错误 Flag 线索

## 适合的本地冒烟顺序

1. 管理员创建并激活一场比赛
2. 普通用户创建队伍并报名
3. 提交几次错误 Flag，再提交一次正确 Flag
4. 回到 `/console/admin` 的“赛事监控”面板，看提交流和可疑线索是否同步出现
