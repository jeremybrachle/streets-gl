import {
	assembleVariants, buildSpeciesClusters, placementsFromTreeInstanceBuffer,
	RawMeshGeo, TreeVariant, TreePlacement
} from "./TreeClusterModel";

// One bark triangle (1 unit tall) + one leaf triangle, both at the origin. Tagged via the leaf's
// first U coord so we can tell species apart in the merged output.
function makeVariant(name: string, tag: number): TreeVariant {
	return {
		name,
		bark: [{pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1], idx: [0, 1, 2]}],
		leaf: [{pos: [0, 1, 0, 1, 1, 0, 0, 2, 0], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [tag, 0, 1, 0, 0, 1], idx: [0, 1, 2]}],
		height: 1
	};
}

function place(x: number, z: number, species: number, variant = 0): TreePlacement {
	return {x, z, y: 0, yaw: 0, scale: 1, species, variant};
}

function rawMesh(name: string, kind: 'bark' | 'leaf', bounds: RawMeshGeo['bounds']): RawMeshGeo {
	const prim = {pos: [bounds.minx, bounds.miny, bounds.minz, bounds.maxx, bounds.maxy, bounds.maxz, bounds.minx, bounds.maxy, bounds.minz],
		nor: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 0, 1], idx: [0, 1, 2]};
	return {name, bark: kind === 'bark' ? [prim] : [], leaf: kind === 'leaf' ? [prim] : [], bounds};
}

describe('assembleVariants', () => {
	// A single-tree model whose trunk + foliage live in SEPARATE nodes (the realPine/realTree case).
	// Fresh fixtures per test — recenterVariant mutates prim positions in place.
	const trunk = (): RawMeshGeo => rawMesh('Trank', 'bark', {minx: 0, maxx: 4, miny: 0, maxy: 5, minz: -1, maxz: 1});
	const leaves = (): RawMeshGeo => rawMesh('Leaves', 'leaf', {minx: -1, maxx: 3, miny: 3, maxy: 9, minz: -1, maxz: 1});

	it('singleVariant=true merges all nodes into ONE variant with both bark and leaf', () => {
		const v = assembleVariants([trunk(), leaves()], true);
		expect(v).toHaveLength(1);
		expect(v[0].bark).toHaveLength(1);
		expect(v[0].leaf).toHaveLength(1);
		expect(v[0].height).toBeCloseTo(9); // union maxy(9) - miny(0)
	});

	it('singleVariant=true recenters on the UNION xz center', () => {
		const v = assembleVariants([trunk(), leaves()], true);
		// union x = [-1,4] -> cx 1.5; bark first vertex x was 0 -> -1.5. z = [-1,1] -> cz 0
		expect(v[0].bark[0].pos[0]).toBeCloseTo(-1.5);
		expect(v[0].bark[0].pos[2]).toBeCloseTo(-1);
	});

	it('singleVariant=false keeps one variant per node (the multi-tree-pack path)', () => {
		const v = assembleVariants([trunk(), leaves()], false);
		expect(v).toHaveLength(2);
	});

	it('drops nodes with no geometry', () => {
		const empty: RawMeshGeo = {name: 'x', bark: [], leaf: [], bounds: {minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0}};
		expect(assembleVariants([empty], true)).toHaveLength(0);
		expect(assembleVariants([empty, trunk()], false)).toHaveLength(1);
	});
});

