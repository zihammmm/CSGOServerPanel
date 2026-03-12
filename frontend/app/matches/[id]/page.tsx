"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, CurrentUser, steamLoginURL } from "../../../lib/api";
import {
  MatchDetail,
  MatchPlayer,
  assignCaptains,
  cancelMatch,
  draftPick,
  finishMatch,
  forceStartMatch,
  getMatchDetail,
  joinMatch,
  leaveMatch,
  launchMatch,
  startMatch,
  vetoMap,
} from "../../../lib/matches";

const statusText: Record<string, string> = {
  created: "已创建",
  gathering: "报名中",
  captain_pick: "指定队长",
  player_draft: "队长选人",
  map_veto: "BP 选图",
  ready_to_start: "待启动",
  live: "进行中",
  finished: "已结束",
  cancelled: "已取消",
};

const mapNameText: Record<string, string> = {
  de_ancient: "远古遗迹",
  de_anubis: "阿努比斯",
  de_dust2: "炙热沙城 II",
  de_inferno: "炼狱小镇",
  de_mirage: "荒漠迷城",
  de_nuke: "核子危机",
  de_train: "列车停放站",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function formatMapName(map: string): string {
  return mapNameText[map] || map;
}

function formatCaptainMode(mode: string): string {
  return mode === "admin_assigned" ? "管理员指定" : "系统随机";
}

function formatTeamName(team: string): string {
  return team === "A" ? "A 队" : team === "B" ? "B 队" : team;
}

function formatVetoAction(action: string): string {
  return action === "ban" ? "禁用" : action === "pick" ? "选择" : action;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function phaseList(current: string): Array<{ key: string; label: string; done: boolean; active: boolean }> {
  const list = [
    { key: "gathering", label: "入房" },
    { key: "captain_pick", label: "队长" },
    { key: "player_draft", label: "选人" },
    { key: "map_veto", label: "BP" },
    { key: "ready_to_start", label: "启动" },
    { key: "live", label: "比赛中" },
    { key: "finished", label: "结束" },
  ];
  const index = list.findIndex((v) => v.key === current);
  return list.map((v, i) => ({ ...v, done: i <= index, active: i === index }));
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const matchId = params.id;

  const [me, setMe] = useState<CurrentUser | null>(null);
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [capA, setCapA] = useState<number>(0);
  const [capB, setCapB] = useState<number>(0);
  const [scoreTab, setScoreTab] = useState<string>("overall");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showForceStartModal, setShowForceStartModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isAdmin = useMemo(() => me?.role === "admin" || me?.role === "super_admin", [me]);
  const players = match?.players ?? [];
  const mapResults = match?.mapResults ?? [];
  const pickedMaps = match?.pickedMaps ?? [];
  const pickedMapDetails = match?.pickedMapDetails ?? [];
  const mapsPool = match?.mapsPool ?? [];
  const vetoSteps = match?.vetoSteps ?? [];
  const draftTurns = match?.draftTurns ?? [];
  const vetoScript = match?.vetoScript ?? [];
  const playerStats = match?.playerStats ?? [];

  const mePlayer = useMemo(() => players.find((p) => p.userId === me?.id) || null, [players, me]);

  const teamA = useMemo(() => players.filter((p) => p.team === "A"), [players]);
  const teamB = useMemo(() => players.filter((p) => p.team === "B"), [players]);
  const captainA = useMemo(() => players.find((p) => p.isCaptain && p.team === "A") || null, [players]);
  const captainB = useMemo(() => players.find((p) => p.isCaptain && p.team === "B") || null, [players]);
  const scoreTabs = useMemo(() => {
    if (!match || match.status !== "finished") return [];
    return [
      { key: "overall", label: "总数据" },
      ...mapResults.map((m) => ({ key: m.key, label: m.map })),
    ];
  }, [match, mapResults]);

  const activeMapResult = useMemo(() => {
    if (!match || match.status !== "finished" || scoreTab === "overall") return null;
    return mapResults.find((m) => m.key === scoreTab) || null;
  }, [match, scoreTab, mapResults]);

  const activePlayerStats = useMemo(() => {
    if (!match || match.status !== "finished") return [];
    return activeMapResult ? (activeMapResult.playerStats ?? []) : playerStats;
  }, [match, activeMapResult, playerStats]);

  const teamAStats = useMemo(() => activePlayerStats.filter((s) => s.team === "A"), [activePlayerStats]);
  const teamBStats = useMemo(() => activePlayerStats.filter((s) => s.team === "B"), [activePlayerStats]);
  const unassigned = useMemo(() => players.filter((p) => !p.team && !p.isCaptain), [players]);

  const draftTurnTeam = useMemo(() => {
    if (!match || match.status !== "player_draft") return null;
    return draftTurns[match.draftTurnIndex] || null;
  }, [match, draftTurns]);

  const vetoTurn = useMemo(() => {
    if (!match || match.status !== "map_veto") return null;
    return vetoScript[match.vetoTurnIndex] || null;
  }, [match, vetoScript]);

  const isRegistrationStage = match?.status === "gathering";
  const isMatchFull = players.length >= 10;
  const canJoin = !!match && isRegistrationStage && !!me && !mePlayer && !isMatchFull;
  const canLeave = !!match && isRegistrationStage && !!mePlayer;
  const canStart = !!match && isRegistrationStage && isAdmin && players.length === 10;
  const canForceStart = !!match && isRegistrationStage && isAdmin && players.length < 10;

  const canDraft =
    !!match &&
    match.status === "player_draft" &&
    !!mePlayer?.isCaptain &&
    !!mePlayer.team &&
    draftTurnTeam === mePlayer.team;

  const canVeto =
    !!match &&
    match.status === "map_veto" &&
    !!mePlayer?.isCaptain &&
    !!mePlayer.team &&
    !!vetoTurn &&
    vetoTurn.team === mePlayer.team;

  const turnDeadline = useMemo(() => {
    if (!match || (match.status !== "player_draft" && match.status !== "map_veto")) return null;
    return new Date(match.updatedAt).getTime() + 30_000;
  }, [match]);

  const countdownSeconds = useMemo(() => {
    if (!turnDeadline) return 0;
    return Math.max(0, Math.ceil((turnDeadline - now) / 1000));
  }, [turnDeadline, now]);

  const load = async () => {
    const [detail] = await Promise.all([getMatchDetail(matchId)]);
    setMatch(detail);
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      setError("");
      try {
        try {
          const user = await apiFetch<CurrentUser>("/api/v1/me");
          if (active) setMe(user);
        } catch {
          if (active) setMe(null);
        }
        if (active) {
          await load();
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [matchId]);

  useEffect(() => {
    if (!match || ["finished", "cancelled"].includes(match.status)) {
      return;
    }
    const timer = setInterval(() => {
      load().catch(() => null);
    }, 3000);
    return () => clearInterval(timer);
  }, [match?.id, match?.status]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setScoreTab("overall");
  }, [matchId]);

  useEffect(() => {
    if (!scoreTabs.some((t) => t.key === scoreTab)) {
      setScoreTab("overall");
    }
  }, [scoreTabs, scoreTab]);

  const run = async (fn: () => Promise<MatchDetail>) => {
    setError("");
    try {
      const next = await fn();
      setMatch(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const doJoin = () => {
    if (!me) {
      setShowLoginModal(true);
      return;
    }
    run(() => joinMatch(matchId, { userId: me.id, steamId: me.steamId, nickname: me.nickname }));
  };

  const doLeave = () => {
    if (!me) return;
    run(() => leaveMatch(matchId, me.id));
  };

  const doAssignCaptains = () => {
    if (!me || !capA || !capB) return;
    run(() => assignCaptains(matchId, me.id, capA, capB));
  };

  const doLaunch = () => {
    if (!me) return;
    run(() => launchMatch(matchId, me.id));
  };

  const doFinish = () => {
    if (!me) return;
    run(() => finishMatch(matchId, me.id));
  };

  const doCancel = () => {
    if (!me) return;
    run(() => cancelMatch(matchId, me.id));
  };

  const doForceStart = () => {
    if (!me) return;
    run(() => forceStartMatch(matchId, me.id, me.role));
  };

  const doStart = () => {
    if (!me) return;
    run(() => startMatch(matchId, me.id, me.role));
  };

  const captainOptions = players.map((p) => ({ label: `${p.nickname} (${p.steamId})`, value: p.userId }));

  if (loading) {
    return <section className="panel"><p className="muted">比赛详情加载中...</p></section>;
  }

  if (!match) {
    return <section className="panel"><p className="muted">比赛不存在</p></section>;
  }

  return (
    <div>
      <section className="panel">
        <p>
          <Link className="button secondary" href="/matches">返回比赛列表</Link>
        </p>
        <h2>{match.title}</h2>
        <p>比赛 ID: {match.id}</p>
        <p>状态: <span className="status-pill">{statusText[match.status]}</span></p>
        <p>BO: BO{match.bo} | 队长策略: {formatCaptainMode(match.captainMode)}</p>
        <p>创建者: {match.creatorName} | 创建时间: {formatTime(match.createdAt)}</p>
        <p>服务器: {match.serverAddr}</p>
        <div className="phase-track">
          {phaseList(match.status).map((p) => (
            <div key={p.key} className={`phase-node ${p.done ? "done" : ""} ${p.active ? "active" : ""}`}>
              <span className="dot" />
              <span className="label">{p.label}</span>
            </div>
          ))}
        </div>
        {isAdmin && !["finished", "cancelled"].includes(match.status) && (
          <p className="row-actions">
            <button className="button secondary" onClick={() => setShowCancelModal(true)}>取消比赛</button>
          </p>
        )}
      </section>

      <section className="panel">
        <h3>比分板</h3>
        <p>当前人数: {players.length}/10</p>
        <p>
          比赛地图: {pickedMapDetails.length > 0
            ? pickedMapDetails.map((item) => {
              const pickedBy = item.pickedByTeam ? `${formatTeamName(item.pickedByTeam)}选择` : "默认图";
              const side = item.startSide === "T" ? "，Pick 方默认当匪" : "";
              return `${formatMapName(item.map)}（${pickedBy}${side}）`;
            }).join(" / ")
            : pickedMaps.map(formatMapName).join(" / ") || "-"}
        </p>
        <p className="muted">最后更新时间: {formatTime(match.updatedAt)}</p>
        {match.status === "finished" && (
          <>
            <div className="score-tabs">
              {scoreTabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`button secondary ${scoreTab === tab.key ? "active-tab" : ""}`}
                  onClick={() => setScoreTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p>
              <strong>
                {activeMapResult ? `${formatMapName(activeMapResult.map)} 比分` : "总比分"}: A 队{" "}
                {activeMapResult ? activeMapResult.scoreA : (match.scoreA ?? "-")} :{" "}
                {activeMapResult ? activeMapResult.scoreB : (match.scoreB ?? "-")} B 队
              </strong>
            </p>
          </>
        )}
        {match.status !== "finished" && (
          <div className="team-panels">
            <div className="team-panel team-panel-a">
              <h4>{captainA ? `${captainA.nickname} 的队伍` : "A 队"}</h4>
              <ul>
                {teamA.map((p) => (
                  <li key={p.userId}>{p.nickname} {p.isCaptain ? "(队长)" : ""}</li>
                ))}
              </ul>
            </div>
            <div className="team-panel team-panel-b">
              <h4>{captainB ? `${captainB.nickname} 的队伍` : "B 队"}</h4>
              <ul>
                {teamB.map((p) => (
                  <li key={p.userId}>{p.nickname} {p.isCaptain ? "(队长)" : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {match.status !== "finished" && unassigned.length > 0 && (
          <>
            <h4>未分队玩家</h4>
            <ul>
              {unassigned.map((p) => (
                <li key={p.userId}>{p.nickname}</li>
              ))}
            </ul>
          </>
        )}

        {isRegistrationStage && (
          <>
            <p className="muted">报名环节中，已登录用户可加入或退出房间。</p>
            <p className="row-actions">
              {!mePlayer ? (
                <button className="button" disabled={!!me && !canJoin} onClick={doJoin}>
                  {!me ? "加入比赛房间" : isMatchFull ? "房间已满" : "加入比赛房间"}
                </button>
              ) : (
                <button className="button secondary" onClick={doLeave} disabled={!canLeave}>
                  退出比赛房间
                </button>
              )}
              {isAdmin && (
                <>
                  <button className={`button ${canStart ? "match-start-ready" : "secondary"}`} disabled={!canStart} onClick={doStart}>
                    开启比赛
                  </button>
                  <button className="button secondary" disabled={!canForceStart} onClick={() => setShowForceStartModal(true)}>
                    强制开启
                  </button>
                </>
              )}
            </p>
          </>
        )}
        {isAdmin && match.status === "ready_to_start" && (
          <p className="row-actions">
            <button className="button match-launch-ready" onClick={doLaunch}>启动比赛（模拟 GET5 已下发）</button>
          </p>
        )}
        {isAdmin && match.status === "live" && (
          <p className="row-actions">
            <button className="button secondary" onClick={doFinish}>结束比赛</button>
          </p>
        )}

        {match.status === "finished" && (
          <div className="grid grid-2">
            <div>
              <h4>A 队数据</h4>
              <table>
                <thead>
                  <tr>
                    <th>选手</th>
                    <th>K</th>
                    <th>D</th>
                    <th>A</th>
                    <th>ADR</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {teamAStats.map((s) => (
                    <tr key={s.userId}>
                      <td>
                        <div className="scoreboard-player">
                          <img className="avatar" src={s.avatarUrl} alt={`${s.nickname} avatar`} />
                          <span>{s.nickname}</span>
                        </div>
                      </td>
                      <td>{s.kills}</td>
                      <td>{s.deaths}</td>
                      <td>{s.assists}</td>
                      <td>{s.adr}</td>
                      <td>{s.rating.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4>B 队数据</h4>
              <table>
                <thead>
                  <tr>
                    <th>选手</th>
                    <th>K</th>
                    <th>D</th>
                    <th>A</th>
                    <th>ADR</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {teamBStats.map((s) => (
                    <tr key={s.userId}>
                      <td>
                        <div className="scoreboard-player">
                          <img className="avatar" src={s.avatarUrl} alt={`${s.nickname} avatar`} />
                          <span>{s.nickname}</span>
                        </div>
                      </td>
                      <td>{s.kills}</td>
                      <td>{s.deaths}</td>
                      <td>{s.assists}</td>
                      <td>{s.adr}</td>
                      <td>{s.rating.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {isAdmin && match.status === "captain_pick" && match.captainMode === "admin_assigned" && (
        <section className="panel">
          <h3>管理员指定队长</h3>
          <div className="grid grid-2">
            <label>
              队长 A
              <select value={capA} onChange={(e) => setCapA(Number(e.target.value))}>
                <option value={0}>请选择</option>
                {captainOptions.map((o) => (
                  <option value={o.value} key={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              队长 B
              <select value={capB} onChange={(e) => setCapB(Number(e.target.value))}>
                <option value={0}>请选择</option>
                {captainOptions.map((o) => (
                  <option value={o.value} key={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <p>
            <button className="button" onClick={doAssignCaptains}>确认队长</button>
          </p>
        </section>
      )}

      {match.status === "player_draft" && (
        <section className="panel">
          <h3>队长选人（ABBA 蛇形）</h3>
          <p>当前回合: {draftTurnTeam ? formatTeamName(draftTurnTeam) : "-"}</p>
          <p>剩余时间: {formatCountdown(countdownSeconds)}，超时后系统随机选人</p>
          <p className="muted">{"顺序: A -> B -> B -> A -> A -> B -> B -> A"}</p>
          <div className="pick-grid">
            {unassigned.map((p: MatchPlayer) => (
              <button
                key={p.userId}
                className="button secondary"
                disabled={!canDraft}
                onClick={() => run(() => draftPick(matchId, me!.id, p.userId))}
              >
                选择 {p.nickname}
              </button>
            ))}
          </div>
          {!canDraft && <p className="muted">仅当前回合的队长可选人。</p>}
        </section>
      )}

      {match.status === "map_veto" && (
        <section className="panel">
          <h3>BP 选图</h3>
          <p>当前回合: {vetoTurn ? `${formatTeamName(vetoTurn.team)}${formatVetoAction(vetoTurn.action)}` : "已完成"}</p>
          <p>剩余时间: {formatCountdown(countdownSeconds)}，超时后系统随机{formatVetoAction(vetoTurn?.action || "")}一张图</p>
          <div className="map-pool">
            {mapsPool.map((map) => (
              <button
                key={map}
                className="button secondary"
                disabled={!canVeto}
                onClick={() => run(() => vetoMap(matchId, me!.id, map))}
              >
                {formatVetoAction(vetoTurn?.action || "")} {formatMapName(map)}
              </button>
            ))}
          </div>
          {!canVeto && <p className="muted">仅当前回合队长可操作 BP。</p>}
          <h4>BP 轨迹</h4>
          <ul>
            {vetoSteps.map((s) => (
              <li key={`${s.order}-${s.map}`}>#{s.order} {formatTeamName(s.team)}{formatVetoAction(s.action)} {formatMapName(s.map)}</li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <section className="panel">
          <p className="muted">错误: {error}</p>
        </section>
      )}

      {showLoginModal && (
        <div className="logout-modal-backdrop" onClick={() => setShowLoginModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>登录后才能加入比赛房间</h3>
            <p className="muted">当前处于报名环节，请先完成 Steam 登录后再加入。</p>
            <p className="row-actions">
              <a className="button" href={steamLoginURL()}>Steam 登录</a>
              <button className="button secondary" onClick={() => setShowLoginModal(false)}>关闭</button>
            </p>
          </div>
        </div>
      )}

      {showForceStartModal && (
        <div className="logout-modal-backdrop" onClick={() => setShowForceStartModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认强制开启比赛</h3>
            <p className="muted">当前报名人数不足 10 人，系统会补足机器人到 10 人后立即进入下一流程。</p>
            <p className="row-actions">
              <button className="button secondary" onClick={() => setShowForceStartModal(false)}>取消</button>
              <button
                className="button"
                onClick={async () => {
                  setShowForceStartModal(false);
                  doForceStart();
                }}
              >
                确认强制开启
              </button>
            </p>
          </div>
        </div>
      )}

      {showCancelModal && (
        <div className="logout-modal-backdrop" onClick={() => setShowCancelModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认取消比赛</h3>
            <p className="muted">取消后该比赛会进入历史记录，无法继续报名、选人或开赛。</p>
            <p className="row-actions">
              <button className="button secondary" onClick={() => setShowCancelModal(false)}>返回</button>
              <button
                className="button"
                onClick={() => {
                  setShowCancelModal(false);
                  doCancel();
                }}
              >
                确认取消
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
