"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, CurrentUser, steamLoginURL } from "../../../lib/api";
import {
  MatchDetail,
  MatchPlayer,
  assignCaptains,
  draftPick,
  finishMatch,
  forceStartMatch,
  getMatchDetail,
  joinMatch,
  launchMatch,
  vetoMap,
} from "../../../lib/matches";

const statusText: Record<string, string> = {
  created: "已创建",
  gathering: "招募中",
  captain_pick: "指定队长",
  player_draft: "队长选人",
  map_veto: "BP 选图",
  ready_to_start: "待启动",
  live: "进行中",
  finished: "已结束",
  cancelled: "已取消",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
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

  const isAdmin = useMemo(() => me?.role === "admin", [me]);
  const mePlayer = useMemo(() => match?.players.find((p) => p.userId === me?.id) || null, [match, me]);

  const teamA = useMemo(() => (match?.players || []).filter((p) => p.team === "A"), [match]);
  const teamB = useMemo(() => (match?.players || []).filter((p) => p.team === "B"), [match]);
  const scoreTabs = useMemo(() => {
    if (!match || match.status !== "finished") return [];
    return [
      { key: "overall", label: "总数据" },
      ...match.mapResults.map((m) => ({ key: m.key, label: m.map })),
    ];
  }, [match]);

  const activeMapResult = useMemo(() => {
    if (!match || match.status !== "finished" || scoreTab === "overall") return null;
    return match.mapResults.find((m) => m.key === scoreTab) || null;
  }, [match, scoreTab]);

  const activePlayerStats = useMemo(() => {
    if (!match || match.status !== "finished") return [];
    return activeMapResult ? activeMapResult.playerStats : match.playerStats;
  }, [match, activeMapResult]);

  const teamAStats = useMemo(() => activePlayerStats.filter((s) => s.team === "A"), [activePlayerStats]);
  const teamBStats = useMemo(() => activePlayerStats.filter((s) => s.team === "B"), [activePlayerStats]);
  const unassigned = useMemo(() => (match?.players || []).filter((p) => !p.team && !p.isCaptain), [match]);

  const draftTurnTeam = useMemo(() => {
    if (!match || match.status !== "player_draft") return null;
    return match.draftTurns[match.draftTurnIndex] || null;
  }, [match]);

  const vetoTurn = useMemo(() => {
    if (!match || match.status !== "map_veto") return null;
    return match.vetoScript[match.vetoTurnIndex] || null;
  }, [match]);

  const canJoin = !!match && match.status === "gathering" && !!me && !mePlayer;

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
    if (!me) return;
    run(() => joinMatch(matchId, { userId: me.id, steamId: me.steamId, nickname: me.nickname }));
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

  const doForceStart = () => {
    if (!me) return;
    run(() => forceStartMatch(matchId, me.id, me.role));
  };

  const captainOptions = (match?.players || []).map((p) => ({ label: `${p.nickname} (${p.steamId})`, value: p.userId }));

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
        <p>BO: BO{match.bo} | 队长策略: {match.captainMode === "admin_assigned" ? "管理员指定" : "随机"}</p>
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
      </section>

      {!me && (
        <section className="panel">
          <p>
            <a className="button" href={steamLoginURL()}>Steam 登录后可加入比赛房间</a>
          </p>
        </section>
      )}

      <section className="panel">
        <h3>比分板</h3>
        <p>当前人数: {match.players.length}/10</p>
        <p>比赛地图: {match.pickedMaps.join(" / ") || "-"}</p>
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
                {activeMapResult ? `${activeMapResult.map} 比分` : "总比分"}: Team A{" "}
                {activeMapResult ? activeMapResult.scoreA : (match.scoreA ?? "-")} :{" "}
                {activeMapResult ? activeMapResult.scoreB : (match.scoreB ?? "-")} Team B
              </strong>
            </p>
          </>
        )}
        {match.status !== "finished" && (
          <div className="grid grid-2">
            <div>
              <h4>Team A</h4>
              <ul>
                {teamA.map((p) => (
                  <li key={p.userId}>{p.nickname} {p.isCaptain ? "(队长)" : ""}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Team B</h4>
              <ul>
                {teamB.map((p) => (
                  <li key={p.userId}>{p.nickname} {p.isCaptain ? "(队长)" : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {match.status !== "finished" && (
          <>
            <h4>未分队玩家</h4>
            <ul>
              {unassigned.map((p) => (
                <li key={p.userId}>{p.nickname}</li>
              ))}
            </ul>
          </>
        )}

        {match.status === "gathering" && me && (
          <p className="row-actions">
            <button className="button" disabled={!canJoin} onClick={doJoin}>加入房间</button>
            {isAdmin && (
              <button className="button secondary" onClick={doForceStart}>强制开始（未满10人）</button>
            )}
          </p>
        )}
        {isAdmin && match.status === "ready_to_start" && (
          <p className="row-actions">
            <button className="button secondary" onClick={doLaunch}>启动比赛（模拟 GET5 已下发）</button>
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
              <h4>Team A 数据</h4>
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
              <h4>Team B 数据</h4>
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
          <p>当前回合: {draftTurnTeam ? `Team ${draftTurnTeam}` : "-"}</p>
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
          <p>当前回合: {vetoTurn ? `Team ${vetoTurn.team} ${vetoTurn.action === "ban" ? "Ban" : "Pick"}` : "已完成"}</p>
          <div className="map-pool">
            {match.mapsPool.map((map) => (
              <button
                key={map}
                className="button secondary"
                disabled={!canVeto}
                onClick={() => run(() => vetoMap(matchId, me!.id, map))}
              >
                {vetoTurn?.action === "ban" ? "Ban" : "Pick"} {map}
              </button>
            ))}
          </div>
          {!canVeto && <p className="muted">仅当前回合队长可操作 BP。</p>}
          <h4>BP 轨迹</h4>
          <ul>
            {match.vetoSteps.map((s) => (
              <li key={`${s.order}-${s.map}`}>#{s.order} Team {s.team} {s.action.toUpperCase()} {s.map}</li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <section className="panel">
          <p className="muted">错误: {error}</p>
        </section>
      )}
    </div>
  );
}
