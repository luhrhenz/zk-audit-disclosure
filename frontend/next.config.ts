import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Exclude Barretenberg and Noir packages from the server bundle so they are
  // require()'d at runtime with real Node.js paths. Without this, Turbopack
  // virtualises __dirname as /ROOT/... and the WASM file cannot be found.
  serverExternalPackages: [
    "@aztec/bb.js",
    "@noir-lang/backend_barretenberg",
    "@noir-lang/noir_js",
    "@noir-lang/acvm_js",
    "@noir-lang/noirc_abi",
    "@noir-lang/types",
  ],

  turbopack: {
    // Override workspace root — Next.js otherwise walks up and detects
    // /home/loner as the root (there is a stray package-lock.json there),
    // which mangles RSC client-manifest module keys and breaks SSR.
    // process.cwd() is reliable here because `next dev` always runs from
    // this directory; __dirname is virtualised when the TS config is loaded.
    root: process.cwd(),
  },
};

export default nextConfig;
