# ZK Audit Disclosure — Trustless Bug Bounty on Stellar

> Prove you found a vulnerability **before** you reveal it — without trusting the project to pay up, and without leaking the bug to anyone who hasn't earned it.

ZK Audit Disclosure is a zero-knowledge bug-bounty primitive. A security researcher cryptographically **commits** to a vulnerability they've discovered in a specific contract, anchors that commitment on **Stellar (Soroban)**, and can later **reveal** the details and **prove** — in zero knowledge — that the bug they're disclosing is exactly the one they committed to earlier.

This solves the classic bug-bounty standoff:

- **Researchers** fear disclosing a bug only to be ignored, lowballed, or front-run.
- **Projects** fear paying for vague or fabricated "findings."

A timestamped, on-chain ZK commitment gives the researcher a tamper-proof proof of *priority and authorship* without revealing the exploit, and gives the project cryptographic assurance that the later disclosure matches the original commitment.

---

## How it works

The app is a **3-step flow**:

### 1. Commit (private, in-browser)
The researcher enters their secret vulnerability notes and the target contract address. In the browser, both inputs are hashed into BN254 field elements, and a **Pedersen commitment** is computed:

```
commitment = pedersen_hash([secret_hash, contract_address])
```

The raw notes **never leave the device** — only the resulting commitment hash does.

### 2. Submit to Stellar
The commitment hash is anchored on-chain by calling the Soroban verifier contract's `commit` function. This records — immutably and with a ledger timestamp — that *this auditor* committed to *this commitment* for *this contract*, establishing priority.

### 3. Reveal & prove
When the researcher is ready to disclose, they re-enter their notes. The app regenerates the commitment and a **Noir zero-knowledge witness** proving knowledge of a `secret_hash` such that `pedersen_hash([secret_hash, contract_address]) == commitment` — *without revealing `secret_hash`*. The on-chain `verify_and_claim` function checks the revealed commitment against the stored one and marks it verified.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| **ZK circuit** | [Noir](https://noir-lang.org/) (`nargo` 1.0.0-beta.22) — `pedersen_hash` over the BN254 curve |
| **Proving backend** | [Barretenberg](https://github.com/AztecProtocol/barretenberg) WASM (`@aztec/bb.js`) — `BarretenbergSync.pedersenHash()` + `Noir.execute()` for witness generation |
| **Smart contract** | [Soroban](https://soroban.stellar.org/) (`soroban-sdk` v26) on Stellar — `commit`, `verify_and_claim`, `get_commitment` |
| **Frontend** | [Next.js](https://nextjs.org/) 16 (App Router, Turbopack, React 19, Tailwind v4) |
| **Proof service** | Next.js API route → standalone Node.js subprocess (`scripts/prove.mjs`) to run Barretenberg WASM with real filesystem paths, outside Turbopack's module system |

### Why a proof subprocess?
Turbopack virtualizes `__dirname` / `import.meta.url`, which breaks Barretenberg's WASM file resolution. The `/api/prove` route therefore spawns `scripts/prove.mjs` as a plain Node.js child process, giving the WASM real paths and keeping the heavy proving dependencies out of the browser bundle.

---

## Repository layout

```
zk-audit-disclosure/
├── noir-circuit/          # Noir ZK circuit (pedersen commitment proof)
│   ├── src/main.nr
│   ├── Nargo.toml
│   └── target/audit_disclosure.json   # compiled circuit (used at runtime)
├── soroban-contract/      # Soroban verifier smart contract
│   └── zk-verifier/contracts/hello-world/src/lib.rs
└── frontend/              # Next.js 3-step UI
    ├── app/page.tsx
    ├── app/api/prove/route.ts
    ├── app/utils/prover.ts
    └── scripts/prove.mjs
```

---

## The circuit

```rust
use std::hash::pedersen_hash;

fn main(secret_hash: Field, contract_address: pub Field, commitment: pub Field) {
    let computed_commitment = pedersen_hash([secret_hash, contract_address]);
    assert(computed_commitment == commitment);
}
```

`secret_hash` is **private**; `contract_address` and `commitment` are **public**. The proof attests that the prover knows a secret hashing to the public commitment, binding it to a specific contract.

## The contract

The Soroban verifier exposes three functions:

- **`commit(auditor, contract_address, commitment)`** — stores a timestamped `CommitmentRecord` keyed by auditor; requires the auditor's auth and emits a `CommittedEvent`.
- **`verify_and_claim(auditor, contract_address, commitment)`** — checks the revealed commitment against the stored record, marks it `verified`, and emits a `VerifiedEvent`.
- **`get_commitment(auditor)`** — reads back a stored commitment record.

---

## Running it locally

### Prerequisites
- **Node.js** 18+ and npm
- **Rust** + the `wasm32` target and [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) (only needed to build/deploy the contract)
- **Noir** toolchain (`noirup` → `nargo` 1.0.0-beta.22) (only needed to recompile the circuit)

### 1. Frontend (the main app)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:3000** and walk through Commit → Submit → Reveal.

> The compiled circuit (`noir-circuit/target/audit_disclosure.json`) is committed, so the proof flow works out of the box without rebuilding Noir.

### 2. (Optional) Recompile the Noir circuit
```bash
cd noir-circuit
nargo check       # type-check
nargo test        # run circuit tests
nargo execute     # generate a witness from Prover.toml
```

### 3. (Optional) Build the Soroban contract
```bash
cd soroban-contract/zk-verifier
stellar contract build      # or: cargo build --target wasm32-unknown-unknown --release
```

---

## Security & privacy notes

- Secret vulnerability notes are hashed **client-side**; only commitment hashes are transmitted or stored on-chain.
- The on-chain commitment provides a tamper-evident, timestamped proof of priority.
- This is a hackathon proof-of-concept (built for the **Stellar Hacks ZK** hackathon) and has **not** been audited. Do not use it to custody real bounties without a thorough review.

## License

MIT
