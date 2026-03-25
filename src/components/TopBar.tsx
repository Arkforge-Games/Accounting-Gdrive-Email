"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "@/lib/cn";
import { IconSearch } from "./icons";

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      router.push(`/dashboard/search?q=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <header className="h-16 border-b border-gray-200 bg-white flex items-center justify-between px-6 sticky top-0 z-20">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>

      <form onSubmit={handleSearch} className="relative w-80">
        <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className={`${cx.input} pl-9 py-1.5 text-sm`}
        />
      </form>
    </header>
  );
}
