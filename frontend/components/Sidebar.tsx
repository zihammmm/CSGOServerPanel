"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch, clearToken, CurrentUser, steamLoginURL } from "../lib/api";

const nav = [
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/matches", label: "比赛" },
  { href: "/leaderboard", label: "排行榜" },
  { href: "/settings", label: "个人设置" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingUser(true);
      try {
        const user = await apiFetch<CurrentUser>("/api/v1/me");
        if (active) setMe(user);
      } catch {
        if (active) setMe(null);
      } finally {
        if (active) setLoadingUser(false);
      }
    };

    load();

    const onFocus = () => {
      load();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [pathname]);

  const displayName = useMemo(() => {
    if (!me) return "";
    return me.steamName || me.nickname;
  }, [me]);

  const logout = () => {
    clearToken();
    if (typeof window !== "undefined") {
      sessionStorage.setItem("logout_notice", "1");
      window.location.href = "/dashboard";
    }
  };

  const roleText = me?.role === "super_admin" ? "超级管理员" : me?.role === "admin" ? "管理员" : "访客";

  return (
    <aside className="sidebar">
      <h1>CSGO Control Panel</h1>
      <div className="sidebar-nav">
        {nav.map((item) => (
          <Link
            key={item.href}
            className={`nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="sidebar-account">
        {me ? (
          <>
            <div className="sidebar-user-line">
              <img className="sidebar-avatar" src={me.avatarUrl} alt={`${displayName} avatar`} />
              <div>
                <p className="sidebar-name">{displayName}</p>
                <p className="sidebar-meta">{roleText}</p>
              </div>
            </div>
            <button className="button secondary sidebar-logout" onClick={logout}>
              退出登录
            </button>
          </>
        ) : loadingUser ? (
          <p className="sidebar-meta">正在检查登录状态...</p>
        ) : (
          <a className="button sidebar-login sidebar-login-bottom" href={steamLoginURL()}>
            Steam 登录
          </a>
        )}
      </div>
    </aside>
  );
}
