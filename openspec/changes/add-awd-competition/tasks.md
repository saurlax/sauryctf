## 1. 核心平台依赖门禁

- [ ] 1.1 确认 `rebuild-platform-with-nuxt-control-plane` 已实现、验收并归档，验证身份、队伍、比赛、审计、对象存储和实例 Worker 主规范可读取
- [ ] 1.2 建立 AWD 功能开关和启动门禁，验证默认部署不注册 AWD 页面、API、scheduler、任务类型或网络入口
- [ ] 1.3 固化 Jeopardy 实例生命周期回归套件，验证后续 worker_jobs 迁移前全部测试通过并保存基线摘要
- [ ] 1.4 建立 AWD 共享 Zod 枚举、错误码和 API 命名约定，验证生成 OpenAPI 不改变未声明的 Jeopardy 契约

## 2. 扩展比赛与 AWD 数据模型

- [ ] 2.1 为比赛增加 mode 并把既有比赛回填为 `jeopardy`，验证非空约束、未知值和混合配置被拒绝
- [ ] 2.2 创建 AWD 服务模板与不可变版本表，验证镜像摘要、端口、Checker 版本、资源和网络策略不可原地覆盖
- [ ] 2.3 创建比赛服务快照、队伍服务和服务代次表，验证每个参与记录对每个服务只有一个当前代次
- [ ] 2.4 创建 Tick 表与 `(contest_id, tick_number)` 唯一约束，使用并发事务验证相同 Tick 只创建一次
- [ ] 2.5 创建 Flag 表与密文、HMAC 摘要、归属、投放状态和有效窗口约束，验证同队/服务/Tick 唯一
- [ ] 2.6 创建 Checker 运行、证据和豁免表，验证结果枚举、任务关联和原始证据追加不可变
- [ ] 2.7 创建攻击提交与 Flag claim 表，验证同一 Flag 对同一攻击队归功唯一且允许不同攻击队分别归功
- [ ] 2.8 创建计分事件、版本和快照表，验证补偿事件可关联原事实且快照版本单调
- [ ] 2.9 创建 VPN Peer、终端会话和抓包对象元数据表，验证过期、撤销、对象引用与审计外键约束

## 3. 实现 AWD 服务配置与发布

- [ ] 3.1 实现服务模板和不可变版本维护 API，验证修改已发布版本会创建新版本而不影响现有比赛
- [ ] 3.2 实现比赛服务挂载与快照，验证同场不能混用 Jeopardy 题目并保留完整 Checker 与运行配置
- [ ] 3.3 实现服务资源、端口、镜像、网络和 Checker manifest 校验，使用危险特权、宿主挂载和未知协议夹具验证拒绝
- [ ] 3.4 实现 AWD 发布前检查，验证缺少 Checker、服务端口、VPN 网段、资源上限或 Flag 策略时定位具体服务失败
- [ ] 3.5 实现每队服务地址与稳定资源标识分配，验证重复发布检查不会改变地址或创建冲突
- [ ] 3.6 实现比赛服务修订命令，验证发布后变更产生新修订、影响预览和不可变审计而不静默覆盖历史

## 4. 实现 Tick 与 Flag 生命周期

- [ ] 4.1 使用 PostgreSQL advisory lock 和数据库时间实现 Tick scheduler，使用多控制面并发测试验证连续序号与单次创建
- [ ] 4.2 实现默认 120 秒 active 与上一 Tick grace 状态机，使用可控时钟验证边界、重启恢复和无本地时钟依赖
- [ ] 4.3 实现 Tick pause、resume、自然结束和 void 命令，验证连续序号、原因、确认和审计行为
- [ ] 4.4 实现随机 Flag 生成、HMAC 索引和信封加密，验证跨队唯一、不可预测、密钥版本和日志脱敏
- [ ] 4.5 在 Tick 事务中创建队伍服务 Flag 与投放任务，验证事务失败不会留下部分 Tick 或孤立任务
- [ ] 4.6 实现 Flag 密文在 grace 与重试窗口后清除，使用时间推进测试验证摘要与归属保留而明文不可恢复
- [ ] 4.7 实现当前与上一 Tick 有效性判定，验证更早、未投放成功和 void Tick Flag 均不能计分

## 5. 将实例任务迁移为 worker_jobs

