"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, CurrentUser } from "../../lib/api";

type ServerStatus = {
  running: boolean;
  map: string;
  mode: string;
  players: number;
  maxPlayers: number;
  updatedAt: string;
};

type MatchLive = {
  scoreCt: number;
  scoreT: number;
  updatedAt: string;
  players: Array<{
    playerId: string;
    name: string;
    kills: number;
    deaths: number;
    kd: number;
    team: string;
  }>;
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

const gameAddr = process.env.NEXT_PUBLIC_GAME_SERVER_ADDRESS || "127.0.0.1:27015";
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

export default function DashboardPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [actionModal, setActionModal] = useState<{ title: string; message: string } | null>(null);
  const [kickModal, setKickModal] = useState<{ playerId: string; playerName: string } | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [live, setLive] = useState<MatchLive | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [mapName, setMapName] = useState("de_mirage");
  const [mode, setMode] = useState("competitive");
  const [kickReason, setKickReason] = useState("");
  const [error, setError] = useState("");

  const isAdmin = useMemo(() => me?.role === "admin" || me?.role === "super_admin", [me]);
  const hasLivePlayers = (status?.players ?? 0) > 0;

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
        const [s, l] = await Promise.all([
          apiFetch<ServerStatus>("/api/v1/dashboard/server-status"),
          apiFetch<MatchLive>("/api/v1/dashboard/match-live"),
        ]);
        if (!active) return;
        setStatus(s);
        setLive(l);
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
        <section className="panel">
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
            <a className="button server-join-button" href={`steam://rungameid/4465480//+connect ${gameAddr}`}>
              点击加入服务器
            </a>
          </p>
        </section>
      </div>

      {hasLivePlayers && (
        <section className="panel">
          <h3>当前对局</h3>
          <div style={{ textAlign: "center", marginBottom: "1rem" }}>
            <p><strong>CT: {live?.scoreCt ?? 0} : {live?.scoreT ?? 0} T</strong></p>
            <p className="muted">更新时间: {live?.updatedAt ? formatTime(live.updatedAt) : "-"}</p>
          </div>
          <h4>对局玩家数据</h4>
          <table>
            <thead>
              <tr>
                <th>玩家ID</th>
                <th>昵称</th>
                <th>K</th>
                <th>D</th>
                <th>KD</th>
                <th>队伍</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {(live?.players || []).map((p) => (
                <tr key={p.playerId}>
                  <td>{p.playerId}</td>
                  <td>{p.name}</td>
                  <td>{p.kills}</td>
                  <td>{p.deaths}</td>
                  <td>{p.kd.toFixed(2)}</td>
                  <td>{p.team}</td>
                  {isAdmin && (
                    <td>
                      <button
                        className="button danger"
                        onClick={() => {
                          setKickModal({ playerId: p.playerId, playerName: p.name });
                          setKickReason("");
                        }}
                      >
                        踢人
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
