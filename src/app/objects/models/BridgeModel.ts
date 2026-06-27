import Mat4 from "~/lib/math/Mat4";
import Vec3 from "~/lib/math/Vec3";
import AABB3D from "~/lib/math/AABB3D";
import ResourceLoader from "~/app/world/ResourceLoader";
import {CarModelBuffers} from "~/app/objects/models/CarModel";
import {Polygon2D, extractTowerLegFootprints} from "~/app/collision/towerFootprints";

// Strata Lane B Increment 9 — the Golden Gate hero MODEL (CC-BY "San Francisco Bridge" by rendorshen,
// product branch only). A decoupled VISUAL prop: the analytic deck (BridgeDeck) stays the drivable
// surface; this just sits over it. Every primitive of the GLB is merged into ONE static mesh with the
// material baseColorFactor baked to a vertex color (the model is fully factor-coloured — international
// orange structure, black road, grey stone — so NO texture pipeline is needed). The mesh is
// normalized so its longest horizontal axis = local +X (the span axis) and recentered on its own
// bbox, so the panel's place/scale/yaw/stretch sliders act predictably. Rendered by
// GBufferPass.renderBridgeModel with the existing vertex-colour car material.

export interface BridgeModel {
	buffers: CarModelBuffers;
	/** Longest horizontal extent (local +X) after normalization — the span axis length in model units. */
	spanUnits: number;
	/** Tower-leg footprints (model-local XZ convex polygons) for collision — see extractTowerLegFootprints. */
	legFootprints: Polygon2D[];
}

function resolve<T>(coll: T[], v: T | number): T {
	return typeof v === 'number' ? coll[v] : v;
}

function quatToMat4(q: number[]): Mat4 {
	const [x, y, z, w] = q;
	const m = Mat4.identity();
	const v = m.values; // column-major
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

function toByte(linear: number): number {
	const c = Math.max(0, Math.min(1, linear));
	return Math.round(Math.pow(c, 1 / 2.2) * 255); // linear -> approx sRGB so it isn't muddy
}

function materialColor(gltf: any, material: any): [number, number, number] {
	const mat = material == null ? null : resolve(gltf.materials ?? [], material);
	const f = mat?.pbrMetallicRoughness?.baseColorFactor;
	if (f) return [toByte(f[0]), toByte(f[1]), toByte(f[2])];
	return [128, 128, 128];
}

/**
 * Build the merged, normalized GGB hero mesh from the loaded `ggbBridge` GLB. Throws if the resource
 * isn't loaded — callers (BridgeModelObject) try/catch so a missing/failed model never breaks drive.
 */
export function createBridgeModelFromGLB(): BridgeModel {
	const gltf = ResourceLoader.get('ggbBridge');
	if (!gltf) throw new Error('ggbBridge resource not loaded');

	const P: number[] = [], N: number[] = [], C: number[] = [], I: number[] = [];
	const scene = gltf.scene != null ? resolve(gltf.scenes, gltf.scene) : gltf.scenes[0];

	const walk = (node: any, parentWorld: Mat4): void => {
		const world = Mat4.multiply(parentWorld, nodeLocalMatrix(node));

		if (node.mesh != null) {
			const mesh = resolve(gltf.meshes, node.mesh);
			const wv = world.values;

			for (const prim of mesh.primitives) {
				const pos = prim.attributes.POSITION?.value as Float32Array;
				if (!pos) continue;
				const nor = prim.attributes.NORMAL?.value as Float32Array | undefined;
				const idx = prim.indices?.value as (Uint16Array | Uint32Array) | undefined;
				const [cr, cg, cb] = materialColor(gltf, prim.material);
				const base = P.length / 3;

				for (let i = 0; i < pos.length; i += 3) {
					const p = Vec3.applyMatrix4(new Vec3(pos[i], pos[i + 1], pos[i + 2]), world);
					P.push(p.x, p.y, p.z);

					if (nor) {
						const [nx, ny, nz] = transformNormal(wv, nor[i], nor[i + 1], nor[i + 2]);
						N.push(nx, ny, nz);
					} else {
						N.push(0, 1, 0);
					}

					C.push(cr, cg, cb);
				}

				if (idx) {
					for (let i = 0; i < idx.length; i++) I.push(base + idx[i]);
				} else {
					const count = pos.length / 3;
					for (let i = 0; i < count; i++) I.push(base + i);
				}
			}
		}

		for (const child of node.children ?? []) {
			walk(resolve(gltf.nodes, child), world);
		}
	};

	for (const node of scene.nodes ?? []) {
		walk(resolve(gltf.nodes, node), Mat4.identity());
	}

	// Baked-space bbox.
	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	for (let i = 0; i < P.length; i += 3) {
		minx = Math.min(minx, P[i]);     maxx = Math.max(maxx, P[i]);
		miny = Math.min(miny, P[i + 1]); maxy = Math.max(maxy, P[i + 1]);
		minz = Math.min(minz, P[i + 2]); maxz = Math.max(maxz, P[i + 2]);
	}

	const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
	const extX = maxx - minx, extZ = maxz - minz;
	// Normalize: longest horizontal axis -> local +X (so modelStretch lengthens the span, modelYaw
	// aligns it). If Z is longer, swap X/Z by a 90° turn about up (x'=z, z'=-x) for points + normals.
	const swapXZ = extZ > extX;

	const pos = new Float32Array(P.length);
	const nor = new Float32Array(N.length);
	let nminx = Infinity, nminy = Infinity, nminz = Infinity;
	let nmaxx = -Infinity, nmaxy = -Infinity, nmaxz = -Infinity;
	for (let i = 0; i < P.length; i += 3) {
		const px = P[i] - cx, py = P[i + 1] - cy, pz = P[i + 2] - cz;
		const ox = swapXZ ? pz : px;
		const oz = swapXZ ? -px : pz;
		pos[i] = ox; pos[i + 1] = py; pos[i + 2] = oz;
		const nx = N[i], ny = N[i + 1], nz = N[i + 2];
		nor[i] = swapXZ ? nz : nx; nor[i + 1] = ny; nor[i + 2] = swapXZ ? -nx : nz;
		nminx = Math.min(nminx, ox); nmaxx = Math.max(nmaxx, ox);
		nminy = Math.min(nminy, py); nmaxy = Math.max(nmaxy, py);
		nminz = Math.min(nminz, oz); nmaxz = Math.max(nmaxz, oz);
	}

	const buffers: CarModelBuffers = {
		position: pos,
		normal: nor,
		color: new Uint8Array(C),
		indices: new Uint32Array(I),
		boundingBox: new AABB3D(new Vec3(nminx, nminy, nminz), new Vec3(nmaxx, nmaxy, nmaxz))
	};

	// Tower leg footprints (model-local XZ) for collision — the two towers are dense, full-height
	// vertex clusters; each splits into two legs straddling the roadway, so the car drives between them.
	const legFootprints = extractTowerLegFootprints(pos);

	return {buffers, spanUnits: nmaxx - nminx, legFootprints};
}
