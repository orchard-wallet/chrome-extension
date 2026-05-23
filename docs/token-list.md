# Token list

This wallet's EVM ERC-20 metadata (symbol, name, decimals, contract address)
comes from two sources, layered:

1. **Curated** — `src/core/tokenList.ts` (`CURATED_ERC20_TOKENS`). Hand-maintained
   entries that need extra fields the upstream doesn't carry (typically a
   `priceKey` for our 0x / Coingecko price oracle) or that we want to pin to a
   fixed position at the top of the Swap selector.
2. **Generated** — `src/core/generatedTokenList.ts`. Produced by
   `npm run sync:tokens` from the upstream
   [ethereum-lists/tokens](https://github.com/ethereum-lists/tokens) repository.
   Do not edit by hand — it is regenerated on every sync.

`getKnownErc20Tokens(networkId)` merges the two by lowercase contract address,
with the curated layer taking precedence. Consumers (Swap selector, balance
refresh in `src/core/evmAssets.ts`) call this helper rather than reading
either source directly.

## Refreshing the generated list

```bash
npm run sync:tokens
```

The script (`scripts/sync-token-list.mjs`) walks the `SEED` map of
checksummed addresses, fetches each `tokens/<chain>/<address>.json` file
from upstream `master`, normalizes the result, and rewrites
`src/core/generatedTokenList.ts`. To add a token, append its EIP-55
checksummed address to the relevant chain array in the script and re-run.

The fetch fails fast on a 404 — upstream filenames are case-sensitive
(EIP-55 checksum), so a 404 almost always means the address casing is
wrong rather than the token missing.

## Chain coverage

Currently only `ethereum-mainnet` syncs from upstream. The upstream repo's
`arb/` and `matic/` directories carry only a handful of tokens, so for
Arbitrum One and Polygon Mainnet we rely solely on the curated layer.
Expand the `NETWORK_TO_CHAIN_DIR` and `SEED` constants in the sync script
if upstream coverage improves.

## License attribution

The upstream `ethereum-lists/tokens` repository is MIT-licensed. We
re-distribute a derived subset (the regenerated TypeScript module) under
the same license. The full upstream license text is preserved in
[`LICENSES.md`](../LICENSES.md).
