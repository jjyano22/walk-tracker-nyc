"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; processed: number; matched: number }
  | { kind: "error"; message: string };

export default function RefreshButton() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleClick() {
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/process", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        processed?: number;
        matched?: number;
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      setState({
        kind: "success",
        processed: data.processed ?? 0,
        matched: data.matched ?? 0,
      });
      // Give the user a moment to read the toast, then reload everything.
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "failed",
      });
    }
  }

  const running = state.kind === "running";

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={handleClick}
        disabled={running}
        className={`w-full text-sm rounded-md border px-3 py-2 transition-colors ${
          running
            ? "bg-zinc-900 border-zinc-800 text-zinc-500 cursor-not-allowed"
            : "bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-700"
        }`}
      >
        {running ? "Refreshing coverage…" : "Refresh coverage"}
      </button>
      {state.kind === "success" && (
        <div className="mt-2 text-xs text-emerald-400">
          Processed {state.processed} new points
          {state.matched > 0 ? ` · matched ${state.matched}` : ""} — reloading…
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-2 text-xs text-red-400">
          Failed: {state.message}
        </div>
      )}
    </div>
  );
}
