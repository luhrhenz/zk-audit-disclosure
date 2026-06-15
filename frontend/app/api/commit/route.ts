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

    // The audited contract address must be a valid Stellar address (C... or
    // G...). The free-text field accepts anything (e.g. "0x..."), so if it's
    // not a valid strkey we fall back to the auditor's own address purely so
    // the demo transaction still goes through, and flag it in the response.
    let auditContractAddr = auditor;
    let usedFallback = false;
    if (
      contractAddress &&
      (StrKey.isValidContract(contractAddress) ||
        StrKey.isValidEd25519PublicKey(contractAddress))
    ) {
      auditContractAddr = contractAddress;
    } else if (contractAddress) {
      usedFallback = true;
    }

    const server = new rpc.Server(STELLAR.rpcUrl);
    const account = await server.getAccount(auditor);
    const contract = new Contract(STELLAR.contractId);

    const op = contract.call(
      "commit",
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

    // Simulate + assemble (footprint, resource fees, auth). require_auth(auditor)
    // is covered by the source-account signature below.
    const prepared = await server.prepareTransaction(built);
    prepared.sign(keypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      return NextResponse.json(
        { error: `transaction submission failed: ${JSON.stringify(sent.errorResult)}` },
        { status: 502 }
      );
    }

    // Poll until the transaction lands in a ledger.
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
      auditedContractAddress: auditContractAddr,
      usedFallbackAddress: usedFallback,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "commit failed";
    console.error("[/api/commit]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
