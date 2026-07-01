import Mat4 from "~/lib/math/Mat4";
import Vec3 from "~/lib/math/Vec3";
import ResourceLoader from "~/app/world/ResourceLoader";
import {BuildingPlacement, SourceDims} from "./buildingPlacement";

// Strata Lane B (s13) — BUILDINGS, increment B2: bake a discrete building out of the downtown GLB.
//
// downtown.glb is a KIT of ~18 NAMED buildings (Downtown_Residential_3, Downtown_ModernOffice_2, …),
// each a parent node whose child meshes are split across several facade materials, every material
// TEXTURED (no baseColorFactor). So unlike the GGB hero (factor → vertex colours) this needs the
// textured path proved with the s9/s10 trees: group a building's primitives by their baseColorTexture
// and render each group with its own texture. Textures are pulled from the LOADED GLB at runtime
// (loaders.gl decodes images in-browser → material.pbrMetallicRoughness.baseColorTexture.texture.
// source.image), so all 18 buildings work with no offline PNG extraction.
//
// Geometry is baked through each node's world matrix (mirrors BridgeModel / TreeClusterModel), then
// the whole building is recentered on its XZ footprint with its base dropped to y=0 — so the renderer
// can place it with translate(footprintCenter, groundY) · yRotate(yaw) · scale (see buildingPlacement).

export interface RawPrim {
	textureKey: string; // identity of the prim's baseColorTexture (bucket key)
	pos: number[];      // world-baked (recentered later)
	nor: number[];
	uv: number[];
	idx: number[];
}

/** One merged texture-group of a building: a draw with a single facade texture. */
export interface BuildingPart {
	textureKey: string;
	position: Float32Array;
	normal: Float32Array;
	uv: Float32Array;
	indices: Uint32Array;
}

export interface BuildedBuilding {
	name: string;
	parts: BuildingPart[];
	/** Local extents after recenter: width(X), depth(Z), height(Y), base at y=0, XZ-centered. */
	dims: SourceDims;
}

interface Bounds {
	minx: number; maxx: number; miny: number; maxy: number; minz: number; maxz: number;
}

function emptyBounds(): Bounds {
	return {minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity, minz: Infinity, maxz: -Infinity};
}

function accumulate(b: Bounds, x: number, y: number, z: number): void {
	if (x < b.minx) b.minx = x; if (x > b.maxx) b.maxx = x;
	if (y < b.miny) b.miny = y; if (y > b.maxy) b.maxy = y;
	if (z < b.minz) b.minz = z; if (z > b.maxz) b.maxz = z;
}

/**
 * Merge raw primitives into one BuildingPart per textureKey (concatenating with index offsets), and
 * return the union XZ/Y bounds. Pure — testable without a GLB. Part order follows first appearance.
 */
export function mergePartsByTexture(prims: RawPrim[]): {parts: BuildingPart[]; bounds: Bounds} {
	const bounds = emptyBounds();
	const groups = new Map<string, {P: number[]; N: number[]; UV: number[]; I: number[]}>();

	for (const prim of prims) {
		let g = groups.get(prim.textureKey);
		if (!g) {
			g = {P: [], N: [], UV: [], I: []};
			groups.set(prim.textureKey, g);
		}
		const base = g.P.length / 3;
		for (let i = 0; i < prim.pos.length; i += 3) {
			g.P.push(prim.pos[i], prim.pos[i + 1], prim.pos[i + 2]);
			accumulate(bounds, prim.pos[i], prim.pos[i + 1], prim.pos[i + 2]);
		}
		for (let i = 0; i < prim.nor.length; i++) g.N.push(prim.nor[i]);
		for (let i = 0; i < prim.uv.length; i++) g.UV.push(prim.uv[i]);
		for (let i = 0; i < prim.idx.length; i++) g.I.push(base + prim.idx[i]);
	}

	// Map iteration follows insertion order = each texture's first appearance, so parts keep that order.
	const parts: BuildingPart[] = [];
	for (const [key, g] of groups) {
		parts.push({
			textureKey: key,
			position: new Float32Array(g.P),
			normal: new Float32Array(g.N),
			uv: new Float32Array(g.UV),
			indices: new Uint32Array(g.I)
		});
	}

	return {parts, bounds};
}

/**
 * Recenter a building's parts in place: shift XZ so the footprint center sits at the local origin and
 * drop the base to y=0 (subtract miny). Returns the local dims (width/depth/height). Pure aside from
 * mutating the part positions. A building with no geometry yields zero dims.
 */
