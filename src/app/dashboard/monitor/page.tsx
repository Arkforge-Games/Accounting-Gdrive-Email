"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";

/* ---------- Types ---------- */
interface PipelineRun {
  id: string;
  run_date: string;
  actions_count: number;
  succeeded: number;
  failed: number;
  last_action: string;
}

interface PipelineLog {
  id: string;
  run_id: string;
  timestamp: string;
  file_name?: string;
  file_id?: string;
  action: string;
  status: "success" | "error" | "duplicate" | "skipped";
  result?: string;
  error?: string;
  details?: string;
}

type LogFilter = "all" | "success" | "error" | "duplicate" | "skipped";

/* ---------- Status badge helper ---------- */
const statusBadge: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
  duplicate: "bg-yellow-100 text-yellow-700",
  skipped: "bg-gray-100 text-gray-500",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`${cx.badge} ${statusBadge[status] ?? "bg-gray-100 text-gray-500"}`}
    >
      {status}
    </span>
  );
}

/* ---------- Spinner ---------- */
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/* ========== Page Component ========== */
export default function MonitorPage() {
  /* --- State --- */
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [unrecordedCount, setUnrecordedCount] = useState<number | null>(null);
  const [lastRunTime, setLastRunTime] = useState<string | null>(null);
  const [lastRunResults, setLastRunResults] = useState<string | null>(null);

  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [logSearch, setLogSearch] = useState("");

  const [running, setRunning] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  /* --- Fetchers --- */
  const fetchUnrecorded = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline?action=unrecorded");
      const data = await res.json();
      setUnrecordedCount(data.count ?? 0);
    } catch {
      /* silent */
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline?action=status");
      const data = await res.json();
      const list: PipelineRun[] = data.runs ?? data ?? [];
      setRuns(list);
      if (list.length > 0) {
        setLastRunTime(list[0].run_date);
        setLastRunResults(
          `${list[0].succeeded} ok / ${list[0].failed} failed of ${list[0].actions_count}`
        );
      }
    } catch {
      /* silent */
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchLogs = useCallback(async (runId?: string | null) => {
    setLoadingLogs(true);
    try {
      const url = runId
        ? `/api/pipeline?action=log&runId=${runId}`
        : "/api/pipeline?action=log";
      const res = await fetch(url);
      const data = await res.json();
      setLogs(data.logs ?? data ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  /* --- Initial + auto-refresh --- */
  useEffect(() => {
    fetchUnrecorded();
    fetchRuns();
    fetchLogs();
    const interval = setInterval(() => {
      fetchUnrecorded();
      fetchRuns();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchUnrecorded, fetchRuns, fetchLogs]);

  /* --- Refetch logs when selected run changes --- */
  useEffect(() => {
    fetchLogs(selectedRunId);
  }, [selectedRunId, fetchLogs]);

  /* --- Run pipeline --- */
  const handleRun = async () => {
    setRunning(true);
    try {
      await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      await fetchRuns();
      await fetchUnrecorded();
      await fetchLogs(selectedRunId);
    } catch {
      /* silent */
    } finally {
      setRunning(false);
    }
  };

  /* --- Filter + search logs --- */
  const filteredLogs = logs.filter((log) => {
    if (logFilter !== "all" && log.status !== logFilter) return false;
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      return (
        (log.file_name ?? "").toLowerCase().includes(q) ||
        (log.action ?? "").toLowerCase().includes(q) ||
        (log.result ?? "").toLowerCase().includes(q) ||
        (log.error ?? "").toLowerCase().includes(q) ||
        (log.details ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  /* --- Filter buttons config --- */
  const filterButtons: { label: string; value: LogFilter }[] = [
    { label: "All", value: "all" },
    { label: "Success", value: "success" },
    { label: "Errors", value: "error" },
    { label: "Duplicates", value: "duplicate" },
    { label: "Skipped", value: "skipped" },
  ];

  /* ========== Render ========== */
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Pipeline Monitor" subtitle="Autonomous accounting pipeline" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* ===== Section 1: Controls + Summary ===== */}
        <div className={`${cx.card} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Pipeline Controls</h2>
            <button
              onClick={handleRun}
              disabled={running}
              className={`${cx.btn} bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800`}
            >
              {running && <Spinner />}
              {running ? "Running..." : "Run Pipeline"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={cx.statCard}>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Unrecorded Files
              </span>
              <span className="text-2xl font-bold text-gray-800">
                {unrecordedCount ?? "-"}
              </span>
            </div>
            <div className={cx.statCard}>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Last Run
              </span>
              <span className="text-sm font-semibold text-gray-800">
                {lastRunTime
                  ? new Date(lastRunTime).toLocaleString()
                  : "-"}
              </span>
            </div>
            <div className={cx.statCard}>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Last Run Results
              </span>
              <span className="text-sm font-semibold text-gray-800">
                {lastRunResults ?? "-"}
              </span>
            </div>
          </div>
        </div>

        {/* ===== Section 2: Run History ===== */}
        <div className={`${cx.card} overflow-hidden`}>
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-base font-semibold">Pipeline Run History</h2>
          </div>

          {loadingRuns ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No runs yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className={cx.tableHeader}>Run Date</th>
                    <th className={cx.tableHeader}>Actions</th>
                    <th className={cx.tableHeader}>Succeeded</th>
                    <th className={cx.tableHeader}>Failed</th>
                    <th className={cx.tableHeader}>Last Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() =>
                        setSelectedRunId(
                          selectedRunId === run.id ? null : run.id
                        )
                      }
                      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                        selectedRunId === run.id ? "bg-purple-50" : ""
                      }`}
                    >
                      <td className={cx.tableCell}>
                        {new Date(run.run_date).toLocaleString()}
                      </td>
                      <td className={cx.tableCell}>{run.actions_count}</td>
                      <td className={cx.tableCell}>
                        <span className="text-green-600 font-medium">
                          {run.succeeded}
                        </span>
                      </td>
                      <td className={cx.tableCell}>
                        <span
                          className={
                            run.failed > 0
                              ? "text-red-600 font-medium"
                              : "text-gray-400"
                          }
                        >
                          {run.failed}
                        </span>
                      </td>
                      <td className={cx.tableCell}>{run.last_action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== Section 3: Pipeline Logs ===== */}
        <div className={`${cx.card} overflow-hidden`}>
          <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="text-base font-semibold shrink-0">
              Pipeline Logs
              {selectedRunId && (
                <span className="ml-2 text-xs text-purple-600 font-normal">
                  Run: {selectedRunId}
                </span>
              )}
            </h2>

            <div className="flex flex-1 items-center gap-2 flex-wrap">
              {/* Filter buttons */}
              <div className="flex gap-1">
                {filterButtons.map((fb) => (
                  <button
                    key={fb.value}
                    onClick={() => setLogFilter(fb.value)}
                    className={
                      logFilter === fb.value ? cx.btnPrimary : cx.btnSecondary
                    }
                  >
                    {fb.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <input
                type="text"
                placeholder="Search logs..."
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className={`${cx.input} max-w-xs`}
              />
            </div>
          </div>

          {loadingLogs ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No logs found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className={cx.tableHeader}>Timestamp</th>
                    <th className={cx.tableHeader}>File</th>
                    <th className={cx.tableHeader}>Action</th>
                    <th className={cx.tableHeader}>Status</th>
                    <th className={cx.tableHeader}>Result</th>
                    <th className={cx.tableHeader}>Error</th>
                    <th className={cx.tableHeader}>Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                      <td className={`${cx.tableCell} whitespace-nowrap`}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className={`${cx.tableCell} max-w-[200px] truncate`}>
                        {log.file_id ? (
                          <span title={log.file_id}>
                            {log.file_name ?? log.file_id}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className={cx.tableCell}>{log.action}</td>
                      <td className={cx.tableCell}>
                        <StatusBadge status={log.status} />
                      </td>
                      <td className={`${cx.tableCell} max-w-[200px] truncate`}>
                        {log.result ?? <span className="text-gray-300">-</span>}
                      </td>
                      <td className={`${cx.tableCell} max-w-[200px] truncate`}>
                        {log.error ? (
                          <span className="text-red-600">{log.error}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className={`${cx.tableCell} max-w-[200px] truncate`}>
                        {log.details ?? <span className="text-gray-300">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
