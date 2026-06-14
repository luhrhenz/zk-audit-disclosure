import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

// Absolute path to the standalone prover script.
// Runs in plain Node.js, completely outside Turbopack's module system,
// so @aztec/bb.js gets real import.meta.url / __dirname values.
const PROVER_SCRIPT = path.resolve(process.cwd(), "scripts/prove.mjs");

export async function POST(req: NextRequest) {
  let body: { secretHashHex?: string; contractAddressHex?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { secretHashHex, contractAddressHex } = body;
  if (!secretHashHex || !contractAddressHex) {
    return NextResponse.json(
      { error: "secretHashHex and contractAddressHex are required" },
      { status: 400 }
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath, // node binary
      [PROVER_SCRIPT, secretHashHex, contractAddressHex],
      {
        timeout: 120_000, // 2 min — witness execution can take a moment
        maxBuffer: 10 * 1024 * 1024, // 10 MB stdout buffer
      }
    );

    if (stderr) {
      console.warn("[/api/prove] stderr:", stderr.slice(0, 500));
    }

    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "proof generation failed";
    console.error("[/api/prove]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
