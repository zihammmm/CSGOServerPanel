"use client";

import { useEffect, useState } from "react";
import { apiFetch, CurrentUser } from "../../lib/api";

type AdminListResponse = {
  items: CurrentUser[];
};

export default function SettingsPage() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [nickname, setNickname] = useState("");
  const [msg, setMsg] = useState("");
  const [admins, setAdmins] = useState<CurrentUser[]>([]);
  const [adminSteamId, setAdminSteamId] = useState("");
  const [adminNickname, setAdminNickname] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const canManageAdmins = me?.role === "admin" || me?.role === "super_admin";
  const isSuperAdmin = me?.role === "super_admin";

  const load = async () => {
    const user = await apiFetch<CurrentUser>("/api/v1/me");
    setMe(user);
    setNickname(user.nickname);
    if (user.role === "admin" || user.role === "super_admin") {
      const res = await apiFetch<AdminListResponse>("/api/v1/admin/admins");
      setAdmins(res.items);
    } else {
      setAdmins([]);
    }
  };

  useEffect(() => {
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

  const addAdmin = async () => {
    setAdminMsg("");
    try {
      await apiFetch("/api/v1/admin/admins", {
        method: "POST",
        body: JSON.stringify({ steamId: adminSteamId, nickname: adminNickname }),
      });
      setAdminSteamId("");
      setAdminNickname("");
      setAdminMsg("管理员添加成功");
      await load();
    } catch (e) {
      setAdminMsg(`添加失败: ${String(e)}`);
    }
  };

  const removeAdmin = async (steamId: string) => {
    setAdminMsg("");
    try {
      await apiFetch(`/api/v1/admin/admins/${steamId}`, {
        method: "DELETE",
      });
      setAdminMsg("管理员已移除");
      await load();
    } catch (e) {
      setAdminMsg(`移除失败: ${String(e)}`);
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
      <div className="user-cell" style={{ marginBottom: "10px" }}>
        <img className="avatar avatar-square" src={me.avatarUrl} alt={`${me.nickname} avatar`} />
        <div>
          <p style={{ margin: 0 }}>{me.nickname}</p>
          <p className="muted" style={{ margin: "2px 0 0" }}>SteamID: {me.steamId}</p>
        </div>
      </div>
      <div style={{ marginTop: "18px" }}>
        <h3 style={{ margin: "0 0 10px" }}>游戏昵称</h3>
        <label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
      </div>
      <p>
        <button className="button" onClick={save}>
          保存昵称
        </button>
      </p>
      {msg && <p className="muted">{msg}</p>}

      {canManageAdmins && (
        <>
          <hr />
          <h3>管理员列表</h3>
          <div className="grid grid-2">
            <label>
              SteamID64
              <input value={adminSteamId} onChange={(e) => setAdminSteamId(e.target.value)} placeholder="7656119..." />
            </label>
            <label>
              昵称（可选）
              <input value={adminNickname} onChange={(e) => setAdminNickname(e.target.value)} placeholder="未填写则使用默认昵称" />
            </label>
          </div>
          <p>
            <button className="button secondary" onClick={addAdmin}>
              添加管理员
            </button>
          </p>
          {adminMsg && <p className="muted">{adminMsg}</p>}
          {admins.length === 0 ? (
            <p className="muted">当前没有管理员数据。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>角色</th>
                  <th>昵称</th>
                  <th>SteamID</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>{admin.id}</td>
                    <td>{admin.role === "super_admin" ? "超级管理员" : "管理员"}</td>
                    <td>
                      <div className="user-cell">
                        <img className="avatar avatar-square" src={admin.avatarUrl} alt={`${admin.nickname} avatar`} />
                        <span>{admin.nickname}</span>
                      </div>
                    </td>
                    <td>{admin.steamId}</td>
                    <td>
                      {isSuperAdmin && admin.role === "admin" ? (
                        <button className="button secondary" onClick={() => removeAdmin(admin.steamId)}>
                          移除
                        </button>
                      ) : (
                        <span className="muted">无权限</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
