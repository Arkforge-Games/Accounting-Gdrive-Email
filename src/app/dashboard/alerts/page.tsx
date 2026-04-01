"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";

interface AlertItem {
  type: "overdue" | "duplicate" | "missing" | "uncategorized" | "reimbursement";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  items: Record<string, unknown>[];
}

const severityConfig = {
  high: {
    bg: "bg-red-50",
    border: "border-red-200",
    badge: "bg-red-100 text-red-700",
    icon: "bg-red-100 text-red-600",
    label: "High",
  },
  medium: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-700",
    icon: "bg-amber-100 text-amber-600",
    label: "Medium",
  },
  low: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    badge: "bg-blue-100 text-blue-700",
    icon: "bg-blue-100 text-blue-600",
    label: "Low",
  },
};

const typeLabels: Record<string, string> = {
  overdue: "Overdue",
  duplicate: "Duplicate",
  missing: "Missing Period",
  uncategorized: "Uncategorized",
  reimbursement: "Reimbursement",
};

function AlertCard({ alert }: { alert: AlertItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = severityConfig[alert.severity];

  return (
    <div className={`${cx.card} ${config.bg} ${config.border} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${cx.badge} ${config.badge}`}>
              {config.label}
            </span>
            <span className={`${cx.badge} bg-gray-100 text-gray-600`}>
              {typeLabels[alert.type] || alert.type}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mt-2">
            {alert.title}
          </h3>
          <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
          <p className="text-xs text-gray-400 mt-2">
            {alert.items.length} affected item{alert.items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`${cx.btnSecondary} text-xs shrink-0`}
        >
          {expanded ? "Hide" : "View"} Details
        </button>
      </div>

      {expanded && alert.items.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className="max-h-60 overflow-y-auto space-y-2">
            {alert.items.map((item, i) => (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-lg p-3 text-xs"
              >
                {alert.type === "overdue" && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">
                        {(item as Record<string, unknown>).invoiceNumber as string}
                      </span>
                      <span className="text-gray-500 ml-2">
                        {(item as Record<string, unknown>).contact as string}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-red-600">
                        {(item as Record<string, unknown>).currency as string}{" "}
                        {String((item as Record<string, unknown>).total)}
                      </span>
                      <span className="text-gray-400 ml-2">
                        Due: {(item as Record<string, unknown>).dueDate as string}
                      </span>
                    </div>
                  </div>
                )}
                {alert.type === "uncategorized" && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 truncate">
                      {(item as Record<string, unknown>).name as string}
                    </span>
                    <span className="font-medium text-orange-600 ml-2">
                      {(item as Record<string, unknown>).currency as string}{" "}
                      {(item as Record<string, unknown>).amount as string}
                    </span>
                  </div>
                )}
                {alert.type === "duplicate" && (
                  <div className="space-y-1">
                    {["file1", "file2"].map((key) => {
                      const f = (item as Record<string, Record<string, unknown>>)[key];
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <span className="text-gray-900 truncate">{f.name as string}</span>
                          <span className="text-gray-500 ml-2 shrink-0">
                            {f.vendor as string} &middot; {f.amount as string} &middot; {f.date as string}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {alert.type === "missing" && (
                  <span className="font-medium text-gray-900">
                    {(item as Record<string, unknown>).label as string}
                  </span>
                )}
                {alert.type === "reimbursement" && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 truncate">
                      {(item as Record<string, unknown>).name as string}
                    </span>
                    <span className="text-gray-500 ml-2">
                      {(item as Record<string, unknown>).vendor as string || "No vendor"} &middot;{" "}
                      {(item as Record<string, unknown>).date as string}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error(`Failed to fetch alerts: ${res.status}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const highAlerts = alerts.filter((a) => a.severity === "high");
  const mediumAlerts = alerts.filter((a) => a.severity === "medium");
  const lowAlerts = alerts.filter((a) => a.severity === "low");

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Smart Alerts" subtitle="Automated checks across your accounting data" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className={cx.statCard}>
            <span className="text-2xl font-bold text-gray-900">{alerts.length}</span>
            <span className="text-xs text-gray-500">Total Alerts</span>
          </div>
          <div className={cx.statCard}>
            <span className="text-2xl font-bold text-red-600">{highAlerts.length}</span>
            <span className="text-xs text-gray-500">High Severity</span>
          </div>
          <div className={cx.statCard}>
            <span className="text-2xl font-bold text-amber-600">{mediumAlerts.length}</span>
            <span className="text-xs text-gray-500">Medium Severity</span>
          </div>
          <div className={cx.statCard}>
            <span className="text-2xl font-bold text-blue-600">{lowAlerts.length}</span>
            <span className="text-xs text-gray-500">Low Severity</span>
          </div>
        </div>

        {/* Refresh */}
        <div className="flex justify-end mb-4">
          <button onClick={fetchAlerts} disabled={loading} className={cx.btnSecondary}>
            {loading ? "Scanning..." : "Refresh Alerts"}
          </button>
        </div>

        {loading && alerts.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg">Scanning your data...</p>
            <p className="text-sm mt-1">Checking for overdue invoices, duplicates, missing periods, and more.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && alerts.length === 0 && !error && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg font-medium">All clear!</p>
            <p className="text-sm mt-1">No alerts found. Your accounting data looks good.</p>
          </div>
        )}

        {/* High severity */}
        {highAlerts.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wider mb-3">
              High Severity ({highAlerts.length})
            </h2>
            <div className="space-y-3">
              {highAlerts.map((alert, i) => (
                <AlertCard key={`high-${i}`} alert={alert} />
              ))}
            </div>
          </div>
        )}

        {/* Medium severity */}
        {mediumAlerts.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-3">
              Medium Severity ({mediumAlerts.length})
            </h2>
            <div className="space-y-3">
              {mediumAlerts.map((alert, i) => (
                <AlertCard key={`medium-${i}`} alert={alert} />
              ))}
            </div>
          </div>
        )}

        {/* Low severity */}
        {lowAlerts.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-blue-700 uppercase tracking-wider mb-3">
              Low Severity ({lowAlerts.length})
            </h2>
            <div className="space-y-3">
              {lowAlerts.map((alert, i) => (
                <AlertCard key={`low-${i}`} alert={alert} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
