# CSGOServer API 文档（当前实现）

## 1. 基础信息

- Base URL: `http://<backend-host>:8080`
- API 前缀: `/api/v1`
- 鉴权: `Authorization: Bearer <jwt>`
- Content-Type: `application/json`

通用错误结构：

```json
{
  "error": "error message"
}
```

部分接口会附加字段，例如：

```json
{
  "error": "rcon command failed",
  "detail": "dial tcp ..."
}
```

## 2. 认证与用户

### `GET /healthz`

- 鉴权: 否
- 响应 `200`

```json
{ "ok": true }
```

### `GET /api/v1/auth/steam/login`

- 鉴权: 否
- 响应: `302` 重定向到 Steam OpenID 登录页

### `GET /api/v1/auth/steam/callback`

- 鉴权: 否
- 行为:
1. 校验 Steam OpenID 回调
2. 创建/更新用户
3. 签发 JWT
4. 默认 `302` 重定向到 `FRONTEND_AUTH_CALLBACK_URL?token=<jwt>`
- 失败响应:
  - `401` `{ "error": "steam verification failed" }`
  - `400` `{ "error": "steam id missing" }`

### `POST /api/v1/auth/logout`

- 鉴权: 否
- 当前实现: 后端无状态登出
- 响应 `204`

### `GET /api/v1/me`

- 鉴权: 是
- 响应 `200`

```json
{
  "id": 1,
  "steamId": "7656119xxxx",
  "role": "guest",
  "nickname": "Player-123456"
}
```

### `PATCH /api/v1/me/nickname`

- 鉴权: 是
- 请求:

```json
{
  "nickname": "NewNick"
}
```

- 约束: 长度 `2-24`
- 响应:
  - `204` 无响应体
  - `400` `{"error":"invalid body"}` 或 `{"error":"nickname must be 2-24 chars"}`

## 3. Dashboard 与排行榜

### `GET /api/v1/dashboard/server-status`

- 鉴权: 是
- 响应 `200`

```json
{
  "running": true,
  "map": "de_mirage",
  "mode": "competitive",
  "players": 10,
  "maxPlayers": 32,
  "updatedAt": "2026-03-08T10:00:00Z"
}
```

### `GET /api/v1/dashboard/match-live`

- 鉴权: 是
- 响应 `200`

```json
{
  "scoreCt": 0,
  "scoreT": 0,
  "players": [
    {
      "playerId": "U:1:12345",
      "name": "Alpha",
      "kills": 0,
      "deaths": 0,
      "kd": 0,
      "team": "unknown"
    }
  ],
  "updatedAt": "2026-03-08T10:00:00Z"
}
```

### `GET /api/v1/leaderboard?sort=total_wins|total_kd&page=1&page_size=20`

- 鉴权: 是
- 响应 `200`

```json
{
  "items": [
    {
      "steamId": "7656119xxxx",
      "nickname": "Alpha",
      "totalWins": 10,
      "totalKd": 1.23,
      "totalKills": 200,
      "totalDeaths": 163
    }
  ],
  "page": 1,
  "pageSize": 20,
  "sort": "total_wins"
}
```

## 4. 管理员 RCON

以下接口均要求: 鉴权 + `role=admin`

### `POST /api/v1/admin/rcon/kick`

请求:

```json
{
  "player": "U:1:12345",
  "reason": "afk"
}
```

### `POST /api/v1/admin/rcon/change-map`

请求:

```json
{
  "map": "de_mirage"
}
```

### `POST /api/v1/admin/rcon/change-mode`

请求:

```json
{
  "mode": "competitive"
}
```

支持 `mode`: `competitive|casual|deathmatch`

通用成功响应 `200`:

```json
{
  "result": "success",
  "output": "..."
}
```

失败响应 `502`:

```json
{
  "error": "rcon command failed",
  "detail": "..."
}
```

### `GET /api/v1/admin/audit-logs`

响应 `200`:

```json
{
  "items": [
    {
      "id": 1,
      "action": "kick",
      "target": "U:1:12345",
      "payload": { "reason": "afk" },
      "result": "success",
      "error": "",
      "createdAt": "2026-03-08T10:00:00Z",
      "admin": "AdminName"
    }
  ]
}
```

## 5. 比赛模块

### 5.1 枚举

- `status`:
  - `created`
  - `gathering`
  - `captain_pick`
  - `player_draft`
  - `map_veto`
  - `ready_to_start`
  - `launching`
  - `live`
  - `finished`
  - `cancelled`
