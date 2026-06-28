import {TerrainTextureRegistry, TERRAIN_TEXTURE_OPTIONS} from "./TerrainTextureRegistry";
import Config from "~/app/Config";

// jest runs in the `node` env (no localStorage) — provide a minimal in-memory stub so the
// persistence round-trip is actually exercised (the registry's save/load already no-op safely when
// localStorage is absent, covered by the BridgeRegistry suite).
const installLocalStorageStub = (): void => {
	const store = new Map<string, string>();
	(globalThis as {localStorage?: unknown}).localStorage = {
		getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string): void => void store.set(k, v),
		removeItem: (k: string): void => void store.delete(k),
		clear: (): void => store.clear(),
	};
};

describe('TerrainTextureRegistry', () => {
	// The switcher is parked in the app (Config.TerrainTextureSwitcher = false) so the engine's original
	// ground always shows; these tests exercise the underlying switcher logic that re-enabling restores,
	// so force the flag on. A dedicated test below covers the parked behavior.
	const originalFlag = Config.TerrainTextureSwitcher;
	beforeEach(() => {
		installLocalStorageStub();
		Config.TerrainTextureSwitcher = true;
	});
	afterEach(() => {
		Config.TerrainTextureSwitcher = originalFlag;
	});

	it('when parked (Config off) locks to the engine original and ignores any persisted choice', () => {
		Config.TerrainTextureSwitcher = false;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('strata.terrainTexture.v1', JSON.stringify({currentId: 'leafy_grass', detailScale: 4}));
		}
		const r = new TerrainTextureRegistry();
		expect(r.currentId).toBe('sgl_original');
		expect(r.currentBiome()).toBe('regional');
		expect(r.detailScale).toBe(1);
	});

	it('defaults to the first option (current grass)', () => {
		const r = new TerrainTextureRegistry();
		expect(r.currentId).toBe(TERRAIN_TEXTURE_OPTIONS[0].id);
		expect(r.currentResourceKey()).toBe(TERRAIN_TEXTURE_OPTIONS[0].resourceKey);
	});

	it('select() changes the current option, bumps revision, resolves the resource key', () => {
		const r = new TerrainTextureRegistry();
		const rev = r.revision;
		r.select('leafy_grass');
		expect(r.currentId).toBe('leafy_grass');
		expect(r.revision).toBe(rev + 1);
		expect(r.currentResourceKey()).toBe('groundLeafyGrass');
	});

	it('select() ignores an unknown id and the same id (no revision bump)', () => {
		const r = new TerrainTextureRegistry();
		r.select('leafy_grass');
		const rev = r.revision;
		r.select('does_not_exist');
		r.select('leafy_grass');
		expect(r.revision).toBe(rev);
		expect(r.currentId).toBe('leafy_grass');
	});

	it('pairs Streets-GL options with their native normal, falls back to generic otherwise', () => {
		const r = new TerrainTextureRegistry();
		// default (Poly Haven grass) has no native normal → generic
		expect(r.currentNormalKey()).toBe('genericTerrainNormal');
		r.select('sgl_rock');
		expect(r.currentResourceKey()).toBe('rockDiffuse');
		expect(r.currentNormalKey()).toBe('rockNormal');
		r.select('leafy_grass');
		expect(r.currentNormalKey()).toBe('genericTerrainNormal');
	});

	it('reports neutral biome by default and regional for the engine-original option', () => {
		const r = new TerrainTextureRegistry();
		expect(r.currentBiome()).toBe('neutral');
		r.select('sgl_original');
		expect(r.currentBiome()).toBe('regional');
		r.select('leafy_grass');
		expect(r.currentBiome()).toBe('neutral');
	});

	it('persists the selection across instances', () => {
		const a = new TerrainTextureRegistry();
		a.select('rock_ground');
		const b = new TerrainTextureRegistry();
		expect(b.currentId).toBe('rock_ground');
	});

	it('defaults detailScale to 1 and clamps + persists setDetailScale', () => {
		const a = new TerrainTextureRegistry();
		expect(a.detailScale).toBe(1);
		a.setDetailScale(3.5);
		expect(a.detailScale).toBe(3.5);
		a.setDetailScale(100);   // clamped to max 8
		expect(a.detailScale).toBe(8);
		a.setDetailScale(0);     // clamped to min 0.25
		expect(a.detailScale).toBe(0.25);
		const b = new TerrainTextureRegistry();
		expect(b.detailScale).toBe(0.25); // round-tripped through localStorage
	});

	it('ignores a persisted id that is no longer a valid option', () => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('strata.terrainTexture.v1', JSON.stringify({currentId: 'gone'}));
		}
		const r = new TerrainTextureRegistry();
		expect(r.currentId).toBe(TERRAIN_TEXTURE_OPTIONS[0].id);
	});
});
