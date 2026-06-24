// Visible deck ribbon — pure geometry generation for the drawn bridge deck. Given a corridor, a
// height function (height along the deck) and a precision anchor, it produces a flat ribbon that
// follows the centerline, offset ±halfWidth to each side, at the deck height. This is the VISIBLE
// twin of BridgeDeck.deckHeightAt (which the car's physics query reads): same corridor, same
// height profile, now drawn. Nothing here touches the engine — unit-tested in DeckMesh.test.ts.
//
// Positions are baked RELATIVE to `anchor` in x/z (height y stays absolute, it's small): the
// corridor lives at mercator coords ~1e7, which a float32 vertex buffer can't hold without ~1.5 m
// jitter, so the big subtraction is done here in JS double precision and the per-frame
// instances-origin shift is finished by a translate matrix in the renderer (mirrors the Car).

import {BridgeCorridor, deckHeightAt} from "./BridgeDeck";

// Returns the deck height at (x, z), or null where there is no deck (off the bridge span) so the
// ribbon can break and leave the land approaches as normal ground road.
export type HeightFn = (x: number, z: number) => number | null;

export interface DeckMeshBuffers {
	/** xyz triples; x/z relative to anchor, y absolute. */
	position: Float32Array;
	normal: Float32Array;
	/** RGB per vertex, normalized in the shader (reuses the Car material). */
	color: Uint8Array;
	/** UV pairs: u=0 (left edge) or 1 (right edge); v tiles along arc-length / (halfWidth*2). */
	uv: Float32Array;
	indices: Uint32Array;
}

// Asphalt grey.
export const DECK_COLOR: [number, number, number] = [70, 72, 78];

/**
 * The height function the drawn deck uses: the SAME smooth grade-limited profile the car drives
 * (BridgeDeck.deckHeightAt). `ground` is the level the ramps blend down to — pass a constant (e.g.
 * sea level) for a quick pass, or a function that samples the real terrain (the DEM) so the ramps
 * land on the ground exactly like the car's query does, keeping the drawn deck and the drivable
 * surface identical. Sampled along the centerline (lateral 0), so deckHeightAt never returns null.
 */
export function makeDeckHeightFn(corridor: BridgeCorridor, ground: number | HeightFn = 0): HeightFn {
	const groundAt = typeof ground === 'number' ? (): number => ground : ground;
	return (x, z) => deckHeightAt(corridor, x, z, groundAt(x, z) ?? corridor.deckHeight);
}

/**
 * Build the deck ribbon mesh. Walks the centerline, places two vertices per node (left/right of the
 * tangent by halfWidth) at heightFn(center), and stitches consecutive ribs into quads. Returns
 * empty buffers for a degenerate corridor (< 2 nodes).
 */
export function buildDeckRibbon(
	corridor: BridgeCorridor,
	heightFn: HeightFn,
	anchor: [number, number],
	color: [number, number, number] = DECK_COLOR
): DeckMeshBuffers {
	const line = corridor.centerline;

	if (line.length < 2) {
		return {
			position: new Float32Array(0),
			normal: new Float32Array(0),
			color: new Uint8Array(0),
			uv: new Float32Array(0),
			indices: new Uint32Array(0),
		};
	}

	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	const [ax, az] = anchor;
	const hw = corridor.halfWidth;
	// v tiles once every (halfWidth*2) meters so the texture is roughly square.
	const uvTileSize = hw * 2;
	let arcLength = 0;

	// Per-node vertex indices for the left/right edge, or -1 where there is no deck (heightFn null).
	// A quad is only emitted between two consecutive nodes that BOTH have a deck, so the ribbon
	// breaks cleanly over the land approaches instead of drawing a road on the ground.
	const leftIdx: number[] = new Array(line.length).fill(-1);
	const rightIdx: number[] = new Array(line.length).fill(-1);
	let vCount = 0;

	for (let i = 0; i < line.length; i++) {
		const [cx, cz] = line[i];

		// Accumulate arc-length before deciding to skip, so gaps don't reset the v coord.
		if (i > 0) {
			const [px, pz] = line[i - 1];
			arcLength += Math.hypot(cx - px, cz - pz);
		}

		const h = heightFn(cx, cz);
		if (h === null) {
			continue;
		}

		// Tangent via central difference (forward/backward at the ends).
		const [px, pz] = line[Math.max(0, i - 1)];
		const [nx, nz] = line[Math.min(line.length - 1, i + 1)];
		let tx = nx - px;
		let tz = nz - pz;
		const tlen = Math.hypot(tx, tz) || 1;
		tx /= tlen;
		tz /= tlen;

		// Left normal in the xz plane (perpendicular to the tangent).
		const lx = -tz;
		const lz = tx;

		// Left vertex, then right vertex. x/z relative to the anchor; y absolute.
		positions.push(cx - ax + lx * hw, h, cz - az + lz * hw);
		positions.push(cx - ax - lx * hw, h, cz - az - lz * hw);

		// Near-flat deck: up normals are a fine approximation for the gentle ramps.
		normals.push(0, 1, 0, 0, 1, 0);
		colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);

		// u=0 at the left edge, u=1 at the right; v tiles along arc-length.
		const v = arcLength / uvTileSize;
		uvs.push(0, v, 1, v);

		leftIdx[i] = vCount++;
		rightIdx[i] = vCount++;
	}

	for (let i = 0; i < line.length - 1; i++) {
		if (leftIdx[i] < 0 || leftIdx[i + 1] < 0) {
			continue; // a gap (no deck at one end of this segment)
		}

		const l0 = leftIdx[i];
		const r0 = rightIdx[i];
		const l1 = leftIdx[i + 1];
		const r1 = rightIdx[i + 1];

		// Two triangles per quad (winding consistent; the Car material culls nothing anyway).
		indices.push(l0, l1, r0);
		indices.push(r0, l1, r1);
	}

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Uint8Array(colors),
		uv: new Float32Array(uvs),
		indices: new Uint32Array(indices),
	};
}
