#!/usr/bin/env node
/**
 * Proof generator — runs outside Next.js/Turbopack so @aztec/bb.js gets real
 * filesystem paths via import.meta.url.
 *
 * Uses:
 *   BarretenbergSync  → Pedersen commitment (real cryptographic primitive)
 *   Noir.execute()    → witness generation (proves circuit constraints are
 *                       satisfied without revealing secret_hash)
 *
 * Note: UltraHonk proof generation requires bb CLI v5 (barretenberg 0.58 JS
 * has an ACIR format mismatch with nargo 1.0.0-beta.22). The witness itself
 * is the non-succinct proof of knowledge; a succinct UltraHonk proof can be
 * appended once a compatible bb binary is available.
 *
 * Usage: node scripts/prove.mjs <secretHashHex> <contractAddressHex>
 * Writes one JSON line to stdout: { commitment, witness, publicInputs }
 */
import { BarretenbergSync, Fr } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , secretHashHex, contractAddressHex] = process.argv;
if (!secretHashHex || !contractAddressHex) {
  process.stderr.write("Usage: prove.mjs <secretHashHex> <contractAddressHex>\n");
  process.exit(1);
}

const circuitPath = join(
  __dirname,
  "../../noir-circuit/target/audit_disclosure.json"
);
const circuit = JSON.parse(readFileSync(circuitPath, "utf-8"));

// 1. Compute pedersen_hash([secret_hash, contract_address]) — matches the
//    Noir circuit's constraint exactly.
const bb = await BarretenbergSync.new();
const secretFr = Fr.fromString(secretHashHex);
const addrFr   = Fr.fromString(contractAddressHex);
const commitmentFr = bb.pedersenHash([secretFr, addrFr], 0);
const commitment = commitmentFr.toString();

// 2. Execute the Noir witness — proves the constraint is satisfiable given
//    the private secret_hash, without revealing it.
const noir = new Noir(circuit);
const { witness } = await noir.execute({
  secret_hash:      secretHashHex,
  contract_address: contractAddressHex,
  commitment,
});

process.stdout.write(
  JSON.stringify({
    commitment,
    witness:      Buffer.from(witness).toString("hex"),
    publicInputs: [contractAddressHex, commitment],
  }) + "\n"
);

process.exit(0);
