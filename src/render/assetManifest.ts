export type AssetKey = "vehicle.booster" | "environment.odyssey";

export interface AssetManifestEntry {
  /** Shipping format is GLB. Null means use the procedural runtime fallback. */
  url: string | null;
  scale: number;
  castShadow: boolean;
}

export const ASSET_MANIFEST: Record<AssetKey, AssetManifestEntry> = {
  "vehicle.booster": { url:null, scale:1, castShadow:true },
  "environment.odyssey": { url:null, scale:1, castShadow:true },
};