describe('buildSpeciesClusters', () => {
	const speciesVariants = [[makeVariant('A', 0.25)], [makeVariant('B', 0.75)]];
	const anchor: [number, number] = [100, 200];

	it('returns one cluster per species, index-aligned', () => {
		const clusters = buildSpeciesClusters(speciesVariants, [], anchor);
		expect(clusters).toHaveLength(2);
		for (const c of clusters) {
			expect(c.bark.position).toHaveLength(0);
			expect(c.leaf.position).toHaveLength(0);
		}
	});

	it('buckets placements by species into the matching cluster only', () => {
		const placements = [place(110, 200, 0), place(120, 200, 0), place(130, 210, 1)];
		const clusters = buildSpeciesClusters(speciesVariants, placements, anchor);

		// species 0 got 2 trees, species 1 got 1 — 3 verts (1 tri) each, ×count
		expect(clusters[0].bark.position).toHaveLength(2 * 3 * 3);
		expect(clusters[0].leaf.position).toHaveLength(2 * 3 * 3);
		expect(clusters[1].bark.position).toHaveLength(1 * 3 * 3);

		// the species tag (leaf u of the first vertex) is preserved per bucket
		expect(clusters[0].leaf.uv[0]).toBeCloseTo(0.25);
		expect(clusters[1].leaf.uv[0]).toBeCloseTo(0.75);
	});

	it('places geometry anchor-relative (first bark vertex = placement - anchor)', () => {
		const clusters = buildSpeciesClusters(speciesVariants, [place(110, 230, 0)], anchor);
		expect(clusters[0].bark.position[0]).toBeCloseTo(110 - 100); // x - anchorX
		expect(clusters[0].bark.position[2]).toBeCloseTo(230 - 200); // z - anchorZ
	});
});

describe('placementsFromTreeInstanceBuffer', () => {
	// two instances, stride 6: [xLocal, y, zLocal, scale, rotation, textureId]
	const raw = new Float32Array([
		10, 5, 20, 1.0, 0.5, 3,
		30, 7, 40, 2.0, 1.5, 4
	]);
	const variantHeights = [[10], [5, 8]]; // species 0: one variant; species 1: two

	it('decodes stride-6 instances, world-offsets x/z, passes y + rotation through', () => {
		const ps = placementsFromTreeInstanceBuffer({raw, originX: 1000, originZ: 2000, variantHeights, targetHeight: 9});
		expect(ps).toHaveLength(2);
		expect(ps[0].x).toBeCloseTo(1010);
		expect(ps[0].z).toBeCloseTo(2020);
		expect(ps[0].y).toBeCloseTo(5);
		expect(ps[0].yaw).toBeCloseTo(0.5);
		expect(ps[1].x).toBeCloseTo(1030);
		expect(ps[1].z).toBeCloseTo(2040);
		expect(ps[1].y).toBeCloseTo(7);
		expect(ps[1].yaw).toBeCloseTo(1.5);
	});

	it('only assigns species that have variants', () => {
		const ps = placementsFromTreeInstanceBuffer({raw, originX: 0, originZ: 0, variantHeights: [[], [5]], targetHeight: 9});
		for (const p of ps) expect(p.species).toBe(1);
	});

	it('returns empty when no species have variants', () => {
		expect(placementsFromTreeInstanceBuffer({raw, originX: 0, originZ: 0, variantHeights: [[], []], targetHeight: 9})).toHaveLength(0);
	});

	it('is deterministic for the same positions', () => {
		const a = placementsFromTreeInstanceBuffer({raw, originX: 0, originZ: 0, variantHeights, targetHeight: 9});
		const b = placementsFromTreeInstanceBuffer({raw, originX: 0, originZ: 0, variantHeights, targetHeight: 9});
		expect(b.map(p => [p.species, p.variant, p.scale])).toEqual(a.map(p => [p.species, p.variant, p.scale]));
	});

	it('scales each tree toward targetHeight with bounded jitter (×0.8–1.3)', () => {
		const ps = placementsFromTreeInstanceBuffer({raw, originX: 0, originZ: 0, variantHeights, targetHeight: 9});
		for (const p of ps) {
			const h = variantHeights[p.species][p.variant];
			const ratio = p.scale / (9 / h);
			expect(ratio).toBeGreaterThanOrEqual(0.8 - 1e-6);
			expect(ratio).toBeLessThanOrEqual(1.3 + 1e-6);
		}
	});

	it('ignores a trailing partial instance (length not a multiple of stride)', () => {
		const partial = new Float32Array([10, 5, 20, 1, 0, 3, 30, 7]); // 1 full + 2 stray floats
		expect(placementsFromTreeInstanceBuffer({raw: partial, originX: 0, originZ: 0, variantHeights, targetHeight: 9})).toHaveLength(1);
	});
});
