import Mat4 from "~/lib/math/Mat4";
import Vec3 from "~/lib/math/Vec3";
import ResourceLoader from "~/app/world/ResourceLoader";

// Strata Lane B (s9 models) — build a baked tree cluster from a Quaternius species GLB. The GLB holds
// several variant meshes, each with two materials: an OPAQUE bark trunk and a BLEND (alpha) leaf
// canopy, each with its own texture. We split every variant's primitives into a 'bark' and a 'leaf'
// bucket (kept separate so they render with their own texture), then stamp the variants across the
// placements into two merged, anchor-relative meshes (mirrors BridgeModel's GLB walk + DeckRibbon's
// anchor pivot). Texture-faithful (color lives in the textures, not vertex colors).

export interface ClusterBuffers {
	position: Float32Array;
	normal: Float32Array;
	uv: Float32Array;
	indices: Uint32Array;
}

export interface TreeCluster {
	bark: ClusterBuffers;
	leaf: ClusterBuffers;
}

interface PrimGeo {
	pos: number[]; // variant-local (centered on XZ, base near y=0)
	nor: number[];
	uv: number[];
	idx: number[];
}

export interface TreeVariant {
	name: string;  // source node name (e.g. "BirchTree_3") — used by the exclude list + debugging
	bark: PrimGeo[];
	leaf: PrimGeo[];
	height: number; // variant height in model units, for target-height scaling
}

export interface TreePlacement {
	x: number;
	z: number;
	y: number; // world ground height
	yaw: number;
	scale: number;
	species: number; // index into the species list (which GLB / textures)
	variant: number; // index into that species' variants
}

export interface ExtractOptions {
	// Variant node names to drop (e.g. a leaning/fallen or "Twisted" model). Deterministic — names
	// come straight from the GLB (probe a pack to see them). Preferred over a fragile aspect heuristic.
	excludeNames?: string[];
	// When true, ALL mesh nodes in the GLB merge into ONE variant. Needed for single-tree models that
	// split the trunk and foliage across SEPARATE nodes (e.g. a "Trank" node + a "Leaves" node) — the
	// default one-variant-per-node would otherwise yield bark-only and leaf-only "trees". Leave false
	// for multi-tree packs (Quaternius/MegaKit) where each node IS a complete tree.
	singleVariant?: boolean;
}

interface PrimBounds {
	minx: number; maxx: number; miny: number; maxy: number; minz: number; maxz: number;
}

// One mesh node's geometry, pre-recenter: prims split into bark/leaf buckets + the node's world bbox.
export interface RawMeshGeo {
	name: string;
	bark: PrimGeo[];
	leaf: PrimGeo[];
	bounds: PrimBounds;
}

function emptyBounds(): PrimBounds {
	return {minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity, minz: Infinity, maxz: -Infinity};
}

function unionInto(a: PrimBounds, b: PrimBounds): void {
	a.minx = Math.min(a.minx, b.minx); a.maxx = Math.max(a.maxx, b.maxx);
	a.miny = Math.min(a.miny, b.miny); a.maxy = Math.max(a.maxy, b.maxy);
	a.minz = Math.min(a.minz, b.minz); a.maxz = Math.max(a.maxz, b.maxz);
}

// Recenter the prims on XZ (trunk at local origin; base stays near y=0) and compute model-unit height.
// Mutates the prim positions in place. Pure aside from that.
function recenterVariant(name: string, bark: PrimGeo[], leaf: PrimGeo[], b: PrimBounds): TreeVariant {
	const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2;
	for (const g of [...bark, ...leaf]) {
		for (let i = 0; i < g.pos.length; i += 3) {
			g.pos[i] -= cx;
			g.pos[i + 2] -= cz;
		}
	}
	return {name, bark, leaf, height: Math.max(0.01, b.maxy - b.miny)};
}

