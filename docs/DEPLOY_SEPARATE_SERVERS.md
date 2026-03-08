# CSGO Panel 分离部署与测试指南（前后端不同服务器）

本文档用于以下部署拓扑：
- 前端服务器：部署 Next.js（例如 `https://panel.example.com`）
- 后端服务器：部署 Go API（例如 `https://api.example.com`）
- 数据库服务器：PostgreSQL（可与后端同机）

如果你暂时没有域名，也可以用公网 IP 测试，但生产建议使用 HTTPS 域名。

---

## 1. 目标架构

- Frontend (Next.js): 对外提供页面
- Backend (Go + Gin): 提供 `/api/v1/*`，处理 Steam OpenID 回调
- PostgreSQL: 后端通过 `DATABASE_URL` 连接

关键要求：
- Steam 必须能访问 `STEAM_RETURN_TO`（后端公网地址）
- 前端浏览器必须能访问 `NEXT_PUBLIC_API_BASE_URL`
- 后端 CORS 要放行前端域名（`FRONTEND_URL`）

---

## 2. 环境变量配置

以下示例假设：
- 前端域名：`https://panel.example.com`
- 后端域名：`https://api.example.com`

### 2.1 后端（`backend/.env`）

```env
PORT=8080
DATABASE_URL=postgres://postgres:postgres@<db-host>:5432/csgopanel?sslmode=disable
JWT_SECRET=<强随机密钥>

# 前端地址（用于 CORS）
FRONTEND_URL=https://panel.example.com

# Steam 登录完成后，后端重定向回前端
FRONTEND_AUTH_CALLBACK_URL=https://panel.example.com/auth/callback

# Steam OpenID 配置（必须是后端可公网访问地址）
STEAM_REALM=https://api.example.com
STEAM_RETURN_TO=https://api.example.com/api/v1/auth/steam/callback

# 管理员 SteamID64，逗号分隔
ADMIN_STEAM_IDS=7656119xxxxxxxxxx,7656119yyyyyyyyyy

# 现有业务配置
RCON_HOST=<game-rcon-host:port>
RCON_PASSWORD=<rcon-password>
RCON_TIMEOUT=5s
GAME_SERVER_ADDRESS=1.116.119.184:27015
POLL_INTERVAL=5s
```

### 2.2 前端（`frontend/.env`）

```env
# 前端调用后端 API 的基地址
NEXT_PUBLIC_API_BASE_URL=https://api.example.com

# 前端“进入服务器”按钮地址
NEXT_PUBLIC_GAME_SERVER_ADDRESS=1.116.119.184:27015
```

---

## 3. 反向代理与端口建议

## 3.1 推荐端口
- 前端对外：`443`（HTTPS）
- 后端对外：`443`（HTTPS）
- 后端容器内部：`8080`
- 前端容器内部：`3000`

## 3.2 Nginx 示例（后端）

```nginx
server {
  listen 443 ssl;
  server_name api.example.com;

  # ssl_certificate /path/fullchain.pem;
  # ssl_certificate_key /path/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 3.3 Nginx 示例（前端）

```nginx
server {
  listen 443 ssl;
  server_name panel.example.com;

  # ssl_certificate /path/fullchain.pem;
  # ssl_certificate_key /path/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## 4. 部署步骤（推荐顺序）

1. 部署数据库并确认后端可连接（`DATABASE_URL`）。
2. 部署后端并验证健康检查：
   - `GET https://api.example.com/healthz` 返回 `{"ok":true}`。
3. 部署前端并验证页面可打开：
   - `https://panel.example.com`。
4. 检查前端环境变量是否生效：
   - 浏览器 Network 中请求应发往 `https://api.example.com/api/v1/...`。
5. 点击 Steam 登录进行完整回调测试。

---

## 5. Steam 登录联调清单

按顺序检查：

1. 点击登录后跳转到：
   - `https://api.example.com/api/v1/auth/steam/login`
2. Steam 登录完成后回调：
   - `https://api.example.com/api/v1/auth/steam/callback?...`
3. 后端重定向到前端：
   - `https://panel.example.com/auth/callback?token=<jwt>`
4. 前端成功写入 `localStorage.auth_token`。
5. 刷新后 `/api/v1/me` 返回当前用户。

---

## 6. 常见问题与排查

## 6.1 点击 Steam 登录失败

优先检查这三项是否仍是 `localhost`：
- `NEXT_PUBLIC_API_BASE_URL`
- `STEAM_REALM`
- `STEAM_RETURN_TO`

任何一个是 `localhost`，在分离部署时都容易失败。

## 6.2 跨域报错（CORS）

- `FRONTEND_URL` 必须与前端实际访问地址完全一致（协议/域名/端口都要一致）。
- 例如：`https://panel.example.com` 与 `http://panel.example.com` 不同。

## 6.3 回调成功但前端没登录状态

- 检查 `FRONTEND_AUTH_CALLBACK_URL` 是否正确。
- 检查前端 `/auth/callback` 页面是否拿到 `token` 参数。

## 6.4 API 可访问但按钮仍报错

- 检查浏览器请求头是否带 `Authorization: Bearer <token>`。
- 检查后端 `JWT_SECRET` 是否在重启后发生变化导致旧 token 失效。

---

## 7. 你当前项目最小可用公网配置（按 IP 测试）

如果你暂时直接用 IP（无域名），例如：
- 前端：`http://<frontend-ip>:3000`
- 后端：`http://<backend-ip>:8080`

则配置为：

### backend/.env
```env
FRONTEND_URL=http://<frontend-ip>:3000
FRONTEND_AUTH_CALLBACK_URL=http://<frontend-ip>:3000/auth/callback
STEAM_REALM=http://<backend-ip>:8080
STEAM_RETURN_TO=http://<backend-ip>:8080/api/v1/auth/steam/callback
```

### frontend/.env
```env
NEXT_PUBLIC_API_BASE_URL=http://<backend-ip>:8080
NEXT_PUBLIC_GAME_SERVER_ADDRESS=1.116.119.184:27015
```

> 注意：IP + HTTP 仅建议临时测试，正式环境建议 HTTPS 域名。
