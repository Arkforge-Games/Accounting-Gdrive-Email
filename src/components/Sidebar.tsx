"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cn";
import {
  IconDashboard,
  IconFiles,
  IconStar,
  IconSearch,
  IconActivity,
  IconSettings,
  IconSync,
  IconMail,
  IconDrive,
  IconAccounting,
  IconXero,
  IconWise,
} from "./icons";

function IconChat({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  );
}

const links = [
  { href: "/dashboard", label: "Overview", icon: IconDashboard },
  { href: "/dashboard/chat", label: "AI Assistant", icon: IconChat },
  { href: "/dashboard/accounting", label: "Accounting Index", icon: IconAccounting },
  { href: "/dashboard/xero", label: "Xero", icon: IconXero },
  { href: "/dashboard/wise", label: "Wise", icon: IconWise },
  { href: "/dashboard/emails", label: "Emails", icon: IconMail },
  { href: "/dashboard/files", label: "Attachments", icon: IconFiles },
  { href: "/dashboard/drive", label: "Google Drive", icon: IconDrive },
  { href: "/dashboard/starred", label: "Starred", icon: IconStar },
  { href: "/dashboard/search", label: "Search", icon: IconSearch },
  { href: "/dashboard/activity", label: "Activity", icon: IconActivity },
  { href: "/dashboard/settings", label: "Settings", icon: IconSettings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-white border-r border-gray-200 flex flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 h-16 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          A
        </div>
        <div>
          <div className="font-bold text-sm">AccountSync</div>
          <div className="text-[10px] text-gray-400">GDrive & Email</div>
        </div>
      </div>

      {/* Sync Button */}
      <div className="px-3 pt-4 pb-2">
        <button
          onClick={() => fetch("/api/sync", { method: "POST" }).then(() => window.location.reload())}
          className={`${cx.btnPrimary} w-full justify-center`}
        >
          <IconSync className="w-4 h-4" />
          Sync All
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? cx.sidebarLinkActive : `${cx.sidebarLink} text-gray-600 hover:bg-gray-100`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-xs font-bold">
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">User</div>
            <div className="text-xs text-gray-400 truncate">user@example.com</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