/**
 * Turn the raw per-node geometry into renderable variants. Pure (testable without a GLB).
 * `singleVariant` merges every node into ONE tree (trunk + foliage that live in separate nodes);
 * otherwise each node with geometry becomes its own variant (multi-tree packs).
 */
export function assembleVariants(meshes: RawMeshGeo[], singleVariant: boolean): TreeVariant[] {
	const usable = meshes.filter(m => m.bark.length || m.leaf.length);
	if (singleVariant) {
		if (!usable.length) return [];
		const bark = usable.flatMap(m => m.bark);
		const leaf = usable.flatMap(m => m.leaf);
		const bounds = emptyBounds();
		for (const m of usable) unionInto(bounds, m.bounds);
		return [recenterVariant(usable[0].name, bark, leaf, bounds)];
	}
	return usable.map(m => recenterVariant(m.name, m.bark, m.leaf, m.bounds));
}

function resolve<T>(coll: T[], v: T | number): T {
	return typeof v === 'number' ? coll[v] : v;
}

function quatToMat4(q: number[]): Mat4 {
	const [x, y, z, w] = q;
	const m = Mat4.identity();
	const v = m.values;
	v[0] = 1 - 2 * (y * y + z * z); v[1] = 2 * (x * y + z * w);     v[2] = 2 * (x * z - y * w);
	v[4] = 2 * (x * y - z * w);     v[5] = 1 - 2 * (x * x + z * z); v[6] = 2 * (y * z + x * w);
	v[8] = 2 * (x * z + y * w);     v[9] = 2 * (y * z - x * w);     v[10] = 1 - 2 * (x * x + y * y);
	return m;
}

function nodeLocalMatrix(node: any): Mat4 {
	if (node.matrix) {
		return new Mat4(new Float64Array(node.matrix));
	}
	let mat = Mat4.identity();
	if (node.translation) mat = Mat4.translate(mat, node.translation[0], node.translation[1], node.translation[2]);
	if (node.rotation) mat = Mat4.multiply(mat, quatToMat4(node.rotation));
	if (node.scale) mat = Mat4.scale(mat, node.scale[0], node.scale[1], node.scale[2]);
	return mat;
}

function transformNormal(m: Float64Array, nx: number, ny: number, nz: number): [number, number, number] {
	const x = m[0] * nx + m[4] * ny + m[8] * nz;
	const y = m[1] * nx + m[5] * ny + m[9] * nz;
	const z = m[2] * nx + m[6] * ny + m[10] * nz;
	const len = Math.hypot(x, y, z) || 1;
	return [x / len, y / len, z / len];
}

function isLeafMaterial(gltf: any, material: any): boolean {
	const mat = material == null ? null : resolve(gltf.materials ?? [], material);
	return (mat?.alphaMode ?? 'OPAQUE') === 'BLEND';
}

/**
 * Extract the species' variant geometry from its loaded GLB. Each mesh-bearing node becomes one
 * variant, its primitives split into bark (opaque) and leaf (alpha-blend) buckets, recentered on its
 * own XZ so the trunk stands at local origin (base ~ y=0). Throws if the resource isn't loaded.
 */
