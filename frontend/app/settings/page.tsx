"use client";

import { useEffect, useState } from "react";
import { apiFetch, CurrentUser } from "../../lib/api";

export default function SettingsPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [nickname, setNickname] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const load = async () => {
      const user = await apiFetch<CurrentUser>("/api/v1/me");
      setMe(user);
      setNickname(user.nickname);
    };
    load().catch(() => setMe(null));
  }, []);

  const save = async () => {
    setMsg("");
    try {
      await apiFetch("/api/v1/me/nickname", {
        method: "PATCH",
        body: JSON.stringify({ nickname }),
      });
      setMsg("保存成功");
    } catch (e) {
      setMsg(`保存失败: ${String(e)}`);
    }
  };

  if (!me) {
    return (
      <section className="panel">
        <h2>个人设置</h2>
        <p className="muted">请先在 Dashboard 页面登录 Steam。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>个人设置</h2>
      <p className="muted">SteamID: {me.steamId}</p>
      <label>
        游戏昵称
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </label>
      <p>
        <button className="button" onClick={save}>
          保存昵称
        </button>
      </p>
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}
