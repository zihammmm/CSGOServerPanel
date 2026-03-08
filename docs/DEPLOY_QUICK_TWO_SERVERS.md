# 两台服务器快速部署（前后端分离，适合频繁改动验证）

本文档给你一个最少步骤方案：
- 后端机：`backend + postgres`
- 前端机：`frontend`
- 每次改动后：`git pull + 一条脚本命令` 完成重部署

## 1. 目录与代码

两台机器都放在同一路径（建议）：

```bash
mkdir -p /opt
cd /opt
git clone <你的仓库地址> CSGOServer
cd CSGOServer
```

## 2. 需要你配置的文件

## 2.1 后端机配置：`backend/.env`

先复制模板：

```bash
cd /opt/CSGOServer
cp backend/.env.example backend/.env
```

至少确认以下字段：

```env
PORT=8080
DATABASE_URL=postgres://postgres:postgres@csgopanel-db:5432/csgopanel?sslmode=disable
JWT_SECRET=请改成强随机字符串

FRONTEND_URL=http://<前端机IP>:3000
FRONTEND_AUTH_CALLBACK_URL=http://<前端机IP>:3000/auth/callback

STEAM_REALM=http://<后端机IP>:8080
STEAM_RETURN_TO=http://<后端机IP>:8080/api/v1/auth/steam/callback

ADMIN_STEAM_IDS=7656119xxxxxxxxxx
```

可选（比赛启动下发）：

```env
MATCH_SSH_HOST=
MATCH_SSH_PORT=22
MATCH_SSH_USER=
MATCH_SSH_KEY_PATH=
MATCH_REMOTE_GET5_DIR=
MATCH_SERVER_RESTART_CMD=
```

## 2.2 前端机配置：`frontend/.env`

先复制模板：

```bash
cd /opt/CSGOServer
cp frontend/.env.example frontend/.env
```

至少确认以下字段：

```env
NEXT_PUBLIC_API_BASE_URL=http://<后端机IP>:8080
NEXT_PUBLIC_GAME_SERVER_ADDRESS=<你的CS地址:端口>
NEXT_PUBLIC_MATCHES_USE_MOCK=false
```

## 3. 首次部署

## 3.1 后端机（先启动数据库，再启动后端）

```bash
cd /opt/CSGOServer
./deploy/scripts/deploy_backend.sh init-db
./deploy/scripts/deploy_backend.sh deploy
./deploy/scripts/deploy_backend.sh ps
```

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

## 3.2 前端机

```bash
cd /opt/CSGOServer
./deploy/scripts/deploy_frontend.sh deploy
./deploy/scripts/deploy_frontend.sh ps
```

访问：

```text
http://<前端机IP>:3000
```

## 4. 日常快速更新（边改边测）

## 4.1 后端改动后（后端机执行）

```bash
cd /opt/CSGOServer
git pull
./deploy/scripts/deploy_backend.sh deploy
```

看日志：

```bash
./deploy/scripts/deploy_backend.sh logs
```

## 4.2 前端改动后（前端机执行）

```bash
cd /opt/CSGOServer
git pull
./deploy/scripts/deploy_frontend.sh deploy
```

看日志：

```bash
./deploy/scripts/deploy_frontend.sh logs
```

## 5. 常见问题

1. 前端请求失败/CORS：检查后端 `FRONTEND_URL` 是否与实际访问前端地址完全一致。  
2. Steam 登录失败：检查 `STEAM_REALM` 和 `STEAM_RETURN_TO` 不能是 `localhost`。  
3. 比赛仍是 mock：检查前端 `NEXT_PUBLIC_MATCHES_USE_MOCK=false`，并重部署前端。  
4. 后端连不上数据库：`DATABASE_URL` 主机名在本方案里应为 `csgopanel-db`（脚本创建的容器名）。  
