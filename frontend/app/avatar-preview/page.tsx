"use client";

const demoPlayers = [
  {
    id: 1,
    nickname: "MirageFox",
    avatarUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g1' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%2395ffd1'/><stop offset='1' stop-color='%232591ff'/></linearGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g1)'/><text x='48' y='58' text-anchor='middle' font-size='34' font-family='Segoe UI, Arial, sans-serif' fill='%23081b20' font-weight='700'>M</text></svg>",
  },
  {
    id: 2,
    nickname: "DustCaptain",
    avatarUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g2' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23ffd38a'/><stop offset='1' stop-color='%23ff7b72'/></linearGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g2)'/><text x='48' y='58' text-anchor='middle' font-size='34' font-family='Segoe UI, Arial, sans-serif' fill='%23261108' font-weight='700'>D</text></svg>",
  },
  {
    id: 3,
    nickname: "AncientAce",
    avatarUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g3' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23d2ff7a'/><stop offset='1' stop-color='%2357a64a'/></linearGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g3)'/><text x='48' y='58' text-anchor='middle' font-size='34' font-family='Segoe UI, Arial, sans-serif' fill='%23142209' font-weight='700'>A</text></svg>",
  },
  {
    id: 4,
    nickname: "TrainLock",
    avatarUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g4' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23d6d9ff'/><stop offset='1' stop-color='%237884ff'/></linearGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g4)'/><text x='48' y='58' text-anchor='middle' font-size='34' font-family='Segoe UI, Arial, sans-serif' fill='%230d1430' font-weight='700'>T</text></svg>",
  },
];

export default function AvatarPreviewPage() {
  const teamA = demoPlayers.slice(0, 2);
  const teamB = demoPlayers.slice(2, 4);
  const waiting = demoPlayers.slice(1, 3);
  const pickPool = [
    demoPlayers[1],
    demoPlayers[2],
    {
      id: 5,
      nickname: "NukeShift",
      avatarUrl:
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><defs><linearGradient id='g5' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23ffe28f'/><stop offset='1' stop-color='%23a86dff'/></linearGradient></defs><rect width='96' height='96' rx='18' fill='url(%23g5)'/><text x='48' y='58' text-anchor='middle' font-size='34' font-family='Segoe UI, Arial, sans-serif' fill='%231d1030' font-weight='700'>N</text></svg>",
    },
  ];

  return (
    <div>
      <section className="panel">
        <h2>头像样式预览</h2>
        <p className="muted">
          这个页面直接复用比赛详情页当前使用的 `user-cell`、`avatar avatar-square` 和 `team-panel` 样式，
          用来观察方形头像在报名名单、A/B 队面板和未分队列表里的实际视觉效果。
        </p>
      </section>

      <section className="panel">
        <h3>报名名单效果</h3>
        <ul className="avatar-preview-list">
          {demoPlayers.map((player) => (
            <li key={`signup-${player.id}`}>
              <div className="user-cell avatar-preview-user">
                <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
                <span>{player.nickname}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>选人阶段效果</h3>
        <div className="team-panels">
          <div className="team-panel team-panel-a">
            <h4>MirageFox 的队伍</h4>
            <ul className="avatar-preview-list">
              {teamA.map((player, index) => (
                <li key={`a-${player.id}`}>
                  <div className="user-cell avatar-preview-user">
                    <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
                    <span>{player.nickname} {index === 0 ? "(队长)" : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="team-panel team-panel-b">
            <h4>AncientAce 的队伍</h4>
            <ul className="avatar-preview-list">
              {teamB.map((player, index) => (
                <li key={`b-${player.id}`}>
                  <div className="user-cell avatar-preview-user">
                    <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
                    <span>{player.nickname} {index === 0 ? "(队长)" : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>完整选人界面预览</h3>
        <p>当前回合: A 队</p>
        <p className="muted">剩余时间: 00:23，超时后系统随机选人</p>

        <div className="team-panels" style={{ marginTop: "14px" }}>
          <div className="team-panel team-panel-a">
            <h4>MirageFox 的队伍</h4>
            <ul className="avatar-preview-list">
              {teamA.map((player, index) => (
                <li key={`draft-a-${player.id}`}>
                  <div className="user-cell avatar-preview-user">
                    <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
                    <span>{player.nickname} {index === 0 ? "(队长)" : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="team-panel team-panel-b">
            <h4>AncientAce 的队伍</h4>
            <ul className="avatar-preview-list">
              <li>
                <div className="user-cell avatar-preview-user">
                  <img className="avatar avatar-square avatar-preview-avatar" src={demoPlayers[2].avatarUrl} alt={`${demoPlayers[2].nickname} avatar`} />
                  <span>{demoPlayers[2].nickname} (队长)</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <h4 style={{ marginTop: "18px" }}>可选玩家</h4>
        <div className="avatar-preview-picks">
          {pickPool.map((player) => (
            <button key={`pick-${player.id}`} className="button secondary avatar-preview-pick">
              <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
              <span>选择 {player.nickname}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>未分队列表效果</h3>
        <ul className="avatar-preview-list">
          {waiting.map((player) => (
            <li key={`waiting-${player.id}`}>
              <div className="user-cell avatar-preview-user">
                <img className="avatar avatar-square avatar-preview-avatar" src={player.avatarUrl} alt={`${player.nickname} avatar`} />
                <span>{player.nickname}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <style jsx>{`
        .avatar-preview-list {
          margin-top: 10px;
          padding-left: 0;
          list-style: none;
        }

        .avatar-preview-list li {
          margin: 8px 0;
        }

        .avatar-preview-user {
          font-size: 1.1rem;
          gap: 10px;
        }

        .avatar-preview-avatar {
          width: 31px;
          height: 31px;
        }

        .avatar-preview-pick {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 42px;
          width: fit-content;
          padding: 8px 12px;
          font-size: 0.95rem;
        }

        .avatar-preview-picks {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}
