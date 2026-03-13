"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, CurrentUser, steamLoginURL } from "../../../lib/api";
import { MatchScoreboard, MatchScoreboardRow, MatchScoreboardTeamRole } from "../../../components/MatchScoreboard";
import { getGameServerConnectURL } from "../../../lib/gameServer";
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
  restartMatch,
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
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
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

function formatKD(kills: number, deaths: number): string {
  return `${kills}/${deaths}`;
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

function resolveTeamRoles(
  mapName: string,
  pickedMapDetails: Array<{ map: string; pickedByTeam?: "A" | "B"; startSide?: "T" }>,
): { A: MatchScoreboardTeamRole; B: MatchScoreboardTeamRole } {
  const detail = pickedMapDetails.find((item) => item.map === mapName);
  if (!detail?.pickedByTeam || !detail.startSide) {
    return { A: "neutral", B: "neutral" };
  }
  if (detail.pickedByTeam === "A") {
    return detail.startSide === "T" ? { A: "t", B: "ct" } : { A: "ct", B: "t" };
  }
  return detail.startSide === "T" ? { A: "ct", B: "t" } : { A: "t", B: "ct" };
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
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [launching, setLaunching] = useState(false);
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
  const liveStats = match?.liveStats ?? null;
  const lastGet5Job = match?.lastGet5Job ?? null;

  const mePlayer = useMemo(() => players.find((p) => p.userId === me?.id) || null, [players, me]);

  const teamA = useMemo(() => players.filter((p) => p.team === "A"), [players]);
  const teamB = useMemo(() => players.filter((p) => p.team === "B"), [players]);
  const captainA = useMemo(() => players.find((p) => p.isCaptain && p.team === "A") || null, [players]);
  const captainB = useMemo(() => players.find((p) => p.isCaptain && p.team === "B") || null, [players]);
  const teamALabel = captainA ? `${captainA.nickname} 的队伍` : "队伍A";
  const teamBLabel = captainB ? `${captainB.nickname} 的队伍` : "队伍B";
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
  const liveTeamAStats = useMemo(() => (liveStats?.players ?? []).filter((p) => p.team === "A"), [liveStats]);
  const liveTeamBStats = useMemo(() => (liveStats?.players ?? []).filter((p) => p.team === "B"), [liveStats]);
  const isFinishedScoreboard = match?.status === "finished";
  const teamAScoreboardRows = useMemo<MatchScoreboardRow[]>(
    () =>
      isFinishedScoreboard
        ? teamAStats.map((s) => ({
            key: `stat-${s.userId}`,
            nickname: s.nickname,
            avatarUrl: s.avatarUrl,
            kd: formatKD(s.kills, s.deaths),
            assists: String(s.assists),
            adr: String(s.adr),
            rating: s.rating.toFixed(2),
          }))
        : liveTeamAStats.length > 0
          ? liveTeamAStats.map((s) => ({
              key: `live-${s.steamId}`,
              nickname: s.nickname,
              avatarUrl: s.avatarUrl,
              kd: formatKD(s.kills, s.deaths),
              assists: String(s.assists),
              adr: String(s.adr),
              rating: s.rating.toFixed(2),
            }))
        : teamA.map((p) => ({
            key: `player-${p.userId}`,
            nickname: p.nickname,
            avatarUrl: p.avatarUrl,
            kd: "--/--",
            assists: "--",
            adr: "--",
            rating: "--",
          })),
    [isFinishedScoreboard, teamAStats, liveTeamAStats, teamA],
  );
  const teamBScoreboardRows = useMemo<MatchScoreboardRow[]>(
    () =>
      isFinishedScoreboard
        ? teamBStats.map((s) => ({
            key: `stat-${s.userId}`,
            nickname: s.nickname,
            avatarUrl: s.avatarUrl,
            kd: formatKD(s.kills, s.deaths),
            assists: String(s.assists),
            adr: String(s.adr),
            rating: s.rating.toFixed(2),
          }))
        : liveTeamBStats.length > 0
          ? liveTeamBStats.map((s) => ({
              key: `live-${s.steamId}`,
              nickname: s.nickname,
              avatarUrl: s.avatarUrl,
              kd: formatKD(s.kills, s.deaths),
              assists: String(s.assists),
              adr: String(s.adr),
              rating: s.rating.toFixed(2),
            }))
        : teamB.map((p) => ({
            key: `player-${p.userId}`,
            nickname: p.nickname,
            avatarUrl: p.avatarUrl,
            kd: "--/--",
            assists: "--",
            adr: "--",
            rating: "--",
          })),
    [isFinishedScoreboard, teamBStats, liveTeamBStats, teamB],
  );
  const scoreboardMapName = useMemo(() => {
    if (liveStats?.map) return liveStats.map;
    if (activeMapResult?.map) return activeMapResult.map;
    if (pickedMaps.length > 0) return pickedMaps[0];
    return "";
  }, [liveStats, activeMapResult, pickedMaps]);
  const teamRoles = useMemo(
    () => resolveTeamRoles(scoreboardMapName, pickedMapDetails),
    [scoreboardMapName, pickedMapDetails],
  );
  const scoreboardScore = useMemo(() => {
    if (liveStats && !isFinishedScoreboard) {
      return { a: String(liveStats.scoreA), b: String(liveStats.scoreB) };
    }
    return {
      a: match?.scoreA !== null && match?.scoreA !== undefined ? String(match.scoreA) : "-",
      b: match?.scoreB !== null && match?.scoreB !== undefined ? String(match.scoreB) : "-",
    };
  }, [liveStats, isFinishedScoreboard, match]);

  const draftTurnTeam = useMemo(() => {
    if (!match || match.status !== "player_draft") return null;
    return draftTurns[match.draftTurnIndex] || null;
  }, [match, draftTurns]);

  const draftSequence = useMemo(
    () =>
      draftTurns.map((team, index) => ({
        team,
        index,
        active: match?.status === "player_draft" && index === match.draftTurnIndex,
      })),
    [draftTurns, match],
  );

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

  const showEnterServer =
    !!mePlayer &&
    !!lastGet5Job &&
    lastGet5Job.status === "success" &&
    match?.status !== "cancelled";

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

  const doLaunch = async () => {
    if (!me || launching) return;
    setLaunching(true);
    setError("");
    try {
      const next = await launchMatch(matchId, me.id);
      setMatch(next);
      if (typeof window !== "undefined") {
        window.location.href = getGameServerConnectURL();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const doFinish = () => {
    if (!me) return;
    run(() => finishMatch(matchId, me.id));
  };

  const doRestart = async () => {
    if (!me || launching) return;
    setLaunching(true);
    setError("");
    try {
      const next = await restartMatch(matchId, me.id);
      setMatch(next);
      if (typeof window !== "undefined") {
        window.location.href = getGameServerConnectURL();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
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
        {liveStats && !isFinishedScoreboard && (
          <p>
            <strong>
              当前比分: A 队 {liveStats.scoreA} : {liveStats.scoreB} B 队
            </strong>
            {" | "}
            当前地图: {formatMapName(liveStats.map || "")}
            {" | "}
            当前回合: {liveStats.round}
          </p>
        )}
        {isRegistrationStage && (
          <>
            <h4>报名名单</h4>
            {players.length === 0 ? (
              <p className="muted">当前还没有玩家报名。</p>
            ) : (
              <ul className="player-list">
                {players.map((p) => (
                  <li key={p.userId}>
                    <div className="user-cell">
                      <img className="avatar avatar-square" src={p.avatarUrl} alt={`${p.nickname} avatar`} />
                      <span>{p.nickname}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {unassigned.length > 0 && match.status !== "gathering" && (
          <>
            <h4>未分队玩家</h4>
            <ul className="player-list">
              {unassigned.map((p) => (
                <li key={p.userId}>
                  <div className="user-cell">
                    <img className="avatar avatar-square" src={p.avatarUrl} alt={`${p.nickname} avatar`} />
                    <span>{p.nickname}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {(teamAScoreboardRows.length > 0 || teamBScoreboardRows.length > 0) && (
          <div className="match-scoreboard-stack">
            <MatchScoreboard
              teamALabel={teamALabel}
              teamBLabel={teamBLabel}
              scoreA={scoreboardScore.a}
              scoreB={scoreboardScore.b}
              teamARole={teamRoles.A}
              teamBRole={teamRoles.B}
              teamARows={teamAScoreboardRows}
              teamBRows={teamBScoreboardRows}
              tabs={
                match.status === "finished"
                  ? scoreTabs.map((tab) => ({
                      key: tab.key,
                      label: tab.key === "overall" ? "总数据" : formatMapName(tab.label),
                    }))
                  : []
              }
              activeTabKey={match.status === "finished" ? scoreTab : undefined}
              onTabChange={match.status === "finished" ? setScoreTab : undefined}
            />
          </div>
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
            <button className="button match-launch-ready" onClick={doLaunch} disabled={launching}>
              {launching ? "启动中..." : "启动比赛"}
            </button>
          </p>
        )}
        {isAdmin && match.status === "live" && (
          <p className="row-actions">
            <button className="button" onClick={() => setShowRestartModal(true)} disabled={launching}>重新开始比赛</button>
            <button className="button secondary" onClick={doFinish}>结束比赛</button>
            {showEnterServer && (
              <a className="button server-join-button" href={getGameServerConnectURL()}>
                进入服务器
              </a>
            )}
          </p>
        )}
        {isAdmin && match.status === "finished" && (
          <p className="row-actions">
            <button className="button" onClick={() => setShowRestartModal(true)} disabled={launching}>重新开始比赛</button>
            {showEnterServer && (
              <a className="button server-join-button" href={getGameServerConnectURL()}>
                进入服务器
              </a>
            )}
          </p>
        )}
        {!isAdmin && showEnterServer && (
          <p className="row-actions">
            <a className="button server-join-button" href={getGameServerConnectURL()}>
              进入服务器
            </a>
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="panel">
          <h3>最近一次 GET5 下发</h3>
          {!lastGet5Job ? (
            <p className="muted">当前还没有下发记录。比赛启动后会在这里显示 JSON 上传与加载结果。</p>
          ) : (
            <>
              <p>状态: <span className="status-pill">{lastGet5Job.status}</span></p>
              <p>配置文件: {lastGet5Job.configPath}</p>
              <p>下发时间: {formatTime(lastGet5Job.createdAt)}</p>
              {lastGet5Job.stdout ? (
                <>
                  <h4>Stdout</h4>
                  <pre className="log-box">{lastGet5Job.stdout}</pre>
                </>
              ) : null}
              {lastGet5Job.stderr ? (
                <>
                  <h4>Stderr</h4>
                  <pre className="log-box log-box-error">{lastGet5Job.stderr}</pre>
                </>
              ) : null}
            </>
          )}
        </section>
      )}

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
          {canDraft ? (
            <p className="draft-banner">
              现在轮到你为{formatTeamName(mePlayer!.team!)}选人，请从下方候选玩家中选择一位。
            </p>
          ) : (
            <p className="muted">当前未轮到你操作时，候选玩家会置灰锁定。</p>
          )}
          <div className="turn-sequence" aria-label="选人顺序">
            {draftSequence.map((step) => (
              <span key={`${step.team}-${step.index}`} className={`turn-chip ${step.active ? "turn-chip-active" : ""}`}>
                {step.index + 1}. {formatTeamName(step.team)}
              </span>
            ))}
          </div>
          <div className="pick-grid">
            {unassigned.map((p: MatchPlayer) => (
              <button
                key={p.userId}
                className={`button secondary draft-option ${canDraft ? "" : "draft-option-disabled"}`}
                disabled={!canDraft}
                onClick={() => run(() => draftPick(matchId, me!.id, p.userId))}
              >
                <img className="avatar avatar-square" src={p.avatarUrl} alt={`${p.nickname} avatar`} />
                <span>选择 {p.nickname}</span>
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
                className={`button secondary draft-option ${canVeto ? "" : "draft-option-disabled"}`}
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

      {showRestartModal && (
        <div className="logout-modal-backdrop" onClick={() => setShowRestartModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认重新开始比赛</h3>
            <p className="muted">系统会保留当前队长和 BP 结果，重新下发 GET5 并重启比赛。</p>
            <p className="muted">当前比分、KD 和历史赛果会全部清空。</p>
            <p className="row-actions">
              <button className="button secondary" onClick={() => setShowRestartModal(false)}>取消</button>
              <button
                className="button"
                onClick={() => {
                  setShowRestartModal(false);
                  doRestart();
                }}
              >
                确认重新开始
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