export function recenterBuilding(parts: BuildingPart[], bounds: Bounds): SourceDims {
	if (!isFinite(bounds.minx)) {
		return {width: 0, depth: 0, height: 0};
	}
	const cx = (bounds.minx + bounds.maxx) / 2;
	const cz = (bounds.minz + bounds.maxz) / 2;
	const baseY = bounds.miny;

	for (const part of parts) {
		const p = part.position;
		for (let i = 0; i < p.length; i += 3) {
			p[i] -= cx;
			p[i + 1] -= baseY;
			p[i + 2] -= cz;
		}
	}

	return {
		width: bounds.maxx - bounds.minx,
		depth: bounds.maxz - bounds.minz,
		height: bounds.maxy - bounds.miny
	};
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
	if (node.matrix) return new Mat4(new Float64Array(node.matrix));
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

// Resolve a primitive's baseColorTexture: a stable bucket key + the decoded image object (in-browser).
// loaders.gl post-process attaches material.pbrMetallicRoughness.baseColorTexture.texture.source.image.
function resolveTexture(gltf: any, material: any): {key: string; image: any} | null {
	const mat = material == null ? null : resolve(gltf.materials ?? [], material);
	const tex = mat?.pbrMetallicRoughness?.baseColorTexture?.texture;
	if (!tex) return null;
	const source = tex.source;
	const image = source?.image ?? source;
	const key = tex.id ?? source?.id ?? mat?.name ?? 'tex';
	return {key, image};
}

/** A building's geometry plus the GPU-ready images keyed by textureKey (for the renderer to upload). */
export interface ExtractedBuildings {
	buildings: BuildedBuilding[];
	images: Map<string, any>;
}

/**
 * Extract every named building from the downtown GLB: each top-level node whose name starts with
 * "Downtown_" (and isn't a per-material sub-node) becomes one BuildedBuilding, its primitives baked
 * through world matrices, grouped by facade texture, recentered. Returns the buildings + an image map
 * (textureKey → decoded image) so the renderer can create one Texture2D per key. Throws if unloaded.
 */
export function extractBuildingsFromGLB(glbName: string): ExtractedBuildings {
	const gltf = ResourceLoader.get(glbName) as any;
	if (!gltf) throw new Error(`${glbName} resource not loaded`);

	const scene = gltf.scene != null ? resolve(gltf.scenes, gltf.scene) : gltf.scenes[0];
	const images = new Map<string, any>();
	const buildings: BuildedBuilding[] = [];

	// Gather a building's prims by walking its subtree, baking world matrices from the building root.
	const gatherSubtree = (node: any, parentWorld: Mat4, prims: RawPrim[]): void => {
		const world = Mat4.multiply(parentWorld, nodeLocalMatrix(node));
		if (node.mesh != null) {
			const mesh = resolve(gltf.meshes, node.mesh);
			const wv = world.values;
			for (const prim of mesh.primitives) {
				const pos = prim.attributes.POSITION?.value as Float32Array;
				if (!pos) continue;
				const nor = prim.attributes.NORMAL?.value as Float32Array | undefined;
				const uv = prim.attributes.TEXCOORD_0?.value as Float32Array | undefined;
				const idx = prim.indices?.value as (Uint16Array | Uint32Array) | undefined;
				const tex = resolveTexture(gltf, prim.material);
				const textureKey = tex?.key ?? 'untextured';
				if (tex && !images.has(textureKey)) images.set(textureKey, tex.image);

				const g: RawPrim = {textureKey, pos: [], nor: [], uv: [], idx: []};
				for (let i = 0; i < pos.length; i += 3) {
					const p = Vec3.applyMatrix4(new Vec3(pos[i], pos[i + 1], pos[i + 2]), world);
					g.pos.push(p.x, p.y, p.z);
					if (nor) {
						const [a, b, c] = transformNormal(wv, nor[i], nor[i + 1], nor[i + 2]);
						g.nor.push(a, b, c);
					} else {
						g.nor.push(0, 1, 0);
					}
				}
				const vCount = pos.length / 3;
				if (uv) for (let i = 0; i < vCount * 2; i++) g.uv.push(uv[i]);
				else for (let i = 0; i < vCount; i++) g.uv.push(0, 0);
				if (idx) for (let i = 0; i < idx.length; i++) g.idx.push(idx[i]);
				else for (let i = 0; i < vCount; i++) g.idx.push(i);

				prims.push(g);
			}
		}
		for (const child of node.children ?? []) {
			gatherSubtree(resolve(gltf.nodes, child), world, prims);
		}
	};

	const isBuildingRoot = (name: string | undefined): boolean =>
		!!name && /^Downtown_[A-Za-z]/.test(name) && !/_FLR_|_0$|Object_/.test(name);

	const walk = (node: any, parentWorld: Mat4): void => {
		const world = Mat4.multiply(parentWorld, nodeLocalMatrix(node));
		if (isBuildingRoot(node.name)) {
			const prims: RawPrim[] = [];
			// Bake the subtree relative to scene root (parentWorld already folded in) so the building
			// keeps its authored orientation; recenter handles the local origin.
			gatherSubtree(node, parentWorld, prims);
			if (prims.length) {
				const {parts, bounds} = mergePartsByTexture(prims);
				const dims = recenterBuilding(parts, bounds);
				buildings.push({name: node.name, parts, dims});
			}
			return; // building roots aren't nested
		}
		for (const child of node.children ?? []) {
			walk(resolve(gltf.nodes, child), world);
		}
	};

	for (const node of scene.nodes ?? []) {
		walk(resolve(gltf.nodes, node), Mat4.identity());
	}

	return {buildings, images};
}

// ---------------------------------------------------------------------------------------------------
// Cluster baking (B3) — stamp many placed buildings into ONE merged mesh per facade texture, so a tile
// full of buildings draws in ≤ (number of distinct textures) draw calls, not one per building. Mirrors
// TreeClusterModel.buildSpeciesClusters but grouped by textureKey and with a non-uniform (per-axis)
// scale from the footprint fit. Anchor-relative for float precision (the tile world position).

export interface ClusterBuffers {
	position: Float32Array;
	normal: Float32Array;
	uv: Float32Array;
	indices: Uint32Array;
}

/** One building dropped on a footprint: which kit building, and the fitted transform (buildingPlacement). */
export interface BuildingInstance {
	buildingIndex: number;
	placement: BuildingPlacement;
}

interface Accum {
	P: number[];
	N: number[];
	UV: number[];
	I: number[];
}

function stampPart(out: Accum, part: BuildingPart, p: BuildingPlacement, anchor: [number, number]): void {
	const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
	const dx = p.anchorX - anchor[0];
	const dz = p.anchorZ - anchor[1];
	const pos = part.position, nor = part.normal, uv = part.uv, idx = part.indices;
	const base = out.P.length / 3;

	for (let i = 0; i < pos.length; i += 3) {
		// scale (per-axis) → rotate about Y → translate to the placement (anchor-relative XZ, absolute Y)
		const sx = pos[i] * p.scaleX, sy = pos[i + 1] * p.scaleY, sz = pos[i + 2] * p.scaleZ;
		out.P.push(dx + (sx * cos - sz * sin), p.anchorY + sy, dz + (sx * sin + sz * cos));

		const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
		out.N.push(nx * cos - nz * sin, ny, nx * sin + nz * cos);
	}
	for (let i = 0; i < uv.length; i++) out.UV.push(uv[i]);
	for (let i = 0; i < idx.length; i++) out.I.push(base + idx[i]);
}

/**
 * Stamp the placed buildings into one merged mesh per facade texture. Returns a map textureKey →
 * buffers; the renderer creates one material (with that texture's image) + one draw per entry. Pure:
 * callers resolve placement (buildingPlacement) and pick the building (buildingMatcher).
 */
export function buildBuildingClusters(
	buildings: readonly BuildedBuilding[],
	instances: readonly BuildingInstance[],
	anchor: [number, number]
): Map<string, ClusterBuffers> {
	const buckets = new Map<string, Accum>();

	for (const inst of instances) {
		const b = buildings[inst.buildingIndex];
		if (!b) continue;
		for (const part of b.parts) {
			let acc = buckets.get(part.textureKey);
			if (!acc) {
				acc = {P: [], N: [], UV: [], I: []};
				buckets.set(part.textureKey, acc);
			}
			stampPart(acc, part, inst.placement, anchor);
		}
	}

	const out = new Map<string, ClusterBuffers>();
	for (const [key, acc] of buckets) {
		out.set(key, {
			position: new Float32Array(acc.P),
			normal: new Float32Array(acc.N),
			uv: new Float32Array(acc.UV),
			indices: new Uint32Array(acc.I)
		});
	}
	return out;
}
