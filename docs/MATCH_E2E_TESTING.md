# Match E2E Testing

用于在线上或测试环境快速构造比赛流程测试账号，并通过真实 API 跑完整比赛链路。

## 前置环境变量

- `DATABASE_URL`
- `JWT_SECRET`
- `API_BASE_URL`

默认值：

- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/csgopanel?sslmode=disable`
- `JWT_SECRET=dev-secret`
- `API_BASE_URL=http://localhost:8080`

## 1. 准备测试账号和 token

```bash
./scripts/prepare_match_test_users.sh
```

默认输出：

- `/tmp/matchtest-users.json`
- `/tmp/matchtest-users.env`

账号固定为：

- `E2E-Admin`
- `E2E-P01` 到 `E2E-P10`

这些账号会被直接写入数据库，并生成可用 JWT token。

## 2. 跑完整比赛流程

管理员指定队长模式：

```bash
./scripts/run_match_flow.sh --captain-mode admin_assigned --bo 3
```

随机队长模式：

```bash
./scripts/run_match_flow.sh --captain-mode random --bo 3
```

不足 10 人强制开启：

```bash
./scripts/run_match_flow.sh --captain-mode admin_assigned --bo 3 --force-start
```

脚本会自动执行：

1. 创建比赛
2. 让测试账号加入房间
3. 正常开启或强制开启
4. 指定队长或读取随机队长
5. 自动完成队长选人
6. 自动完成 BP
7. 启动比赛
8. 结束比赛

## 2.5 更简单的人工联调方式：给当前比赛补 8 个机器人

适合这种场景：

- 你自己在前端页面创建比赛
- 你和另一个真人先手动加入房间
- 然后用脚本补 8 个机器人
- 再回到详情页手动开启比赛、指定你俩为队长、手动选人和 BP

命令：

```bash
./scripts/fill_match_room_with_bots.sh --count 8
```

如果你要指定某个比赛 ID：

```bash
./scripts/fill_match_room_with_bots.sh --match-id 你的比赛ID --count 8
```

限制：

- 只会往当前 `gathering` 阶段的比赛里加人
- 不会自动开赛
- 不会自动指定队长
- 房间最多 10 人，所以通常应先让两个真人加入，再补 `8` 个

推荐人工验证流程：

1. 前端创建比赛，队长模式选 `管理员指定`
2. 你和另一个真人登录并加入房间
3. 执行 `./scripts/fill_match_room_with_bots.sh --count 8`
4. 回到比赛详情页，管理员点击“开启比赛”
5. 指定你和另一个真人为队长
6. 手动完成选人和 BP
7. 后续继续启动和结束比赛

## 3. 清理测试数据

```bash
./scripts/cleanup_match_test_data.sh
```

会删除：

- `nickname` 以 `E2E-` 开头的测试用户
- 这些用户创建或参与的比赛及相关联表数据

## 说明

- `--force-start` 不支持 `random` 队长模式，因为机器人可能被随机选为队长，后续流程无法继续由脚本完成。
- 这些脚本依赖数据库写权限，适合你自己控制的测试环境或线上维护窗口，不适合开放给普通管理员使用。
