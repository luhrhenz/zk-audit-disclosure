"use client";

import { useEffect, useState } from "react";
import { initialMockStellar, txExplorerUrl } from "./config";
import SplashScreen from "./components/SplashScreen";

// Mirrors ProofResult from ./utils/prover — defined here so the type is
// available without a top-level import that would be evaluated during SSR.
type ProofResult = {
  witness: string;
  publicInputs: string[];
  commitment: string;
};

type Step = 1 | 2 | 3;

type ProofPhase =
  | "idle"
  | "deriving-fields"
  | "computing-pedersen"
  | "executing-witness"
  | "generating-proof"
  | "done";

const PHASE_LABELS: Record<ProofPhase, string> = {
  idle: "Generate ZK Proof",
  "deriving-fields": "Deriving field elements…",
  "computing-pedersen": "Computing Pedersen commitment…",
  "executing-witness": "Executing witness…",
  "generating-proof": "Generating ZK proof…",
  done: "Done",
};

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15 disabled:opacity-50";

/* ── Inline icons ───────────────────────────────────────────── */
function IconLock({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}
function IconUpload({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconShield({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8L15 10" />
    </svg>
  );
}
function IconCheck({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth="2.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 6" />
    </svg>
  );
}

const STEP_META = [
  { n: 1 as const, label: "Commit", Icon: IconLock },
  { n: 2 as const, label: "Submit", Icon: IconUpload },
  { n: 3 as const, label: "Reveal", Icon: IconShield },
];

export default function Home() {
  const [showSplash, setShowSplash] = useState(true);
  const [currentStep, setCurrentStep] = useState<Step>(1);

  // Step 1 state
  const [contractAddress, setContractAddress] = useState("");
  const [secretNotes, setSecretNotes] = useState("");
  const [proofPhase, setProofPhase] = useState<ProofPhase>("idle");
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  // Step 2 state
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Real (testnet) vs Demo (mock) — flip live during a presentation.
  const [useMock, setUseMock] = useState<boolean>(initialMockStellar());

  // Step 3 state
  const [revealNotes, setRevealNotes] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<"hashing" | "claiming" | null>(
    null
  );
  const [verifyResult, setVerifyResult] = useState<
    "verified" | "mismatch" | null
  >(null);
  const [verifyTxHash, setVerifyTxHash] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const commitment = proofResult?.commitment ?? null;
  const isGenerating = proofPhase !== "idle" && proofPhase !== "done";

  // Lock scroll while the splash is up.
  useEffect(() => {
    document.body.style.overflow = showSplash ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showSplash]);

  async function handleGenerateProof() {
    if (!contractAddress.trim() || !secretNotes.trim()) return;
    setProofError(null);

    try {
      // The prover runs in phases; we drive the label forward manually
      // because the heavy WASM work is a single async call with no internal events.
      setProofPhase("deriving-fields");
      await new Promise((r) => setTimeout(r, 0)); // flush paint

      // Kick off a parallel timer so the label keeps updating during proof gen
      let phaseIdx = 0;
      const phases: ProofPhase[] = [
        "computing-pedersen",
        "executing-witness",
        "generating-proof",
      ];
      const ticker = setInterval(() => {
        if (phaseIdx < phases.length) {
          setProofPhase(phases[phaseIdx++]);
        }
      }, 1200);

      // Dynamic import keeps @aztec/bb.js out of the SSR bundle entirely.
      const { generateProof } = await import("./utils/prover");
      const result = await generateProof(
        secretNotes.trim(),
        contractAddress.trim()
      );

      clearInterval(ticker);
      setProofResult(result);
      setProofPhase("done");
      setCurrentStep(2);
    } catch (err) {
      setProofPhase("idle");
      setProofError(
        err instanceof Error ? err.message : "Proof generation failed"
      );
    }
  }

  async function handleSubmitToStellar() {
    if (!commitment) return;
    setSubmitError(null);
    setSubmitting(true);

    if (useMock) {
      // Demo mode — no network, instant.
      await new Promise((r) => setTimeout(r, 1200));
      setTxHash(null);
      setSubmitting(false);
      setSubmitted(true);
      setTimeout(() => setCurrentStep(3), 800);
      return;
    }

    // Real mode — submit the commitment on-chain via the testnet verifier.
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractAddress: contractAddress.trim(),
          commitment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "submission failed");

      setTxHash(data.txHash ?? null);
      setSubmitting(false);
      setSubmitted(true);
      setTimeout(() => setCurrentStep(3), 800);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(
        err instanceof Error ? err.message : "on-chain submission failed"
      );
    }
  }

  async function handleReveal() {
    if (!revealNotes.trim() || !proofResult) return;
    setVerifying(true);
    setVerifyError(null);
    setVerifyTxHash(null);
    setVerifyPhase("hashing");

    // 1. Re-derive the commitment from the reveal notes and compare. We re-run
    //    generateProof so the comparison uses the same Pedersen path.
    let rehashCommitment: string;
    try {
      const { generateProof } = await import("./utils/prover");
      const rehash = await generateProof(
        revealNotes.trim(),
        contractAddress.trim()
      );
      rehashCommitment = rehash.commitment;
    } catch {
      setVerifyResult("mismatch");
      setVerifyPhase(null);
      setVerifying(false);
      return;
    }

    if (rehashCommitment !== proofResult.commitment) {
      setVerifyResult("mismatch");
      setVerifyPhase(null);
      setVerifying(false);
      return;
    }

    // 2. Hash matches. In demo mode we stop here; in live mode we flip the
    //    on-chain record to verified via verify_and_claim.
    if (useMock) {
      setVerifyResult("verified");
      setVerifyPhase(null);
      setVerifying(false);
      return;
    }

    setVerifyPhase("claiming");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractAddress: contractAddress.trim(),
          commitment: proofResult.commitment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "on-chain verification failed");
      setVerifyTxHash(data.txHash ?? null);
      setVerifyResult("verified");
    } catch (err) {
      // The Pedersen hash matched, but the on-chain claim failed (e.g. already
      // verified, or no commitment stored for this auditor).
      setVerifyError(
        err instanceof Error ? err.message : "on-chain verification failed"
      );
    }
    setVerifyPhase(null);
    setVerifying(false);
  }

  function copyCommitment() {
    if (!commitment) return;
    navigator.clipboard.writeText(commitment);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function stepState(n: Step): "done" | "active" | "todo" {
    const done = n === 3 ? verifyResult === "verified" : currentStep > n;
    if (done) return "done";
    if (currentStep === n) return "active";
    return "todo";
  }

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}

      {/* ambient background */}
      <div className="app-bg" />
      <div className="grid-overlay" />

      <div className="relative flex min-h-screen flex-col">
        {/* ── Header ── */}
        <header className="glass sticky top-0 z-20 border-b border-white/5">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-[13px] font-black text-emerald-950 shadow-[0_0_18px_-4px_rgba(16,185,129,0.7)]">
              ZK
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-100">
              ZK Audit Disclosure
            </span>
            <span className="hidden text-sm text-zinc-600 sm:inline">·</span>
            <span className="hidden text-sm text-zinc-500 sm:inline">
              Trustless Disclosure Layer
            </span>

            {/* Real (testnet) vs Demo (mock) toggle — flip live on stage. */}
            <button
              onClick={() => setUseMock((m) => !m)}
              title="Toggle between a real Stellar testnet transaction and an instant local mock"
              className={`ml-auto flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                useMock
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  useMock ? "bg-amber-400" : "animate-pulse bg-emerald-400"
                }`}
              />
              {useMock ? "Demo · mock" : "Live · testnet"}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
          {/* ── Hero ── */}
          <section className="animate-fade-up pt-16 pb-10 text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium tracking-wide text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Zero-Knowledge · Noir · Stellar Soroban
            </div>
            <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              <span className="gradient-text">Disclose a Vulnerability</span>
              <br />
              <span className="text-zinc-100">Without Revealing It</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-sm leading-relaxed text-zinc-400">
              Commit a zero-knowledge proof of your findings on-chain first — a
              tamper-proof, timestamped record of <em>what</em> you found and{" "}
              <em>when</em>. Reveal it on your terms, provably unchanged.
            </p>

            {/* trust chips */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-500">
              {["In-browser proving", "Pedersen / BN254", "Soroban anchored"].map(
                (chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-white/5 bg-white/[0.02] px-3 py-1"
                  >
                    {chip}
                  </span>
                )
              )}
            </div>
          </section>

          {/* ── Stepper ── */}
          <div className="animate-fade-up delay-1 mb-8 flex items-center justify-center">
            <div className="flex w-full max-w-md items-center">
              {STEP_META.map(({ n, label, Icon }, i) => {
                const state = stepState(n);
                return (
                  <div key={n} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-300 ${
                          state === "done"
                            ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
                            : state === "active"
                            ? "border-emerald-400/60 bg-gradient-to-br from-emerald-400 to-emerald-600 text-emerald-950 shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]"
                            : "border-white/10 bg-white/[0.02] text-zinc-600"
                        }`}
                      >
                        {state === "done" ? (
                          <IconCheck className="h-4 w-4" />
                        ) : (
                          <Icon className="h-[18px] w-[18px]" />
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-medium ${
                          state === "todo" ? "text-zinc-600" : "text-zinc-300"
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                    {i < STEP_META.length - 1 && (
                      <div className="mx-2 -mt-5 h-px flex-1 overflow-hidden rounded bg-white/10">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                          style={{ width: currentStep > n ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {/* ══ Step 1 — Commit ══ */}
            <section
              className={`glass-card animate-fade-up delay-2 p-6 ${
                currentStep === 1 ? "is-active" : ""
              }`}
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                  <IconLock className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-zinc-100">
                    Commit
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Generate a Pedersen commitment + ZK proof — entirely in-browser
                  </p>
                </div>
              </div>

              {currentStep === 1 ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                      Contract Address
                    </label>
                    <input
                      type="text"
                      value={contractAddress}
                      onChange={(e) => setContractAddress(e.target.value)}
                      placeholder="C… or 0x…"
                      disabled={isGenerating}
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                      Secret Vulnerability Notes{" "}
                      <span className="font-normal text-zinc-600">
                        (private — never transmitted)
                      </span>
                    </label>
                    <textarea
                      value={secretNotes}
                      onChange={(e) => setSecretNotes(e.target.value)}
                      placeholder="Describe the vulnerability: affected function, attack vector, PoC steps…"
                      rows={5}
                      disabled={isGenerating}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  {isGenerating && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3">
                      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                      <div>
                        <p className="text-sm font-medium text-zinc-100">
                          {PHASE_LABELS[proofPhase]}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Barretenberg WASM — first run can take 15–60s
                        </p>
                      </div>
                    </div>
                  )}

                  {proofError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                      {proofError}
                    </div>
                  )}

                  <button
                    onClick={handleGenerateProof}
                    disabled={
                      !contractAddress.trim() ||
                      !secretNotes.trim() ||
                      isGenerating
                    }
                    className={`btn-primary relative w-full overflow-hidden rounded-xl py-3 text-sm font-semibold ${
                      !isGenerating &&
                      contractAddress.trim() &&
                      secretNotes.trim()
                        ? "shimmer"
                        : ""
                    }`}
                  >
                    {isGenerating ? PHASE_LABELS[proofPhase] : "Generate ZK Proof"}
                  </button>
                </div>
              ) : (
                commitment && (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-500">
                      Pedersen commitment (public)
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 truncate rounded-xl border border-emerald-400/15 bg-black/30 px-3 py-2.5 font-mono text-xs text-emerald-300">
                        {commitment}
                      </div>
                      <button
                        onClick={copyCommitment}
                        className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-zinc-300 transition hover:bg-white/[0.07]"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    {proofResult && (
                      <p className="text-xs text-zinc-600">
                        Witness{" "}
                        <span className="font-mono text-zinc-500">
                          {proofResult.witness.length / 2} bytes
                        </span>{" "}
                        · {proofResult.publicInputs.length} public input
                        {proofResult.publicInputs.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                )
              )}
            </section>

            {/* ══ Step 2 — Submit ══ */}
            <section
              className={`glass-card animate-fade-up delay-3 p-6 ${
                currentStep === 2 ? "is-active" : ""
              } ${currentStep < 2 ? "opacity-60" : ""}`}
            >
              <div className="mb-5 flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    currentStep >= 2
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/[0.02] text-zinc-600"
                  }`}
                >
                  <IconUpload className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h2
                    className={`text-[15px] font-semibold ${
                      currentStep >= 2 ? "text-zinc-100" : "text-zinc-600"
                    }`}
                  >
                    Submit to Stellar
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Anchor your commitment on-chain before revealing anything
                  </p>
                </div>
              </div>

              {currentStep === 2 && commitment && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-xs text-zinc-500">
                      Commitment to store on-chain
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 truncate rounded-xl border border-emerald-400/15 bg-black/30 px-3 py-2.5 font-mono text-xs text-emerald-300">
                        {commitment}
                      </div>
                      <button
                        onClick={copyCommitment}
                        className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-zinc-300 transition hover:bg-white/[0.07]"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>

                  {submitted ? (
                    <div className="animate-fade-in space-y-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3.5">
                      <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                        <IconCheck className="h-4 w-4" />
                        {useMock
                          ? "Commitment submitted (demo / mock)"
                          : "Commitment anchored on Stellar testnet"}
                      </p>
                      {txHash && (
                        <div className="space-y-1 pt-0.5">
                          <p className="text-xs text-emerald-700">
                            Transaction hash
                          </p>
                          <a
                            href={txExplorerUrl(txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate font-mono text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                          >
                            {txHash}
                          </a>
                          <a
                            href={txExplorerUrl(txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-xs text-emerald-500 hover:text-emerald-400"
                          >
                            View on stellar.expert ↗
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {submitError && (
                        <div className="break-words rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {submitError}
                        </div>
                      )}
                      <button
                        onClick={handleSubmitToStellar}
                        disabled={submitting}
                        className="btn-primary w-full rounded-xl py-3 text-sm font-semibold"
                      >
                        {submitting
                          ? useMock
                            ? "Submitting…"
                            : "Submitting to testnet…"
                          : useMock
                          ? "Submit Commitment (Demo)"
                          : "Submit Commitment to Stellar"}
                      </button>
                      <p className="text-center text-xs text-zinc-600">
                        {useMock
                          ? "Demo mode — no real transaction is sent"
                          : "Sends a real transaction to the testnet verifier contract"}
                      </p>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* ══ Step 3 — Reveal ══ */}
            <section
              className={`glass-card animate-fade-up delay-4 p-6 ${
                currentStep === 3 ? "is-active" : ""
              } ${currentStep < 3 ? "opacity-60" : ""}`}
            >
              <div className="mb-5 flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    currentStep >= 3
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/[0.02] text-zinc-600"
                  }`}
                >
                  <IconShield className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <h2
                    className={`text-[15px] font-semibold ${
                      currentStep >= 3 ? "text-zinc-100" : "text-zinc-600"
                    }`}
                  >
                    Reveal
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Disclose your findings — Pedersen hash must match your commitment
                  </p>
                </div>
              </div>

              {currentStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                      Original Secret Notes
                    </label>
                    <textarea
                      value={revealNotes}
                      onChange={(e) => {
                        setRevealNotes(e.target.value);
                        setVerifyResult(null);
                        setVerifyError(null);
                      }}
                      placeholder="Paste your original vulnerability notes exactly as written…"
                      rows={5}
                      disabled={verifying}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  {verifying && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3">
                      <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                      <p className="text-sm text-zinc-100">
                        {verifyPhase === "claiming"
                          ? "Claiming on-chain (verify_and_claim)…"
                          : "Recomputing Pedersen commitment…"}
                      </p>
                    </div>
                  )}

                  {verifyResult === null && !verifying && (
                    <>
                      {verifyError && (
                        <div className="break-words rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {verifyError}
                        </div>
                      )}
                      <button
                        onClick={handleReveal}
                        disabled={!revealNotes.trim()}
                        className="btn-primary w-full rounded-xl py-3 text-sm font-semibold"
                      >
                        Reveal Vulnerability
                      </button>
                    </>
                  )}

                  {verifyResult === "verified" && (
                    <div className="animate-fade-in space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-emerald-950">
                          <IconCheck className="h-3 w-3" />
                        </span>
                        {useMock
                          ? "Proof verified — vulnerability disclosed"
                          : "Verified & claimed on-chain — vulnerability disclosed"}
                      </p>
                      <p className="text-xs text-emerald-700/90">
                        Pedersen hash matches the on-chain commitment. The protocol
                        confirms prior knowledge without leaking the secret.
                      </p>
                      {verifyTxHash && (
                        <div className="space-y-1 pt-1">
                          <p className="text-xs text-emerald-700">
                            verify_and_claim transaction
                          </p>
                          <a
                            href={txExplorerUrl(verifyTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate font-mono text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                          >
                            {verifyTxHash}
                          </a>
                          <a
                            href={txExplorerUrl(verifyTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-xs text-emerald-500 hover:text-emerald-400"
                          >
                            View on stellar.expert ↗
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {verifyResult === "mismatch" && (
                    <div className="animate-fade-in space-y-1 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4">
                      <p className="text-sm font-semibold text-red-300">
                        Hash mismatch — notes do not match commitment
                      </p>
                      <p className="text-xs text-red-400/80">
                        The recomputed Pedersen hash differs from the stored
                        commitment. Check for typos or whitespace differences.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── Footer ── */}
          <footer className="mt-10 flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2 text-[11px] text-zinc-600">
              <span className="h-1 w-1 rounded-full bg-emerald-500/60" />
              Proof generated in-browser · secret notes never leave your device
            </div>
            <p className="text-[11px] text-zinc-700">
              Built for the Stellar Hacks ZK Hackathon · Noir · Barretenberg ·
              Soroban
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}
