# Match Module 联调验收清单

本文档用于在本地或测试环境验证比赛模块后端链路。

## 0. 前置配置

- 后端数据库已迁移（启动 backend 会自动 migrate）
- 前端使用真实接口：
  - `frontend/.env` 里设置 `NEXT_PUBLIC_MATCHES_USE_MOCK=false`
- 至少准备 2 个账号：
  - 管理员账号（SteamID 在 `ADMIN_STEAM_IDS`）
  - 普通账号（或多个）

可选 GET5 真实下发：
- `MATCH_SSH_HOST`
- `MATCH_SSH_PORT`（默认 `22`）
- `MATCH_SSH_USER`
- `MATCH_SSH_KEY_PATH`
- `MATCH_REMOTE_GET5_DIR`
- `MATCH_SERVER_RESTART_CMD`（可含 `{{CONFIG_PATH}}`）

## 1. 建赛与开启

1. 管理员登录后调用 `POST /api/v1/admin/matches`，请求体：
```json
{"bo":3,"captainMode":"admin_assigned"}
```
2. 确认返回详情中 `status=created`
3. 调用 `POST /api/v1/admin/matches/:id/open`
4. 确认 `status=gathering`

## 2. 入房与队长流程

1. 玩家调用 `POST /api/v1/matches/:id/join`
2. 满 10 人后：
- `captainMode=random` => 自动进入 `player_draft`
- `captainMode=admin_assigned` => 进入 `captain_pick`
3. 若为 `captain_pick`，管理员调用 `POST /api/v1/admin/matches/:id/captains`：
```json
{"captainAUserId":123,"captainBUserId":456}
```
4. 确认进入 `player_draft`

## 3. ABBA 选人

- 使用队长账号调用 `POST /api/v1/matches/:id/draft/pick`
```json
{"targetUserId":789}
```
- 只允许当前回合队长操作（ABBA：A-B-B-A-A-B-B-A）
- 队伍满员后自动进入 `map_veto`

## 4. BP 选图

- 队长调用 `POST /api/v1/matches/:id/veto/action`
```json
{"mapName":"de_mirage"}
```
- 校验当前回合与地图池合法性
- 完成后自动进入 `ready_to_start`

## 5. 启动与结束

1. 管理员调用 `POST /api/v1/admin/matches/:id/launch`
2. 预期：
- 成功：`status=live`，写入 `match_get5_jobs(status=success)`
- 失败：回滚 `status=ready_to_start`，写入 `match_get5_jobs(status=failed)`
3. 管理员调用 `POST /api/v1/admin/matches/:id/finish`
4. 预期：
- `status=finished`
- `scoreA/scoreB` 有值
- `match_map_results` 与 `match_player_map_stats` 有数据

## 6. 历史查询

1. `GET /api/v1/matches`
- `active` 为空或非终态比赛
- `history` 包含 finished/cancelled
2. `GET /api/v1/matches/:id`
- `mapResults`、`playerStats`、`vetoSteps` 可用于前端历史详情页

## 7. 单场约束

- 在存在 `status NOT IN (finished,cancelled)` 的比赛时再次建赛，预期返回冲突错误（409）。

