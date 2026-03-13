"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type Row = {
  steamId: string;
  nickname: string;
  avatarUrl: string;
  totalWins: number;
  totalKd: number;
  totalKills: number;
  totalDeaths: number;
};

export default function LeaderboardPage() {
  const [sort, setSort] = useState<"total_wins" | "total_kd">("total_wins");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const load = async () => {
      const res = await apiFetch<{ items: Row[] }>(`/api/v1/leaderboard?sort=${sort}`);
      setRows(res.items);
    };
    load().catch(() => setRows([]));
  }, [sort]);

  return (
    <section className="panel">
      <h2>排行榜</h2>
      <p>
        <button className="button secondary" onClick={() => setSort("total_wins")}>
          按总胜场
        </button>{" "}
        <button className="button secondary" onClick={() => setSort("total_kd")}>
          按总KD
        </button>
      </p>
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>SteamID</th>
            <th>总胜场</th>
            <th>总KD</th>
            <th>总击杀</th>
            <th>总死亡</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.steamId}>
              <td>
                <div className="user-cell">
                  <img className="avatar avatar-square" src={r.avatarUrl} alt={`${r.nickname} avatar`} />
                  <span>{r.nickname}</span>
                </div>
              </td>
              <td>{r.steamId}</td>
              <td>{r.totalWins}</td>
              <td>{r.totalKd.toFixed(2)}</td>
              <td>{r.totalKills}</td>
              <td>{r.totalDeaths}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
