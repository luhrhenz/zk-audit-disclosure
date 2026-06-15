"use client";

import { useState } from "react";
import { initialMockStellar, txExplorerUrl } from "./config";

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

function StepBadge({
  n,
  active,
  done,
}: {
  n: number;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        done
          ? "bg-emerald-500 text-zinc-950"
          : active
          ? "bg-zinc-100 text-zinc-950"
          : "bg-zinc-800 text-zinc-500"
      }`}
    >
      {done ? "✓" : n}
    </div>
  );
}

export default function Home() {
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center text-zinc-950 font-bold text-sm">
            ZK
          </div>
          <span className="font-semibold text-zinc-100 text-sm tracking-tight">
            ZK Audit Disclosure
          </span>
          <span className="text-zinc-600 text-sm hidden sm:inline">—</span>
          <span className="text-zinc-500 text-sm hidden sm:inline">
            Trustless Disclosure Layer for Bug Bounties
          </span>

          {/* Real (testnet) vs Demo (mock) toggle — flip live on stage. */}
          <button
            onClick={() => setUseMock((m) => !m)}
            title="Toggle between a real Stellar testnet transaction and an instant local mock"
            className={`ml-auto shrink-0 flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
              useMock
                ? "border-amber-700 bg-amber-950/60 text-amber-400"
                : "border-emerald-700 bg-emerald-950/60 text-emerald-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                useMock ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
              }`}
            />
            {useMock ? "Demo (mock)" : "Live · testnet"}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12 space-y-4">
        {/* Intro */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight mb-2">
            Disclose a Vulnerability — Without Revealing It
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Commit a zero-knowledge proof of your findings on-chain first — a
            tamper-proof, timestamped record of what you found and when. Reveal
            it on your terms, provably unchanged. Powered by Noir + Stellar.
          </p>
        </div>

        {/* ── Step 1 — ZK Commit ── */}
        <div
          className={`rounded-xl border p-6 transition-colors ${
            currentStep === 1
              ? "border-zinc-700 bg-zinc-900"
              : "border-zinc-800 bg-zinc-900/50"
          }`}
        >
          <div className="flex items-center gap-3 mb-5">
            <StepBadge n={1} active={currentStep === 1} done={currentStep > 1} />
            <div>
              <h2 className="font-semibold text-zinc-100">Commit</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Generate a Pedersen commitment + ZK proof — entirely in-browser
              </p>
            </div>
          </div>

          {currentStep === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Contract Address
                </label>
                <input
                  type="text"
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  placeholder="C... or 0x..."
                  disabled={isGenerating}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors font-mono disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Secret Vulnerability Notes{" "}
                  <span className="text-zinc-600 font-normal">
                    (private — never transmitted)
                  </span>
                </label>
                <textarea
                  value={secretNotes}
                  onChange={(e) => setSecretNotes(e.target.value)}
                  placeholder="Describe the vulnerability in detail: affected function, attack vector, PoC steps..."
                  rows={5}
                  disabled={isGenerating}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors resize-none disabled:opacity-50"
                />
              </div>

              {/* Proof generation progress */}
              {isGenerating && (
                <div className="rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  <div>
                    <p className="text-sm text-zinc-200 font-medium">
                      {PHASE_LABELS[proofPhase]}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      UltraHonk proof via Barretenberg WASM — takes 15–60s
                      on first run
                    </p>
                  </div>
                </div>
              )}

              {proofError && (
                <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-400">
                  {proofError}
                </div>
              )}

              <button
                onClick={handleGenerateProof}
                disabled={
                  !contractAddress.trim() || !secretNotes.trim() || isGenerating
                }
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                {isGenerating
                  ? PHASE_LABELS[proofPhase]
                  : "Generate ZK Proof"}
              </button>
            </div>
          ) : (
            commitment && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">
                  Pedersen commitment (public)
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 font-mono text-xs text-emerald-400 truncate">
                    {commitment}
                  </div>
                  <button
                    onClick={copyCommitment}
                    className="shrink-0 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs px-3 py-2 rounded-lg transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                {proofResult && (
                  <p className="text-xs text-zinc-600">
                    Witness:{" "}
                    <span className="font-mono">
                      {proofResult.witness.length / 2} bytes
                    </span>{" "}
                    · {proofResult.publicInputs.length} public input
                    {proofResult.publicInputs.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {/* ── Step 2 — Submit to Stellar ── */}
        <div
          className={`rounded-xl border p-6 transition-colors ${
            currentStep === 2
              ? "border-zinc-700 bg-zinc-900"
              : "border-zinc-800 bg-zinc-900/50"
          }`}
        >
          <div className="flex items-center gap-3 mb-5">
            <StepBadge n={2} active={currentStep === 2} done={currentStep > 2} />
            <div>
              <h2
                className={`font-semibold ${
                  currentStep >= 2 ? "text-zinc-100" : "text-zinc-600"
                }`}
              >
                Submit to Stellar
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Anchor your commitment on-chain before revealing anything
              </p>
            </div>
          </div>

          {currentStep === 2 && commitment && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">
                  Commitment to store on-chain
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 font-mono text-xs text-emerald-400 truncate">
                    {commitment}
                  </div>
                  <button
                    onClick={copyCommitment}
                    className="shrink-0 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs px-3 py-2 rounded-lg transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {submitted ? (
                <div className="rounded-lg bg-emerald-950 border border-emerald-800 px-4 py-3 space-y-2">
                  <p className="text-sm text-emerald-400 font-medium">
                    {useMock
                      ? "Commitment submitted (demo / mock)"
                      : "Commitment anchored on Stellar testnet"}
                  </p>
                  {txHash && (
                    <div className="space-y-1">
                      <p className="text-xs text-emerald-700">Transaction hash</p>
                      <a
                        href={txExplorerUrl(txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block font-mono text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2 truncate"
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
                    <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-400 break-words">
                      {submitError}
                    </div>
                  )}
                  <button
                    onClick={handleSubmitToStellar}
                    disabled={submitting}
                    className="w-full bg-zinc-100 hover:bg-white disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
                  >
                    {submitting
                      ? useMock
                        ? "Submitting…"
                        : "Submitting to testnet…"
                      : useMock
                      ? "Submit Commitment (Demo)"
                      : "Submit Commitment to Stellar"}
                  </button>
                  <p className="text-xs text-zinc-600 text-center">
                    {useMock
                      ? "Demo mode — no real transaction is sent"
                      : "Sends a real transaction to the testnet verifier contract"}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Step 3 — Reveal ── */}
        <div
          className={`rounded-xl border p-6 transition-colors ${
            currentStep === 3
              ? "border-zinc-700 bg-zinc-900"
              : "border-zinc-800 bg-zinc-900/50"
          }`}
        >
          <div className="flex items-center gap-3 mb-5">
            <StepBadge
              n={3}
              active={currentStep === 3}
              done={verifyResult === "verified"}
            />
            <div>
              <h2
                className={`font-semibold ${
                  currentStep >= 3 ? "text-zinc-100" : "text-zinc-600"
                }`}
              >
                Reveal
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Disclose your findings — Pedersen hash must match your
                commitment
              </p>
            </div>
          </div>

          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Original Secret Notes
                </label>
                <textarea
                  value={revealNotes}
                  onChange={(e) => {
                    setRevealNotes(e.target.value);
                    setVerifyResult(null);
                    setVerifyError(null);
                  }}
                  placeholder="Paste your original vulnerability notes exactly as written..."
                  rows={5}
                  disabled={verifying}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors resize-none disabled:opacity-50"
                />
              </div>

              {verifying && (
                <div className="rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  <p className="text-sm text-zinc-200">
                    {verifyPhase === "claiming"
                      ? "Claiming on-chain (verify_and_claim)…"
                      : "Recomputing Pedersen commitment…"}
                  </p>
                </div>
              )}

              {verifyResult === null && !verifying && (
                <>
                  {verifyError && (
                    <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-400 break-words">
                      {verifyError}
                    </div>
                  )}
                  <button
                    onClick={handleReveal}
                    disabled={!revealNotes.trim()}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
                  >
                    Reveal Vulnerability
                  </button>
                </>
              )}

              {verifyResult === "verified" && (
                <div className="rounded-lg bg-emerald-950 border border-emerald-700 px-4 py-4 space-y-2">
                  <p className="text-emerald-400 font-semibold text-sm">
                    {useMock
                      ? "Proof verified — vulnerability disclosed"
                      : "Verified & claimed on-chain — vulnerability disclosed"}
                  </p>
                  <p className="text-emerald-700 text-xs">
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
                        className="block font-mono text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2 truncate"
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
                <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-4 space-y-1">
                  <p className="text-red-400 font-semibold text-sm">
                    Hash mismatch — notes do not match commitment
                  </p>
                  <p className="text-red-700 text-xs">
                    The recomputed Pedersen hash differs from the stored
                    commitment. Check for typos or whitespace differences.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer note */}
        <p className="text-xs text-zinc-700 text-center pt-4">
          Proof generated entirely in-browser via Barretenberg WASM. Secret
          notes never leave your device. Built for Stellar Hacks ZK Hackathon.
        </p>
      </main>
    </div>
  );
}
