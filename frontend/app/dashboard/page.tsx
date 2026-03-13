"use client";

import { useEffect, useMemo, useState } from "react";
import { MatchScoreboard, MatchScoreboardRow, MatchScoreboardTeamRole } from "../../components/MatchScoreboard";
import { apiFetch, CurrentUser } from "../../lib/api";
import { getGameServerConnectURL } from "../../lib/gameServer";
import { getMatchDetail, listMatches, MatchDetail } from "../../lib/matches";

type ServerStatus = {
  running: boolean;
  map: string;
  mode: string;
  players: number;
  maxPlayers: number;
  updatedAt: string;
};

type ServerLivePlayer = {
  playerId: string;
  steamId: string;
  name: string;
  avatarUrl: string;
  connectedSeconds: number;
};

type ServerLive = {
  scoreCt: number;
  scoreT: number;
  updatedAt: string;
  players: ServerLivePlayer[];
};

type AuditItem = {
  id: number;
  action: string;
  target: string;
  result: string;
  error: string;
  admin: string;
  createdAt: string;
};

const officialMapPool = [
  { value: "de_mirage", label: "荒漠迷城" },
  { value: "de_inferno", label: "炼狱小镇" },
  { value: "de_anubis", label: "阿努比斯" },
  { value: "de_ancient", label: "远古遗迹" },
  { value: "de_nuke", label: "核子危机" },
  { value: "de_dust2", label: "炙热沙城 II" },
  { value: "de_train", label: "列车停放站" },
] as const;
const modeOptions = [
  { value: "competitive", label: "竞技模式" },
  { value: "casual", label: "休闲模式" },
  { value: "deathmatch", label: "死斗模式" },
] as const;

function formatMapName(map: string): string {
  return officialMapPool.find((item) => item.value === map)?.label || map || "未知地图";
}