export function extractTreeVariantsFromGLB(glbName: string, opts: ExtractOptions = {}): TreeVariant[] {
	const gltf = ResourceLoader.get(glbName);
	if (!gltf) throw new Error(`${glbName} resource not loaded`);

	const exclude = new Set(opts.excludeNames ?? []);
	const scene = gltf.scene != null ? resolve(gltf.scenes, gltf.scene) : gltf.scenes[0];
	const meshes: RawMeshGeo[] = [];

	const walk = (node: any, parentWorld: Mat4): void => {
		const world = Mat4.multiply(parentWorld, nodeLocalMatrix(node));

		if (node.mesh != null && !exclude.has(node.name)) {
			const mesh = resolve(gltf.meshes, node.mesh);
			const wv = world.values;
			const bark: PrimGeo[] = [];
			const leaf: PrimGeo[] = [];
			let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
			let miny = Infinity, maxy = -Infinity;

			for (const prim of mesh.primitives) {
				const pos = prim.attributes.POSITION?.value as Float32Array;
				if (!pos) continue;
				const nor = prim.attributes.NORMAL?.value as Float32Array | undefined;
				const uv = prim.attributes.TEXCOORD_0?.value as Float32Array | undefined;
				const idx = prim.indices?.value as (Uint16Array | Uint32Array) | undefined;

				const g: PrimGeo = {pos: [], nor: [], uv: [], idx: []};
				for (let i = 0; i < pos.length; i += 3) {
					const p = Vec3.applyMatrix4(new Vec3(pos[i], pos[i + 1], pos[i + 2]), world);
					g.pos.push(p.x, p.y, p.z);
					minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
					minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z);
					miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
					if (nor) {
						const [a, b, c] = transformNormal(wv, nor[i], nor[i + 1], nor[i + 2]);
						g.nor.push(a, b, c);
					} else {
						g.nor.push(0, 1, 0);
					}
				}
				const vCount = pos.length / 3;
				if (uv) {
					for (let i = 0; i < vCount * 2; i++) g.uv.push(uv[i]);
				} else {
					for (let i = 0; i < vCount; i++) g.uv.push(0, 0);
				}
				if (idx) {
					for (let i = 0; i < idx.length; i++) g.idx.push(idx[i]);
				} else {
					for (let i = 0; i < vCount; i++) g.idx.push(i);
				}

				(isLeafMaterial(gltf, prim.material) ? leaf : bark).push(g);
			}

			if (bark.length || leaf.length) {
				// Collect the raw node geometry; recenter + variant assembly happens once below (so a
				// single-tree model whose trunk/foliage live in SEPARATE nodes can be merged into one
				// tree). Bent/fallen or unwanted variants are dropped by name via opts.excludeNames.
				meshes.push({name: node.name ?? '', bark, leaf, bounds: {minx, maxx, miny, maxy, minz, maxz}});
			}
		}

		for (const child of node.children ?? []) {
			walk(resolve(gltf.nodes, child), world);
		}
	};

	for (const node of scene.nodes ?? []) {
		walk(resolve(gltf.nodes, node), Mat4.identity());
	}

	return assembleVariants(meshes, opts.singleVariant ?? false);
}

function stampBucket(
	out: {P: number[]; N: number[]; UV: number[]; I: number[]},
	prims: PrimGeo[],
	p: TreePlacement,
	anchor: [number, number]
): void {
	const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
	const dx = p.x - anchor[0], dz = p.z - anchor[1];

	for (const g of prims) {
		const base = out.P.length / 3;
		for (let i = 0; i < g.pos.length; i += 3) {
			const lx = g.pos[i] * p.scale, ly = g.pos[i + 1] * p.scale, lz = g.pos[i + 2] * p.scale;
			// rotate about Y, then translate to the placement (anchor-relative for float precision)
			const rx = lx * cos - lz * sin;
			const rz = lx * sin + lz * cos;
			out.P.push(dx + rx, p.y + ly, dz + rz);

			const nx = g.nor[i], ny = g.nor[i + 1], nz = g.nor[i + 2];
			out.N.push(nx * cos - nz * sin, ny, nx * sin + nz * cos);
		}
		for (let i = 0; i < g.uv.length; i++) out.UV.push(g.uv[i]);
		for (let i = 0; i < g.idx.length; i++) out.I.push(base + g.idx[i]);
	}
}

function pack(out: {P: number[]; N: number[]; UV: number[]; I: number[]}): ClusterBuffers {
	return {
		position: new Float32Array(out.P),
		normal: new Float32Array(out.N),
		uv: new Float32Array(out.UV),
		indices: new Uint32Array(out.I)
	};
}

/**
 * Stamp the variants across the placements into two merged, anchor-relative meshes (bark + leaf).
 * Pure: callers resolve placement.y from the terrain and choose variant/yaw/scale.
 */
