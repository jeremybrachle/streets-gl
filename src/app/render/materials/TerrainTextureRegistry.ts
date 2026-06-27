// Strata Lane B (s12) — live terrain base-ground texture switcher. A plain singleton (mirrors
// bridgeRegistry / buildingCollisionRegistry) so the dev panel can swap the terrain's base color
// texture at runtime with no recompile: GBufferPass watches `revision` and rebinds the terrain
// material's `tDetailMaps` slice-0 to the selected texture on the next frame. The default option is
// the current s11 "aerial_grass_rock" grass so reverting is one click — nothing is removed.

const STORAGE_KEY = 'strata.terrainTexture.v1';

export interface TerrainTextureOption {
	/** Stable id persisted to localStorage + used by the panel. */
	id: string;
	/** Human label shown in the dev panel. */
	label: string;
	/** ResourceLoader key (registered in resources.json) for the diffuse texture. */
	resourceKey: string;
	/**
	 * ResourceLoader key for the matching NORMAL map. The lit surface relief is what makes the engine's
	 * own ground look "high-res" — pairing each diffuse with its real normal (not one shared flat one)
	 * is the whole point of Lever A. Defaults to `genericTerrainNormal` (flat-ish) when omitted, e.g. the
	 * Poly Haven sets whose EXR normals can't load in WebGL.
	 */
	normalKey?: string;
	/**
	 * Which biome map to bind with this ground:
	 *  - 'neutral'  → flat (170,170,170) identity tile so the diffuse shows its OWN color (s11 grass etc.)
	 *  - 'regional' → the engine's real biomes_blurred map, which TINTS a near-white detail texture.
	 * The engine's original terrain (near-white `genericTerrainColor`) only looks right with 'regional';
	 * the Poly Haven sets already carry their own color so they use 'neutral'. Default 'neutral'.
	 */
	biome?: 'neutral' | 'regional';
}

// The selectable base grounds. First entry is the default (current s11 grass) so "revert" = click it.
// Two families so the user can A/B Poly Haven (CC0) against the engine's own original textures.
export const TERRAIN_TEXTURE_OPTIONS: readonly TerrainTextureOption[] = [
	// Poly Haven CC0
	{id: 'aerial_grass', label: 'Grass / rock (current)', resourceKey: 'aerialGrassColor'},
	{id: 'leafy_grass', label: 'Leafy grass', resourceKey: 'groundLeafyGrass'},
	{id: 'forrest_ground_01', label: 'Forest ground', resourceKey: 'groundForrestGround01'},
	{id: 'coast_sand_02', label: 'Coast sand', resourceKey: 'groundCoastSand02'},
	{id: 'coast_sand_rocks_02', label: 'Coast sand + rocks', resourceKey: 'groundCoastSandRocks02'},
	{id: 'rock_ground', label: 'Rock ground', resourceKey: 'groundRockGround'},
	{id: 'rocky_terrain_02', label: 'Rocky terrain', resourceKey: 'groundRockyTerrain02'},
	// Streets-GL originals — the engine's OWN landuse textures, each with its NATIVE diffuse + NATIVE
	// normal map (512²). These are the high-res, lit-relief textures the engine projects onto OSM areas
	// (the cracked rock / grainy sand / grass you see across the map); paired with their normals they
	// look as good here as the originals. `sgl_original` keeps the pre-s11 revert (near-white detail ×
	// regional biome).
	{id: 'sgl_original', label: 'Streets-GL original (biome-tinted)', resourceKey: 'genericTerrainColor', biome: 'regional'},
	{id: 'sgl_grass', label: 'Streets-GL grass (green)', resourceKey: 'grassDiffuse', normalKey: 'grassNormal'},
	{id: 'sgl_garden', label: 'Streets-GL garden (green)', resourceKey: 'gardenDiffuse', normalKey: 'gardenNormal'},
	{id: 'sgl_forest_floor', label: 'Streets-GL forest floor', resourceKey: 'forestFloorDiffuse', normalKey: 'forestFloorNormal'},
	{id: 'sgl_rock', label: 'Streets-GL rock', resourceKey: 'rockDiffuse', normalKey: 'rockNormal'},
	{id: 'sgl_sand', label: 'Streets-GL sand', resourceKey: 'sandDiffuse', normalKey: 'sandNormal'},
	{id: 'sgl_soil', label: 'Streets-GL soil (brown)', resourceKey: 'soilDiffuse', normalKey: 'soilNormal'},
	{id: 'sgl_gravel', label: 'Streets-GL gravel', resourceKey: 'gravelDiffuse', normalKey: 'gravelNormal'},
	{id: 'sgl_farmland', label: 'Streets-GL farmland', resourceKey: 'farmland0Diffuse', normalKey: 'farmland0Normal'},
];

export class TerrainTextureRegistry {
	public readonly options = TERRAIN_TEXTURE_OPTIONS;

	/** Currently selected option id (defaults to the first option = current grass). */
	public currentId: string = TERRAIN_TEXTURE_OPTIONS[0].id;

	/**
	 * Live tiling multiplier for the BASE detail terrain (s15). 1.0 = the engine default (no change).
	 * Higher = finer tiling = LESS zoomed-in, so the user can drag the base ground to match the
	 * tighter-tiled projected landuse decals (which repeat ~3-4× more often). Read every terrain frame
	 * by GBufferPass into the `detailScale` uniform — no recompile, fully live.
	 */
	public detailScale = 1;

	/** Bumped on every selection change; GBufferPass rebinds the terrain texture when it changes. */
	public revision = 0;

	public constructor() {
		this.load();
	}

	/** The selected option (always valid — falls back to the default if the id ever goes stale). */
	public current(): TerrainTextureOption {
		return this.options.find(o => o.id === this.currentId) ?? this.options[0];
	}

	/** ResourceLoader key for the selected base-ground diffuse texture. */
	public currentResourceKey(): string {
		return this.current().resourceKey;
	}

	/** ResourceLoader key for the selected ground's normal map (falls back to the generic normal). */
	public currentNormalKey(): string {
		return this.current().normalKey ?? 'genericTerrainNormal';
	}

	/** Which biome map the selected ground wants ('neutral' shows its own color; default 'neutral'). */
	public currentBiome(): 'neutral' | 'regional' {
		return this.current().biome ?? 'neutral';
	}

	/** Select an option by id. Unknown ids are ignored; a real change bumps revision + persists. */
	public select(id: string): void {
		if (id === this.currentId || !this.options.some(o => o.id === id)) {
			return;
		}
		this.currentId = id;
		this.revision++;
		this.save();
	}

	/** Set the live base-terrain tiling multiplier (clamped to a sane range) + persist it. */
	public setDetailScale(scale: number): void {
		const clamped = Math.min(8, Math.max(0.25, scale));
		if (clamped === this.detailScale) {
			return;
		}
		this.detailScale = clamped;
		this.save();
	}

	public save(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify({currentId: this.currentId, detailScale: this.detailScale}));
	}

	public load(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return;
		}
		try {
			const data = JSON.parse(raw) as {currentId?: string; detailScale?: number};
			if (typeof data.currentId === 'string' && this.options.some(o => o.id === data.currentId)) {
				this.currentId = data.currentId;
			}
			if (typeof data.detailScale === 'number' && isFinite(data.detailScale)) {
				this.detailScale = Math.min(8, Math.max(0.25, data.detailScale));
			}
		} catch {
			// Corrupt/old payload — keep the default.
		}
	}
}

export const terrainTextureRegistry = new TerrainTextureRegistry();