- `captainMode`: `admin_assigned | random`
- `team`: `A | B`
- `veto action`: `ban | pick`

### 5.2 查询接口（登录用户）

### `GET /api/v1/matches`

- 鉴权: 是
- 响应 `200`

```json
{
  "active": {
    "id": "1741430123456001",
    "title": "5v5 竞技 BO3 - 3/8 22:10",
    "status": "gathering",
    "bo": 3,
    "captainMode": "admin_assigned",
    "creatorName": "Admin",
    "createdAt": "2026-03-08T14:10:00Z",
    "playerCount": 4,
    "scoreA": null,
    "scoreB": null
  },
  "history": []
}
```

### `GET /api/v1/matches/:id`

- 鉴权: 是
- 响应 `200`（字段较多，示例如下）

```json
{
  "id": "1741430123456001",
  "title": "5v5 竞技 BO3 - 3/8 22:10",
  "status": "player_draft",
  "bo": 3,
  "captainMode": "admin_assigned",
  "creatorName": "Admin",
  "creatorUserId": 1,
  "createdAt": "2026-03-08T14:10:00Z",
  "updatedAt": "2026-03-08T14:20:00Z",
  "serverAddr": "127.0.0.1:27015",
  "scoreA": null,
  "scoreB": null,
  "players": [
    {
      "userId": 1,
      "steamId": "7656119xxxx",
      "nickname": "Admin",
      "team": "A",
      "isCaptain": true,
      "joinedAt": "2026-03-08T14:11:00Z"
    }
  ],
  "mapsPool": ["de_ancient","de_anubis","de_dust2","de_inferno","de_mirage","de_nuke","de_train"],
  "pickedMaps": [],
  "bannedMaps": [],
  "vetoSteps": [],
  "draftTurns": ["A","B","B","A","A","B","B","A"],
  "draftTurnIndex": 0,
  "vetoScript": [
    {"team":"A","action":"ban"},
    {"team":"B","action":"ban"},
    {"team":"A","action":"pick"},
    {"team":"B","action":"pick"},
    {"team":"A","action":"ban"},
    {"team":"B","action":"ban"}
  ],
  "vetoTurnIndex": 0,
  "playerStats": [],
  "mapResults": []
}
```

### `POST /api/v1/matches/:id/join`

- 鉴权: 是
- 请求体: 可传空对象 `{}`（当前服务端不读取 body）
- 响应: 返回最新比赛详情（同 `GET /matches/:id`）

### `POST /api/v1/matches/:id/draft/pick`

- 鉴权: 是（仅当前回合队长可成功）
- 请求:

```json
{
  "targetUserId": 123
}
```

- 响应: 返回最新比赛详情

### `POST /api/v1/matches/:id/veto/action`

- 鉴权: 是（仅当前回合队长可成功）
- 请求:

```json
{
  "mapName": "de_mirage"
}
```

- 响应: 返回最新比赛详情

### 5.3 管理员接口

以下接口均要求: 鉴权 + `role=admin`

### `POST /api/v1/admin/matches`

请求:

```json
{
  "bo": 3,
  "captainMode": "admin_assigned"
}
```

- `bo` 仅支持 `1|3|5`
- 响应: 返回新建比赛详情

### `POST /api/v1/admin/matches/:id/open`

- 请求体: `{}`（可空）
- 响应: 返回最新比赛详情

### `POST /api/v1/admin/matches/:id/force-start`

- 请求体: `{}`（可空）
- 行为: 不足 10 人时补 BOT 到 10 人
- 响应: 返回最新比赛详情

### `POST /api/v1/admin/matches/:id/captains`

请求:

```json
{
  "captainAUserId": 123,
  "captainBUserId": 456
}
```

- 响应: 返回最新比赛详情

### `POST /api/v1/admin/matches/:id/launch`

- 请求体: `{}`（可空）
- 行为:
1. 生成 GET5 配置
2. 记录 `match_get5_jobs`
3. 成功进 `live`，失败回滚 `ready_to_start`
- 响应: 返回最新比赛详情

### `POST /api/v1/admin/matches/:id/finish`

- 请求体: `{}`（可空）
- 行为: 结束比赛并写入分地图结果与选手统计
- 响应: 返回最新比赛详情

## 6. 常见鉴权错误

- 未带 token:

```json
{ "error": "missing token" }
```

- token 非法/过期:

```json
{ "error": "invalid token" }
```

- 非管理员访问管理员接口:

```json
{ "error": "admin only" }
```
