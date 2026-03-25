"use client";

import { cx } from "@/lib/cn";

export function StatCard({
  label,
  value,
  change,
  icon,
  color = "blue",
}: {
  label: string;
  value: string | number;
  change?: string;
  icon: React.ReactNode;
  color?: "blue" | "green" | "purple" | "red" | "yellow";
}) {
  const bgMap = {
    blue: "bg-blue-50",
    green: "bg-green-50",
    purple: "bg-purple-50",
    red: "bg-red-50",
    yellow: "bg-yellow-50",
  };
  const textMap = {
    blue: "text-blue-600",
    green: "text-green-600",
    purple: "text-purple-600",
    red: "text-red-600",
    yellow: "text-yellow-600",
  };

  return (
    <div className={cx.statCard}>
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 ${bgMap[color]} rounded-lg flex items-center justify-center ${textMap[color]}`}>
          {icon}
        </div>
        {change && (
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            {change}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  );
}