export function buildTreeCluster(
	variants: TreeVariant[],
	placements: TreePlacement[],
	anchor: [number, number]
): TreeCluster {
	const bark = {P: [] as number[], N: [] as number[], UV: [] as number[], I: [] as number[]};
	const leaf = {P: [] as number[], N: [] as number[], UV: [] as number[], I: [] as number[]};

	for (const p of placements) {
		const v = variants[((p.variant % variants.length) + variants.length) % variants.length];
		if (!v) continue;
		stampBucket(bark, v.bark, p, anchor);
		stampBucket(leaf, v.leaf, p, anchor);
	}

	return {bark: pack(bark), leaf: pack(leaf)};
}

/**
 * Multi-species: bucket the placements by `species` and stamp each species' subset into its own pair
 * of merged meshes (so each renders with its own bark/leaf textures). Returns one cluster per species,
 * index-aligned to `speciesVariants` (a species with no placements yields empty buffers). Pure.
 */
export function buildSpeciesClusters(
	speciesVariants: TreeVariant[][],
	placements: TreePlacement[],
	anchor: [number, number]
): TreeCluster[] {
	return speciesVariants.map((variants, s) =>
		buildTreeCluster(variants, placements.filter(p => p.species === s), anchor)
	);
}

// Strata Lane B (s11) — the engine's per-tile 'tree' instance buffer: 6 floats per instance,
// [xLocal, y, zLocal, scale, rotation, textureId]. x/z are tile-LOCAL (add the tile origin to get
// world); y is the absolute terrain height already baked at scatter time. (InstanceStructure.Tree.)
export const TREE_INSTANCE_STRIDE = 6;

export interface DecodeTreeInstancesParams {
	raw: Float32Array;          // a tile's 'tree' LOD0 interleaved buffer
	originX: number;            // tile world position x (added to each local x)
	originZ: number;            // tile world position z (added to each local z)
	variantHeights: number[][]; // [species][variant] model-unit heights; empty species are skipped
	targetHeight: number;       // meters — each tree scaled so its model stands ~this tall
}

// Deterministic [0,1) hash of a float seed (position-derived → stable across rebuilds).
function hash01(n: number): number {
	const s = Math.sin(n) * 43758.5453;
	return s - Math.floor(s);
}

/**
 * Decode the engine's per-tile 'tree' instance buffer into TreePlacements for our model trees.
 * Species + variant + size are chosen deterministically from each tree's WORLD position (so the same
 * forest looks identical every time the tile streams in). Pure — no GLB / renderer needed (the caller
 * passes the extracted variants' heights). Trailing partial instances are ignored.
 */
export function placementsFromTreeInstanceBuffer(p: DecodeTreeInstancesParams): TreePlacement[] {
	const {raw, originX, originZ, variantHeights, targetHeight} = p;

	const usableSpecies: number[] = [];
	for (let s = 0; s < variantHeights.length; s++) {
		if (variantHeights[s].length > 0) usableSpecies.push(s);
	}
	if (usableSpecies.length === 0) return [];

	const out: TreePlacement[] = [];
	const count = Math.floor(raw.length / TREE_INSTANCE_STRIDE);

	for (let i = 0; i < count; i++) {
		const o = i * TREE_INSTANCE_STRIDE;
		const x = originX + raw[o];
		const y = raw[o + 1];
		const z = originZ + raw[o + 2];
		const rotation = raw[o + 4];

		const species = usableSpecies[Math.floor(hash01(x * 12.9898 + z * 78.233) * usableSpecies.length) % usableSpecies.length];
		const variants = variantHeights[species];
		const variant = Math.floor(hash01(x * 39.346 + z * 11.135) * variants.length) % variants.length;

		const heightScale = targetHeight / Math.max(0.01, variants[variant]);
		const scale = heightScale * (0.8 + hash01(x * 53.197 + z * 21.733) * 0.5);

		out.push({x, z, y, yaw: rotation, scale, species, variant});
	}

	return out;
}
