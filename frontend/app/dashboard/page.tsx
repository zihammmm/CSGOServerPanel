"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, CurrentUser, steamLoginURL } from "../../lib/api";

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

export default function DashboardPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [live, setLive] = useState<MatchLive | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [mapName, setMapName] = useState("de_mirage");
  const [mode, setMode] = useState("competitive");
  const [kickPlayer, setKickPlayer] = useState("");
  const [kickReason, setKickReason] = useState("");
  const [error, setError] = useState("");

  const isAdmin = useMemo(() => me?.role === "admin", [me]);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("logout_notice") === "1") {
      setNotice("已退出登录");
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
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>DASHBOARD</h2>
        {notice && <p className="muted">{notice}</p>}
        {!me ? (
          <p>
            <a className="button" href={steamLoginURL()}>
              Steam 登录
            </a>
          </p>
        ) : (
          <p className="muted">
            当前用户: {me.steamName || me.nickname} ({me.role})
          </p>
        )}
        <p>
          <a className="button" href={`steam://rungameid/4465480//+connect ${gameAddr}`}>
            点击加入服务器
          </a>
        </p>
      </div>

      <div className="grid grid-2">
        <section className="panel">
          <h3>服务器状态</h3>
          <p>运行状态: {status?.running ? "运行中" : "离线"}</p>
          <p>地图: {status?.map || "unknown"}</p>
          <p>模式: {status?.mode || "unknown"}</p>
          <p>
            玩家数: {status?.players ?? 0}/{status?.maxPlayers ?? 32}
          </p>
        </section>

        <section className="panel">
          <h3>当前对局比分</h3>
          <p>CT: {live?.scoreCt ?? 0}</p>
          <p>T: {live?.scoreT ?? 0}</p>
          <p className="muted">更新时间: {live?.updatedAt || "-"}</p>
        </section>
      </div>

      <section className="panel">
        <h3>对局玩家数据</h3>
        <table>
          <thead>
            <tr>
              <th>玩家ID</th>
              <th>昵称</th>
              <th>K</th>
              <th>D</th>
              <th>KD</th>
              <th>队伍</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isAdmin && (
        <>
          <section className="panel">
            <h3>管理员操作</h3>
            <div className="grid grid-2">
              <div>
                <h4>踢人</h4>
                <input placeholder="player id" value={kickPlayer} onChange={(e) => setKickPlayer(e.target.value)} />
                <input placeholder="reason" value={kickReason} onChange={(e) => setKickReason(e.target.value)} />
                <p>
                  <button
                    className="button danger"
                    onClick={() => runAdminAction("/api/v1/admin/rcon/kick", { player: kickPlayer, reason: kickReason })}
                  >
                    执行踢人
                  </button>
                </p>
              </div>
              <div>
                <h4>切换地图 / 模式</h4>
                <input placeholder="de_mirage" value={mapName} onChange={(e) => setMapName(e.target.value)} />
                <p>
                  <button className="button secondary" onClick={() => runAdminAction("/api/v1/admin/rcon/change-map", { map: mapName })}>
                    切换地图
                  </button>
                </p>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="competitive">competitive</option>
                  <option value="casual">casual</option>
                  <option value="deathmatch">deathmatch</option>
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
                    <td>{a.createdAt}</td>
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
    </div>
  );
}
