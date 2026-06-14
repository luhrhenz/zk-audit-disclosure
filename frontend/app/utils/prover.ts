// BN254 scalar field order — Noir Field elements live in this field.
const BN254_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * SHA-256 a string in-browser → reduce mod BN254 field order → 0x-hex.
 * Gives a deterministic, in-range Field element from arbitrary text.
 * Nothing leaves the browser — the raw notes are never transmitted.
 */
async function textToField(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  const bigint = new Uint8Array(bytes).reduce(
    (acc, b) => (acc << 8n) | BigInt(b),
    0n
  );
  return "0x" + (bigint % BN254_ORDER).toString(16).padStart(64, "0");
}

export type ProofResult = {
  witness: string;     // hex-encoded witness (circuit execution trace)
  publicInputs: string[];
  commitment: string;  // Pedersen hash — anchored on Stellar
};

/**
 * Generate a ZK proof that the caller knows the secret vulnerability notes
 * for a given contract address, without revealing the notes.
 *
 * Privacy model: notes are SHA-256 hashed in-browser before being sent to
 * the /api/prove endpoint. Raw notes never leave the device.
 */
export async function generateProof(
  secretNotes: string,
  contractAddress: string
): Promise<ProofResult> {
  // Hash both inputs to BN254 Field elements in-browser.
  const secretHashHex = await textToField(secretNotes);
  const contractAddressHex = await textToField(contractAddress);

  // Delegate Pedersen hashing + UltraHonk proof generation to the Node.js
  // API route, which uses the on-disk Barretenberg WASM (fast, no bundling).
  const res = await fetch("/api/prove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secretHashHex, contractAddressHex }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "proof generation failed");
  }

  return res.json() as Promise<ProofResult>;
}
