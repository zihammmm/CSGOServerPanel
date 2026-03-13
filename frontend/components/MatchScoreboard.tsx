"use client";

export type MatchScoreboardRow = {
  key: string;
  nickname: string;
  avatarUrl?: string;
  kd: string;
  assists: string;
  adr: string;
  rating?: string;
};

export type MatchScoreboardTeamRole = "ct" | "t" | "neutral";

export type MatchScoreboardTab = {
  key: string;
  label: string;
};

type MatchScoreboardProps = {
  title?: string;
  teamALabel: string;
  teamBLabel: string;
  scoreA: string;
  scoreB: string;
  teamARole: MatchScoreboardTeamRole;
  teamBRole: MatchScoreboardTeamRole;
  teamARows: MatchScoreboardRow[];
  teamBRows: MatchScoreboardRow[];
  tabs?: MatchScoreboardTab[];
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
};

function teamRoleText(role: MatchScoreboardTeamRole): string {
  return role === "ct" ? "警" : role === "t" ? "匪" : "";
}

function teamRoleClass(role: MatchScoreboardTeamRole, fallback: "a" | "b"): string {
  if (role === "ct") return "match-scoreboard-team-ct";
  if (role === "t") return "match-scoreboard-team-t";
  return fallback === "a" ? "match-scoreboard-team-a" : "match-scoreboard-team-b";
}

export function MatchScoreboard({
  title,
  teamALabel,
  teamBLabel,
  scoreA,
  scoreB,
  teamARole,
  teamBRole,
  teamARows,
  teamBRows,
  tabs = [],
  activeTabKey,
  onTabChange,
}: MatchScoreboardProps) {
  if (teamARows.length === 0 && teamBRows.length === 0) return null;

  return (
    <div className="match-scoreboard-stack">
      {title ? <h3>{title}</h3> : null}
      <div className="match-scoreboard-summary">
        <span>{teamALabel}</span>
        <strong>比分：{scoreA} : {scoreB}</strong>
        <span>{teamBLabel}</span>
      </div>
      {tabs.length > 0 && activeTabKey && onTabChange ? (
        <div className="match-scoreboard-tabs">
          <div className="score-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`button secondary ${activeTabKey === tab.key ? "active-tab" : ""}`}
                onClick={() => onTabChange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <section className={`match-scoreboard-team ${teamRoleClass(teamARole, "a")}`}>
        <div className="match-scoreboard-head">
          <h4>{teamALabel}</h4>
          <span className="status-pill">{teamRoleText(teamARole) || "A 队"}</span>
        </div>
        <div className="match-scoreboard-grid">
          <div className="match-scoreboard-row match-scoreboard-row-head">
            <span>选手</span>
            <span>K-D</span>
            <span>助攻</span>
            <span>ADR</span>
            <span>Rating</span>
          </div>
          {teamARows.length > 0 ? (
            teamARows.map((row) => (
              <div key={row.key} className="match-scoreboard-row">
                <div className="match-scoreboard-player">
                  <img className="avatar avatar-square" src={row.avatarUrl} alt={`${row.nickname} avatar`} />
                  <span>{row.nickname}</span>
                </div>
                <span>{row.kd}</span>
                <span>{row.assists}</span>
                <span>{row.adr}</span>
                <span>{row.rating}</span>
              </div>
            ))
          ) : (
            <p className="muted">暂无队伍数据。</p>
          )}
        </div>
      </section>

      <section className={`match-scoreboard-team ${teamRoleClass(teamBRole, "b")}`}>
        <div className="match-scoreboard-head">
          <h4>{teamBLabel}</h4>
          <span className="status-pill">{teamRoleText(teamBRole) || "B 队"}</span>
        </div>
        <div className="match-scoreboard-grid">
          <div className="match-scoreboard-row match-scoreboard-row-head">
            <span>选手</span>
            <span>K-D</span>
            <span>助攻</span>
            <span>ADR</span>
            <span>Rating</span>
          </div>
          {teamBRows.length > 0 ? (
            teamBRows.map((row) => (
              <div key={row.key} className="match-scoreboard-row">
                <div className="match-scoreboard-player">
                  <img className="avatar avatar-square" src={row.avatarUrl} alt={`${row.nickname} avatar`} />
                  <span>{row.nickname}</span>
                </div>
                <span>{row.kd}</span>
                <span>{row.assists}</span>
                <span>{row.adr}</span>
                <span>{row.rating}</span>
              </div>
            ))
          ) : (
            <p className="muted">暂无队伍数据。</p>
          )}
        </div>
      </section>
    </div>
  );
}
