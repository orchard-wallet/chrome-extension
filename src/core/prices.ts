import type { AssetDefinition, AssetPrice } from "./assets";

interface DefiLlamaPriceResponse {
  coins?: Record<
    string,
    {
      price?: number;
      symbol?: string;
      timestamp?: number;
    }
  >;
}

export async function fetchNativeUsdPrices(definitions: AssetDefinition[]): Promise<Record<string, AssetPrice>> {
  const keyedDefinitions = definitions.filter((definition) => definition.priceKey);
  const uniquePriceKeys = Array.from(new Set(keyedDefinitions.map((definition) => definition.priceKey).filter(Boolean)));

  if (uniquePriceKeys.length === 0) {
    return {};
  }

  const response = await fetch(`https://coins.llama.fi/prices/current/${uniquePriceKeys.join(",")}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Price request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as DefiLlamaPriceResponse;
  const refreshedAt = new Date().toISOString();
  const prices: Record<string, AssetPrice> = {};

  for (const definition of keyedDefinitions) {
    const coin = definition.priceKey ? payload.coins?.[definition.priceKey] : undefined;

    if (coin?.price === undefined || !Number.isFinite(coin.price)) {
      continue;
    }

    prices[definition.assetId] = {
      assetId: definition.assetId,
      currency: "USD",
      value: coin.price.toString(),
      source: "defillama",
      refreshedAt
    };
  }

  return prices;
}
