import { NextRequest, NextResponse } from "next/server";
// Bundle the compiled circuit WITH the function. public/ assets are served
// statically and are NOT available inside a serverless function's filesystem,
// so we import the JSON as a module instead of reading it from disk.
import circuit from "./circuit.json";

// Proving needs the full Node.js runtime (WASM + fs), not the Edge runtime.
export const runtime = "nodejs";
// Cold start + WASM init + witness execution can take a while; give it room.
export const maxDuration = 60;

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
    // Imported dynamically so the heavy Barretenberg/Noir WASM only loads when
    // a proof is actually requested (keeps cold starts cheap for the page).
    // These packages are listed in serverExternalPackages, so they are loaded
    // as real node modules at runtime with correct filesystem paths.
    const { BarretenbergSync, Fr } = await import("@aztec/bb.js");
    const { Noir } = await import("@noir-lang/noir_js");

    // 1. Compute pedersen_hash([secret_hash, contract_address]) — exactly the
    //    constraint enforced by the Noir circuit.
    const bb = await BarretenbergSync.new();
    const commitmentFr = bb.pedersenHash(
      [Fr.fromString(secretHashHex), Fr.fromString(contractAddressHex)],
      0
    );
    const commitment = commitmentFr.toString();

    // 2. Execute the Noir witness — proves the constraint is satisfiable given
    //    the private secret_hash, without revealing it.
    const noir = new Noir(circuit as ConstructorParameters<typeof Noir>[0]);
    const { witness } = await noir.execute({
      secret_hash: secretHashHex,
      contract_address: contractAddressHex,
      commitment,
    });

    return NextResponse.json({
      commitment,
      witness: Buffer.from(witness).toString("hex"),
      publicInputs: [contractAddressHex, commitment],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "proof generation failed";
    console.error("[/api/prove]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
