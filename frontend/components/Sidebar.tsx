"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearToken } from "../lib/api";

const nav = [
  { href: "/dashboard", label: "DASHBOARD" },
  { href: "/matches", label: "比赛" },
  { href: "/leaderboard", label: "排行榜" },
  { href: "/settings", label: "个人设置" },
];

export function Sidebar() {
  const pathname = usePathname();

  const logout = () => {
    clearToken();
    if (typeof window !== "undefined") {
      sessionStorage.setItem("logout_notice", "1");
      window.location.href = "/dashboard";
    }
  };

  return (
    <aside className="sidebar">
      <h1>CSGO Control Panel</h1>
      {nav.map((item) => (
        <Link
          key={item.href}
          className={`nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}
          href={item.href}
        >
          {item.label}
        </Link>
      ))}
      <button className="button secondary sidebar-logout" onClick={logout}>
        退出登录
      </button>
    </aside>
  );
}