- [ ] 5.1 创建统一 worker_jobs schema 与 kind、priority、capability、payload/result version 字段，验证未知 kind 被控制面和 Worker 双重拒绝
- [ ] 5.2 编写 instance_jobs 到 worker_jobs 的可重复迁移，验证 job id、状态、attempt、lease 和 fencing 历史完整
- [ ] 5.3 更新 TypeScript/Go 共享任务夹具，验证实例、Checker、服务重启、恢复和对账载荷双向兼容
- [ ] 5.4 实现按 kind 的领取预算、优先级和独立 semaphore，使用实例洪峰测试验证 Checker 保留并发槽且不会饿死
- [ ] 5.5 更新 Worker 数据库权限，验证只能读取获准敏感引用、写 attempt/result/observation，不能写 Tick、Flag claim 或 score
- [ ] 5.6 在 worker_jobs 上重跑完整 Jeopardy 实例回归，验证 Ensure/Inspect/Destroy/Reconcile 行为与迁移前一致

## 6. 实现 Checker 沙箱与结果处理

- [ ] 6.1 定义 `checker-v1` manifest、输入和结果 schema，验证 check_service、put_flag、get_flag 及未知动作处理
- [ ] 6.2 实现 Checker 镜像摘要拉取与受限容器/Kubernetes Job 启动，验证非 root、只读根、无 ServiceAccount、资源/PID/超时限制
- [ ] 6.3 实现 tmpfs 输入与专用结果文件协议，验证 Flag 不出现在命令行、stdout、普通日志、标签和任务列表
- [ ] 6.4 实现 Checker 仅访问目标服务的网络策略，使用跨队、控制面、数据库和外网探针验证默认拒绝
- [ ] 6.5 实现 `up/down/mumble/checker_error/platform_error` 分类，使用固定 Checker 夹具验证每种结果和证据摘要
- [ ] 6.6 实现 Nuxt 幂等消费 Worker 结果，验证重复结果不会重复投放 Flag、创建 Checker 事实或推进 score version
- [ ] 6.7 实现 checker_error 待复核、重跑和重分类，验证复核前不进入分母且原结果不被覆盖
- [ ] 6.8 实现 platform_error 自动排除与 organizer 豁免命令，验证补偿事件、原因和重算可审计

## 7. 实现攻击提交与三分量计分

- [ ] 7.1 实现 Flag 输入规范化、HMAC 查找和统一无效响应，验证响应不泄露受害队、服务、Tick 或历史存在性
- [ ] 7.2 实现攻击提交资格、比赛阶段和速率限制，验证未接受、未验证、暂停后禁用或比赛结束请求不计分
- [ ] 7.3 实现本队 Flag、过期 Flag、重复 claim 和不同攻击队归功规则，使用并发测试验证唯一约束
- [ ] 7.4 实现攻击比例分量，验证分母只包含其他队伍成功投放且可获取的 Flag
- [ ] 7.5 实现可用性分量，验证 `up/down/mumble` 分母、platform_error 排除和 checker_error pending
- [ ] 7.6 实现 grace 关闭后的 Flag 保全结算，验证任一有效对手 claim 会使该 Flag 防守失败且只结算一次
- [ ] 7.7 实现默认 40/30/30 与服务权重，使用固定比赛夹具验证归一化、精度、边界和显示
- [ ] 7.8 实现追加 score events、补偿、void 和显式调整，验证不覆盖原 Checker、Flag 或 claim 事实
- [ ] 7.9 实现全场、服务、队伍和 Tick 重放器，验证重复重放产生相同三分量、总分、版本与摘要
- [ ] 7.10 实现稳定排名和规则页，验证总分、攻击、可用性与稳定 ID 依次打破平局并公开当前规则

## 8. 实现赛事 VPN 与服务网络隔离

- [ ] 8.1 实现比赛/队伍命名空间和稳定攻击网地址分配，验证 300 队多服务时无地址冲突且重复部署稳定
- [ ] 8.2 部署 WireGuard 兼容 VPN 接入层，验证 Peer 创建、配置下载、轮换、撤销和比赛结束自动过期
- [ ] 8.3 实现攻击网只访问公开服务端口的 NetworkPolicy，使用连通矩阵验证控制面、数据库、Redis、对象存储和 Kubernetes API 不可达
- [ ] 8.4 实现队伍服务间内部管理端口隔离，验证只能通过攻击端口访问其他队伍服务
- [ ] 8.5 实现 Checker namespace 与目标限定 egress，验证单次任务不能扫描或访问非目标队伍
- [ ] 8.6 实现 Docker 开发网络适配并标注非生产边界，验证本地 smoke flow 可运行且生产验收强制 Kubernetes 隔离测试
- [ ] 8.7 增加 VPN、地址、丢包、延迟和策略拒绝指标，验证管理监控可定位 Peer 与服务连接故障

## 9. 实现受控终端与服务恢复