function formatModeName(mode: string): string {
  return modeOptions.find((item) => item.value === mode)?.label || mode || "未知模式";
}

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

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(safe / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export default function DashboardPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [actionModal, setActionModal] = useState<{ title: string; message: string } | null>(null);
  const [kickModal, setKickModal] = useState<{ playerId: string; playerName: string } | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [serverLive, setServerLive] = useState<ServerLive | null>(null);
  const [activeMatch, setActiveMatch] = useState<MatchDetail | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [mapName, setMapName] = useState("de_mirage");
  const [mode, setMode] = useState("competitive");
  const [kickReason, setKickReason] = useState("");
  const [error, setError] = useState("");

  const isAdmin = useMemo(() => me?.role === "admin" || me?.role === "super_admin", [me]);
  const hasLivePlayers = !!activeMatch?.liveStats?.players?.length;
  const activeTeamA = useMemo(() => (activeMatch?.players ?? []).filter((p) => p.team === "A"), [activeMatch]);
  const activeTeamB = useMemo(() => (activeMatch?.players ?? []).filter((p) => p.team === "B"), [activeMatch]);
  const activeCaptainA = useMemo(() => (activeMatch?.players ?? []).find((p) => p.isCaptain && p.team === "A") || null, [activeMatch]);
  const activeCaptainB = useMemo(() => (activeMatch?.players ?? []).find((p) => p.isCaptain && p.team === "B") || null, [activeMatch]);
  const activeTeamALabel = activeCaptainA ? `${activeCaptainA.nickname} 的队伍` : "队伍A";
  const activeTeamBLabel = activeCaptainB ? `${activeCaptainB.nickname} 的队伍` : "队伍B";
  const activeRoles = useMemo(() => {
    const mapName = activeMatch?.liveStats?.map || activeMatch?.pickedMaps?.[0] || "";
    const detail = (activeMatch?.pickedMapDetails ?? []).find((item) => item.map === mapName);
    if (!detail?.pickedByTeam || !detail.startSide) {
      return { A: "neutral" as MatchScoreboardTeamRole, B: "neutral" as MatchScoreboardTeamRole };
    }
    if (detail.pickedByTeam === "A") {
      return detail.startSide === "T"
        ? { A: "t" as MatchScoreboardTeamRole, B: "ct" as MatchScoreboardTeamRole }
        : { A: "ct" as MatchScoreboardTeamRole, B: "t" as MatchScoreboardTeamRole };
    }
    return detail.startSide === "T"
      ? { A: "ct" as MatchScoreboardTeamRole, B: "t" as MatchScoreboardTeamRole }
      : { A: "t" as MatchScoreboardTeamRole, B: "ct" as MatchScoreboardTeamRole };
  }, [activeMatch]);
  const activeTeamARows = useMemo<MatchScoreboardRow[]>(
    () =>
      activeMatch?.liveStats?.players
        ?.filter((p) => p.team === "A")
        .map((p) => ({
          key: `live-${p.steamId}`,
          nickname: p.nickname,
          avatarUrl: p.avatarUrl,
          kd: `${p.kills}/${p.deaths}`,
          assists: String(p.assists),
          adr: String(p.adr),
          rating: p.rating.toFixed(2),
        })) ?? activeTeamA.map((p) => ({
        key: `player-${p.userId}`,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl,
        kd: "--/--",
        assists: "--",
        adr: "--",
        rating: "--",
      })),
    [activeMatch, activeTeamA],
  );
  const activeTeamBRows = useMemo<MatchScoreboardRow[]>(
    () =>
      activeMatch?.liveStats?.players
        ?.filter((p) => p.team === "B")
        .map((p) => ({
          key: `live-${p.steamId}`,
          nickname: p.nickname,
          avatarUrl: p.avatarUrl,
          kd: `${p.kills}/${p.deaths}`,
          assists: String(p.assists),
          adr: String(p.adr),
          rating: p.rating.toFixed(2),
        })) ?? activeTeamB.map((p) => ({
        key: `player-${p.userId}`,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl,
        kd: "--/--",
        assists: "--",
        adr: "--",
        rating: "--",
      })),
    [activeMatch, activeTeamB],
  );

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("logout_notice") === "1") {
      setShowLogoutModal(true);
      sessionStorage.removeItem("logout_notice");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const user = await apiFetch<CurrentUser>("/api/v1/me");
        if (active) setMe(user);
      } catch {
        if (active) setMe(null);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const [s, serverPlayers, matches] = await Promise.all([
          apiFetch<ServerStatus>("/api/v1/dashboard/server-status"),
          apiFetch<ServerLive>("/api/v1/dashboard/match-live"),
          listMatches(),
        ]);
        const detail = matches.active ? await getMatchDetail(matches.active.id) : null;
        if (!active) return;
        setStatus(s);
        setServerLive(serverPlayers);
        setActiveMatch(detail);
      } catch (e) {
        if (!active) return;
        setError(String(e));
      }
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const load = async () => {
      try {
        const res = await apiFetch<{ items: AuditItem[] }>("/api/v1/admin/audit-logs");
        if (active) setAudit(res.items);
      } catch {
        if (active) setAudit([]);
      }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isAdmin]);

  const runAdminAction = async (path: string, body: object) => {
    setError("");
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      const res = await apiFetch<{ items: AuditItem[] }>("/api/v1/admin/audit-logs");
      setAudit(res.items);
      if (path === "/api/v1/admin/rcon/change-map") {
        setActionModal({ title: "切换地图成功", message: `地图已切换为 ${formatMapName((body as { map?: string }).map || "")}。` });
      } else if (path === "/api/v1/admin/rcon/change-mode") {
        setActionModal({ title: "切换模式成功", message: `模式已切换为 ${formatModeName((body as { mode?: string }).mode || "")}。` });
      } else if (path === "/api/v1/admin/rcon/kick") {
        const target = (body as { player?: string }).player || "";
        setActionModal({ title: "踢人成功", message: `玩家 ${target} 已被踢出服务器。` });
      }
    } catch (e) {
      const message = String(e);
      setError(message);
      if (path === "/api/v1/admin/rcon/change-map") {
        setActionModal({ title: "切换地图失败", message });
      } else if (path === "/api/v1/admin/rcon/change-mode") {
        setActionModal({ title: "切换模式失败", message });
      } else if (path === "/api/v1/admin/rcon/kick") {
        setActionModal({ title: "踢人失败", message });
      }
    }
  };

  const confirmKick = async () => {
    if (!kickModal) return;
    await runAdminAction("/api/v1/admin/rcon/kick", {
      player: kickModal.playerId,
      reason: kickReason,
    });
    setKickModal(null);
    setKickReason("");
  };

  return (
    <div>
      <div className="panel">
        <h2>DASHBOARD</h2>
      </div>

      <div className="grid grid-2">
        <section className="panel dashboard-top-panel">
          <h3>服务器状态</h3>
          <p>
            运行状态:{" "}
            <span className={`status-pill ${status?.running ? "status-online" : "status-offline"}`}>
              {status?.running ? "运行中" : "离线"}
            </span>
          </p>
          <p>地图: {formatMapName(status?.map || "")}</p>
          <p>模式: {formatModeName(status?.mode || "")}</p>
          <p>
            玩家数: {status?.players ?? 0}/{status?.maxPlayers ?? 32}
          </p>
          <p className="server-join-wrap">
            <a className="button server-join-button" href={getGameServerConnectURL()}>
              点击加入服务器
            </a>
          </p>
        </section>
        <section className="panel dashboard-top-panel">
          <h3>当前服务器玩家</h3>
          <p className="muted">更新时间: {serverLive?.updatedAt ? formatTime(serverLive.updatedAt) : "-"}</p>
          <div className="server-player-list">
            {(serverLive?.players ?? []).length === 0 ? (
              <p className="muted">当前服务器内没有玩家。</p>
            ) : (
              (serverLive?.players ?? []).map((player) => (
                <div key={player.steamId || player.playerId} className="server-player-row">
                  <div className="user-cell">
                    <img className="avatar avatar-square" src={player.avatarUrl} alt={`${player.name} avatar`} />
                    <span>{player.name}</span>
                  </div>
                  <span className="muted">{formatDuration(player.connectedSeconds)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {hasLivePlayers && (
        <section className="panel">
          <MatchScoreboard
            title="当前对局"
            teamALabel={activeTeamALabel}
            teamBLabel={activeTeamBLabel}
            scoreA={String(activeMatch?.liveStats?.scoreA ?? 0)}
            scoreB={String(activeMatch?.liveStats?.scoreB ?? 0)}
            teamARole={activeRoles.A}
            teamBRole={activeRoles.B}
            teamARows={activeTeamARows}
            teamBRows={activeTeamBRows}
          />
          <p className="muted">更新时间: {activeMatch?.liveStats?.updatedAt ? formatTime(activeMatch.liveStats.updatedAt) : "-"}</p>
        </section>
      )}

      {isAdmin && (
        <>
          <section className="panel">
            <h3>管理员操作</h3>
            <div className="grid grid-2">
              <div>
                <h4>切换地图 / 模式</h4>
                <select value={mapName} onChange={(e) => setMapName(e.target.value)}>
                  {officialMapPool.map((map) => (
                    <option key={map.value} value={map.value}>
                      {map.label}
                    </option>
                  ))}
                </select>
                <p>
                  <button className="button secondary" onClick={() => runAdminAction("/api/v1/admin/rcon/change-map", { map: mapName })}>
                    切换地图
                  </button>
                </p>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {modeOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p>
                  <button className="button secondary" onClick={() => runAdminAction("/api/v1/admin/rcon/change-mode", { mode })}>
                    切换模式
                  </button>
                </p>
              </div>
            </div>
            {error && <p className="muted">错误: {error}</p>}
          </section>

          <section className="panel">
            <h3>RCON 审计日志</h3>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>管理员</th>
                  <th>动作</th>
                  <th>目标</th>
                  <th>结果</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{formatTime(a.createdAt)}</td>
                    <td>{a.admin}</td>
                    <td>{a.action}</td>
                    <td>{a.target}</td>
                    <td>{a.result}</td>
                    <td>{a.error || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      {showLogoutModal && (
        <div className="logout-modal-backdrop" onClick={() => setShowLogoutModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>已退出登录</h3>
            <p className="muted">当前会话已清除。</p>
            <button className="button" onClick={() => setShowLogoutModal(false)}>
              确定
            </button>
          </div>
        </div>
      )}
      {actionModal && (
        <div className="logout-modal-backdrop" onClick={() => setActionModal(null)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{actionModal.title}</h3>
            <p className="muted">{actionModal.message}</p>
            <button className="button" onClick={() => setActionModal(null)}>
              确定
            </button>
          </div>
        </div>
      )}
      {kickModal && (
        <div className="logout-modal-backdrop" onClick={() => setKickModal(null)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认踢出玩家</h3>
            <p className="muted">玩家：{kickModal.playerName}（{kickModal.playerId}）</p>
            <label>
              理由
              <input value={kickReason} onChange={(e) => setKickReason(e.target.value)} placeholder="请输入踢人理由" />
            </label>
            <p className="row-actions">
              <button className="button secondary" onClick={() => setKickModal(null)}>
                取消
              </button>
              <button className="button danger" onClick={confirmKick}>
                确认踢人
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
