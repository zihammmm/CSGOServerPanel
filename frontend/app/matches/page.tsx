"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, CurrentUser, steamLoginURL } from "../../lib/api";
import { BoType, CaptainMode, MatchSummary, createMatch, listMatches } from "../../lib/matches";

type MatchesResponse = {
  active: MatchSummary | null;
  history: MatchSummary[];
};

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

function formatRole(role: CurrentUser["role"]): string {
  if (role === "super_admin") return "超级管理员";
  if (role === "admin") return "管理员";
  return "访客";
}

export default function MatchesPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [data, setData] = useState<MatchesResponse>({ active: null, history: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createBO, setCreateBO] = useState<BoType>(3);
  const [createCaptainMode, setCreateCaptainMode] = useState<CaptainMode>("admin_assigned");

  const isAdmin = useMemo(() => me?.role === "admin" || me?.role === "super_admin", [me]);

  const loadMe = async () => {
    try {
      const user = await apiFetch<CurrentUser>("/api/v1/me");
      setMe(user);
    } catch {
      setMe(null);
    }
  };

  const loadMatches = async () => {
    const res = await listMatches();
    setData(res);
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([loadMe(), loadMatches()]);
      } catch (e) {
        if (active) {
          setError(String(e));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const runCreate = async () => {
    if (!me || !isAdmin) return;
    setError("");
    try {
      await createMatch(
        { userId: me.id, steamId: me.steamId, nickname: me.nickname },
        createBO,
        createCaptainMode,
      );
      await loadMatches();
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) {
    return <section className="panel"><p className="muted">比赛数据加载中...</p></section>;
  }

  return (
    <div>
      <section className="panel">
        <h2>比赛中心</h2>
        {me ? (
          <p className="muted">当前用户: {me.nickname}（{formatRole(me.role)}）</p>
        ) : (
          <p>
            <a className="button" href={steamLoginURL()}>
              Steam 登录后可加入比赛
            </a>
          </p>
        )}
      </section>

      <section className="panel">
        <h3>当前比赛</h3>
        {!data.active ? (
          <p className="muted">暂无进行中的比赛</p>
        ) : (
          <div className="match-card">
            <p><strong>{data.active.title}</strong></p>
            <p>状态: <span className="status-pill">{statusText[data.active.status]}</span></p>
            <p>BO: BO{data.active.bo}</p>
            <p>队长策略: {data.active.captainMode === "admin_assigned" ? "管理员指定" : "随机"}</p>
            <p>人数: {data.active.playerCount}/10</p>
            <p>创建者: {data.active.creatorName}</p>
            <p>创建时间: {formatTime(data.active.createdAt)}</p>
            {data.active.scoreA !== null && data.active.scoreB !== null && (
              <p>比分: A 队 {data.active.scoreA} : {data.active.scoreB} B 队</p>
            )}
            <p className="action-row">
              <Link className="button" href={`/matches/${data.active.id}`}>查看详情</Link>
            </p>
          </div>
        )}
      </section>

      {isAdmin && !data.active && (
        <section className="panel">
          <h3>新建比赛（管理员）</h3>
          <div className="grid grid-2">
            <label>
              BO
              <select value={createBO} onChange={(e) => setCreateBO(Number(e.target.value) as BoType)}>
                <option value={1}>BO1</option>
                <option value={3}>BO3</option>
                <option value={5}>BO5</option>
              </select>
            </label>
            <label>
              队长策略
              <select value={createCaptainMode} onChange={(e) => setCreateCaptainMode(e.target.value as CaptainMode)}>
                <option value="admin_assigned">管理员指定</option>
                <option value="random">系统随机</option>
              </select>
            </label>
          </div>
          <p>
            <button className="button" onClick={runCreate}>创建比赛</button>
          </p>
        </section>
      )}

      <section className="panel">
        <h3>历史比赛</h3>
        {data.history.length === 0 ? (
          <p className="muted">暂无历史记录</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>标题</th>
                <th>状态</th>
                <th>BO</th>
                <th>比分</th>
                <th>人数</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{m.title}</td>
                  <td>{statusText[m.status]}</td>
                  <td>BO{m.bo}</td>
                  <td>{m.scoreA !== null && m.scoreB !== null ? `${m.scoreA}:${m.scoreB}` : "-"}</td>
                  <td>{m.playerCount}/10</td>
                  <td>{formatTime(m.createdAt)}</td>
                  <td>
                    <Link className="button secondary" href={`/matches/${m.id}`}>详情</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {error && (
        <section className="panel">
          <p className="muted">错误: {error}</p>
        </section>
      )}
    </div>
  );
}
