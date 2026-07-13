# Runtime 3D asset contract

The simulator currently uses its procedural vehicle and ship as dependable fallbacks. Production models should ship as optimized GLB files and be registered through `src/render/assetManifest.ts`.

## Conventions

- Units: meters
- Up axis: +Y
- Vehicle origin: center of mass, with engine thrust along +Y
- Ship origin: deck target center at world origin
- Applied transforms and stable, descriptive node names
- Separate low-complexity collision proxies for hull, deck, booster body, and landing legs
- Shared PBR materials where possible
- Meshopt geometry compression and KTX2 textures
- LOD0 for close inspection, LOD1 for chase cameras, LOD2 for distant views

Before registering an asset, validate it with Khronos glTF Validator and optimize it with glTF Transform. Runtime code must not compensate for incorrect pivots, scale, or unapplied transforms.
