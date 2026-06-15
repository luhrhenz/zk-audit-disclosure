// ────────────────────────────────────────────────────────────────────────
//  PRESENTATION TOGGLE  ⚡
//
//  `false` → the "Submit to Stellar" step sends a REAL transaction to the
//            deployed verifier contract on Stellar testnet.
//  `true`  → it runs an instant local MOCK (no network), handy for demos
//            when there's no connectivity or you want a fast walkthrough.
//
//  You can flip this here, OR override it at runtime without editing code by
//  setting NEXT_PUBLIC_MOCK_STELLAR=true|false, OR flip it live on stage with
//  the Real/Demo switch in the app header.
// ────────────────────────────────────────────────────────────────────────
export const DEFAULT_MOCK_STELLAR = false;

/** Resolve the initial mock setting: env var wins, else the constant above. */
export function initialMockStellar(): boolean {
  const env = process.env.NEXT_PUBLIC_MOCK_STELLAR;
  if (env === "true") return true;
  if (env === "false") return false;
  return DEFAULT_MOCK_STELLAR;
}

/** Deployed Soroban verifier — testnet. */
export const STELLAR = {
  contractId:
    process.env.NEXT_PUBLIC_CONTRACT_ID ??
    "CBFWF7XLNS55UMRAL4BU73NW32RHF2ED3HJAFMJN4Q2URUB52BUDPXMU",
  network: "testnet" as const,
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  /** stellar.expert explorer base for testnet. */
  explorerBase: "https://stellar.expert/explorer/testnet",
};

export function txExplorerUrl(hash: string): string {
  return `${STELLAR.explorerBase}/tx/${hash}`;
}

export function contractExplorerUrl(contractId: string): string {
  return `${STELLAR.explorerBase}/contract/${contractId}`;
}
