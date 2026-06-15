"use client";

import { useEffect, useState } from "react";

/**
 * Animated intro shown on first load. Auto-dismisses after ~2.4s and can be
 * skipped with a click/keypress. Fades out gracefully before unmounting.
 */
export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const dismiss = () => setLeaving(true);
    const auto = setTimeout(dismiss, 2400);
    window.addEventListener("keydown", dismiss);
    window.addEventListener("pointerdown", dismiss);
    return () => {
      clearTimeout(auto);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, []);

  // After the fade-out transition completes, tell the parent to unmount us.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, 650);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#07070a] transition-opacity duration-[650ms] ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/15 blur-[90px]" />
        <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[80px]" />
      </div>

      {/* emblem */}
      <div className="relative flex h-36 w-36 items-center justify-center">
        {/* expanding pulse rings */}
        <span
          className="absolute inset-0 rounded-full border border-emerald-400/40"
          style={{ animation: "pulseRing 2.4s ease-out infinite" }}
        />
        <span
          className="absolute inset-0 rounded-full border border-indigo-400/30"
          style={{ animation: "pulseRing 2.4s ease-out infinite", animationDelay: "0.8s" }}
        />

        {/* rotating orbit ring (SVG draw-in) */}
        <svg className="spin-slow absolute inset-0" viewBox="0 0 100 100" fill="none">
          <circle
            cx="50"
            cy="50"
            r="46"
            stroke="url(#splashGrad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="60 230"
            style={{ animation: "dash 1.4s ease-out both" }}
            strokeDashoffset="290"
          />
          <defs>
            <linearGradient id="splashGrad" x1="0" y1="0" x2="100" y2="100">
              <stop stopColor="#10b981" />
              <stop offset="1" stopColor="#6366f1" />
            </linearGradient>
          </defs>
        </svg>
        <svg
          className="spin-reverse absolute inset-2 opacity-60"
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#10b981"
            strokeWidth="0.75"
            strokeDasharray="3 9"
          />
        </svg>

        {/* center mark */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-lg font-black tracking-tight text-emerald-950 shadow-[0_0_40px_-6px_rgba(16,185,129,0.7)]">
          ZK
        </div>
      </div>

      {/* wordmark */}
      <div className="animate-fade-up delay-2 mt-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          ZK Audit Disclosure
        </h1>
        <p className="mt-1.5 text-xs uppercase tracking-[0.25em] text-zinc-500">
          Trustless · Zero-Knowledge · Stellar
        </p>
      </div>

      {/* loading bar */}
      <div className="animate-fade-in delay-3 mt-7 h-0.5 w-44 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full w-full rounded-full bg-gradient-to-r from-emerald-400 to-indigo-400"
          style={{
            animation: "growX 2.3s cubic-bezier(0.65,0,0.35,1) forwards",
            transformOrigin: "left",
          }}
        />
      </div>

      <p className="animate-fade-in delay-5 absolute bottom-8 text-[11px] text-zinc-600">
        click anywhere to skip
      </p>
    </div>
  );
}
