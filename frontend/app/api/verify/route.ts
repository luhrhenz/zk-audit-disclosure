import { NextRequest, NextResponse } from "next/server";
import {
  rpc,
  Contract,
  TransactionBuilder,
  Keypair,
  Address,
  nativeToScVal,
  StrKey,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { STELLAR, txExplorerUrl } from "../../config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Turn a 0x / hex commitment string into a 32-byte Buffer for BytesN<32>. */
function commitmentToBytes(commitment: string): Buffer {
  const hex = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
  const buf = Buffer.from(hex.padStart(64, "0"), "hex");
  if (buf.length !== 32) {
    throw new Error(`commitment must be 32 bytes, got ${buf.length}`);
  }
  return buf;
}

export async function POST(req: NextRequest) {
  let body: { contractAddress?: string; commitment?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { contractAddress, commitment } = body;
  if (!commitment) {
    return NextResponse.json({ error: "commitment is required" }, { status: 400 });
  }

  const secret = process.env.AUDITOR_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "server is not configured: AUDITOR_SECRET is missing" },
      { status: 500 }
    );
  }

  try {
    const keypair = Keypair.fromSecret(secret);
    const auditor = keypair.publicKey();

    // Must match the address used at commit time (see /api/commit): a valid
    // strkey passes through, anything else falls back to the auditor address.
    let auditContractAddr = auditor;
    if (
      contractAddress &&
      (StrKey.isValidContract(contractAddress) ||
        StrKey.isValidEd25519PublicKey(contractAddress))
    ) {
      auditContractAddr = contractAddress;
    }

    const server = new rpc.Server(STELLAR.rpcUrl);
    const account = await server.getAccount(auditor);
    const contract = new Contract(STELLAR.contractId);

    const op = contract.call(
      "verify_and_claim",
      nativeToScVal(Address.fromString(auditor), { type: "address" }),
      nativeToScVal(Address.fromString(auditContractAddr), { type: "address" }),
      nativeToScVal(commitmentToBytes(commitment), { type: "bytes" })
    );

    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    // prepareTransaction simulates; if the contract panics (e.g. mismatch or
    // already-verified) it throws here and we surface a clean error.
    const prepared = await server.prepareTransaction(built);
    prepared.sign(keypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      return NextResponse.json(
        { error: `transaction submission failed: ${JSON.stringify(sent.errorResult)}` },
        { status: 502 }
      );
    }

    let result = await server.getTransaction(sent.hash);
    const deadline = Date.now() + 45_000;
    while (
      result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      result = await server.getTransaction(sent.hash);
    }

    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return NextResponse.json(
        { error: `transaction did not succeed: ${result.status}`, txHash: sent.hash },
        { status: 502 }
      );
    }

    return NextResponse.json({
      txHash: sent.hash,
      explorerUrl: txExplorerUrl(sent.hash),
      contractId: STELLAR.contractId,
      auditor,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : "verify failed";
    console.error("[/api/verify]", raw);
    // The contract panics (→ a VM trap) when there's no commitment for this
    // auditor, the commitment/address don't match, or it's already verified.
    // Surface a readable hint instead of the raw HostError dump.
    const trapped =
      raw.includes("UnreachableCodeReached") ||
      raw.includes("InvalidAction") ||
      raw.includes("WasmVm");
    const msg = trapped
      ? "On-chain claim rejected: no matching commitment for this auditor, or it has already been verified."
      : raw;
    return NextResponse.json({ error: msg }, { status: trapped ? 409 : 500 });
  }
}