- [ ] 9.1 实现不可变基线加队伍可写层的服务运行模型，验证普通重启保留修改且不同队写层完全隔离
- [ ] 9.2 部署终端/SSH 网关和短期会话 Token，验证 Token 绑定用户、队伍、比赛、服务、目标和过期时间
- [ ] 9.3 实现终端授权与会话撤销，验证非队员、未接受队员、其他队服务和已结束比赛访问被拒绝
- [ ] 9.4 限制终端容器权限和网络，验证无 kubeconfig、ServiceAccount token、宿主挂载、特权和管理网访问
- [ ] 9.5 实现服务重启命令，验证新运行观察不改变写层、历史 Checker、Flag 或计分
- [ ] 9.6 实现队长/organizer 恢复基线确认流程，验证新代次替换写层、旧会话关闭和完整审计
- [ ] 9.7 实现比赛暂停/结束时批量关闭终端，验证关闭幂等且不会误关其他比赛会话

## 10. 实现可选抓包数据面

- [ ] 10.1 定义按服务 capture 设置、容量上限和发布检查，验证默认关闭且不能通过普通实例配置隐式启用
- [ ] 10.2 部署独立 capture gateway 或流量镜像适配，验证 Nuxt 与 Worker不承载数据包且关闭抓包不改变服务路径
- [ ] 10.3 实现 PCAP 信封加密、摘要和对象存储写入，验证存储对象无法脱离密钥直接读取
- [ ] 10.4 实现 organizer/admin 带原因下载授权与短期 URL，验证普通选手、跨比赛 organizer 以外角色和过期 URL 被拒绝
- [ ] 10.5 实现比赛结束七天自动删除和删除证明，使用时间推进测试验证密文删除、元数据最小保留与审计
- [ ] 10.6 执行高吞吐抓包容量与故障测试，验证 capture 故障不会拖垮未启用抓包的服务或控制面

## 11. 实现 AWD API、页面与实时事件

- [ ] 11.1 实现选手 AWD state、服务、当前 Tick 和连接信息 API，验证 mode、报名、时间和敏感字段投影
- [ ] 11.2 实现 Flag 攻击提交与结果 API，验证统一错误、限流、幂等和 OpenAPI 契约
- [ ] 11.3 实现三分量排行榜与服务/Tick 明细 API，验证 provisional/final 状态和 Redis 清空重建
- [ ] 11.4 实现 VPN Peer 与终端会话选手 API，验证完整生命周期、权限和安全响应脱敏
- [ ] 11.5 实现管理端服务、Tick、Checker、豁免、重算、重启、恢复、VPN 和 PCAP API，验证所有高风险写操作需要原因和审计
- [ ] 11.6 实现 AWD 选手页面和 organizer 管理页面，运行 Nuxt typecheck、可访问性和角色 E2E 测试
- [ ] 11.7 实现 Tick、服务观察、Checker 汇总和 scoreboard version SSE，验证断线补发和 reset 不泄露 Flag、私钥、终端 Token 或证据正文

## 12. 故障、安全与发布验收

- [ ] 12.1 执行 Tick 主节点切换、重复调度、数据库时钟偏差和控制面重启测试，验证 Tick 序号与窗口保持一致
- [ ] 12.2 执行 Worker 崩溃、lease 过期、Checker 超时、实例洪峰和任务重复测试，验证 fencing、配额和幂等结果
- [ ] 12.3 执行 Flag 泄露、随机枚举、本队提交、重复 claim、上一 Tick 边界和密钥轮换安全测试
- [ ] 12.4 执行 VPN 横向移动、管理网探测、终端逃逸、跨队文件访问和 PCAP 越权测试，修复全部高风险结果
- [ ] 12.5 使用多服务、多队伍、多 Tick 固定事实集执行实时与离线计分对比，验证三分量与排名摘要完全一致
- [ ] 12.6 执行 pause、void、豁免、重算、恢复基线和比赛结束演练，验证原事实保留且所有补偿可审计
- [ ] 12.7 在目标规模下压测 Tick 创建、Checker 队列、攻击提交、排行榜和 VPN，验证 Checker 不被饿死且 score version lag 满足赛事配置
- [ ] 12.8 在隔离测试比赛完成发布、VPN 接入、服务修补、Flag 获取、攻击提交、Tick 结算和最终榜端到端流程
- [ ] 12.9 执行 PostgreSQL、对象存储和 VPN 配置备份恢复，验证 Tick、Flag 摘要、计分、服务地址和证据引用一致
- [ ] 12.10 完成 OpenSpec strict validation、OpenAPI、TypeScript、Go、Kubernetes 与安全套件，并在核心平台完成前保持所有本 change 任务未实施
