# 比赛模块剩余实施文档（后端轨）

本文档承接当前已完成的前端 Mock 页面，定义接下来需要落地的后端能力与联调顺序。

## 1. 目标与现状

- 已完成：前端“比赛”页面、流程交互、Mock 数据与历史详情。
- 未完成：真实后端比赛模块（数据库、API、状态机、GET5 下发、真实历史数据）。

目标：将前端从 `matchesMock` 切换为后端真实接口，完整跑通
`建赛 -> 入房 -> 队长 -> 选人 -> BP -> 生成GET5配置 -> 下发 -> 启动 -> 结束 -> 历史查询`。

---

## 2. 后端实施清单

## 2.1 数据库与迁移

在 `backend/main.go` 的 `migrate()` 中新增表（或拆分为 migration 文件）：

1. `matches`
- `id BIGSERIAL PK`
- `display_id TEXT UNIQUE`（时间戳字符串，给前端展示）
- `creator_user_id BIGINT REFERENCES users(id)`
- `status TEXT`：`created|gathering|captain_pick|player_draft|map_veto|ready_to_start|launching|live|finished|cancelled`
- `bo INTEGER`（1/3/5）
- `captain_mode TEXT`（`admin_assigned|random`）
- `score_a INTEGER NULL`
- `score_b INTEGER NULL`
- `server_addr TEXT`
- `created_at/updated_at`

2. `match_players`
- `id BIGSERIAL PK`
- `match_id BIGINT REFERENCES matches(id)`
- `user_id BIGINT REFERENCES users(id)`
- `team TEXT NULL`（A/B）
- `is_captain BOOLEAN`
- `join_order INTEGER`
- `created_at`
- 约束：`UNIQUE(match_id, user_id)`

3. `match_veto_steps`
- `id BIGSERIAL PK`
- `match_id BIGINT REFERENCES matches(id)`
- `step_order INTEGER`
- `team TEXT`
- `action TEXT`（ban/pick）
- `map_name TEXT`
- `created_at`

4. `match_map_results`
- `id BIGSERIAL PK`
- `match_id BIGINT REFERENCES matches(id)`
- `map_order INTEGER`
- `map_name TEXT`
- `score_a INTEGER`
- `score_b INTEGER`

5. `match_player_map_stats`
- `id BIGSERIAL PK`
- `match_map_result_id BIGINT REFERENCES match_map_results(id)`
- `user_id BIGINT REFERENCES users(id)`
- `team TEXT`
- `kills/deaths/assists INTEGER`
- `adr DOUBLE PRECISION`
- `rating DOUBLE PRECISION`

6. `match_events`
- `id BIGSERIAL PK`
- `match_id BIGINT REFERENCES matches(id)`
- `actor_user_id BIGINT NULL REFERENCES users(id)`
- `event_type TEXT`
- `payload JSONB`
- `created_at`

7. `match_get5_jobs`
- `id BIGSERIAL PK`
- `match_id BIGINT REFERENCES matches(id)`
- `status TEXT`（pending/success/failed）
- `config_path TEXT`
- `stdout TEXT`
- `stderr TEXT`
- `created_at`

单场并行约束：
- 在创建/开启比赛时查询 `matches`，限制仅 1 场 `status NOT IN ('finished','cancelled')`。

---

## 2.2 API 设计（与前端对齐）

登录用户：
- `GET /api/v1/matches`：返回 `{ active, history }`
- `GET /api/v1/matches/:id`：比赛详情
- `POST /api/v1/matches/:id/join`

管理员：
- `POST /api/v1/admin/matches`：建赛（bo + captainMode）
- `POST /api/v1/admin/matches/:id/open`
- `POST /api/v1/admin/matches/:id/force-start`
- `POST /api/v1/admin/matches/:id/captains`
- `POST /api/v1/admin/matches/:id/draft/pick`
- `POST /api/v1/admin/matches/:id/veto/action`
- `POST /api/v1/admin/matches/:id/launch`
- `POST /api/v1/admin/matches/:id/finish`

说明：
- 队长权限动作（draft/veto）需校验当前轮次和队长身份。
- `display_id` 对外展示，内部仍用数值主键更利于关联。

---

## 2.3 状态机与规则

- 10 人到齐：
  - `random`：自动随机 2 队长进入 `player_draft`
  - `admin_assigned`：进入 `captain_pick`
- 强制开始：管理员可在 `gathering` 触发，缺口用 BOT 填到 10。
- 选人：ABBA 蛇形（A-B-B-A-A-B-B-A）。
- BP：
  - BO1：连续 ban 到剩 1 图
  - BO3：ban-ban-pick-pick-ban-ban + 决胜图
  - BO5：ban-ban 后其余图进入图池

---

## 2.4 GET5 集成

新增后端 env：
- `MATCH_SSH_HOST`
- `MATCH_SSH_PORT`
- `MATCH_SSH_USER`
- `MATCH_SSH_KEY_PATH`
- `MATCH_REMOTE_GET5_DIR`
- `MATCH_SERVER_RESTART_CMD`

执行链路：
1. `launch` 时根据阵容/BP生成 GET5 JSON。
2. SSH/SFTP 上传到远端目录。
3. 执行 `get5_loadmatch <file>` 或你的重启命令。
4. 写入 `match_get5_jobs` 与 `match_events`。
5. 成功：`ready_to_start -> live`；失败：回滚到 `ready_to_start`。

---

## 2.5 前后端联调切换

- 先保留 `matchesMock`，新增 `lib/matchesApi.ts`。
- 用环境开关切换：
  - `NEXT_PUBLIC_MATCHES_USE_MOCK=true/false`
- 后端就绪后改为 `false`，页面无需重写，只替换数据源。

---

## 3. 测试与验收

## 3.1 后端测试
- 状态机迁移合法性
- 单场约束
- ABBA 选人顺序
- BO1/BO3/BO5 BP 结果
- 权限校验（管理员/队长/普通用户）
- GET5 生成与下发（mock SSH）

## 3.2 联调验收
1. 管理员建赛并开启
2. 10 人入房或强制开始
3. 队长流程 + 选人 + BP 完成
4. 点击启动后写入 GET5 job 成功
5. 比赛结束后历史页可见比分与分地图数据
6. 历史详情 tab 可切换总数据/分地图数据

---

## 4. 建议实施顺序

1. 数据库表 + 后端类型
2. 比赛读取接口（list/detail）
3. 比赛流程写接口（join/open/force-start/...）
4. 状态机校验与审计事件
5. GET5 下发任务
6. 前端数据源从 mock 切真实接口
7. 集成测试 + 部署验证
