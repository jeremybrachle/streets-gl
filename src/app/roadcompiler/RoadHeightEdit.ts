// Road-compiler: the canonical hand-edit overlay record (roadmap §0.5 ③, §0.6, §1.5).
//
// `RoadHeightEdit` is what the RollerCoaster-Tycoon height editor reads / writes / exports. It is the
// SAME overlay schema the Checkpoint-⑤ solver's "auto-fill" will write, so manual edits and future
// automation share one format. Two hard rules from the roadmap:
//
//   1. GRAPH-NATIVE, not engine-native. An edit is keyed to OSM identity (`osmWayId` + per-point
//      `osmNodeId`), NOT to engine geometry / vertex buffers. That is what lets an edit survive a
//      re-decode, feed the solver later, and be *contributed back* to the open road graph (§0.6) —
//      it is "node id → z + class", explicitly not a renderer-private blob.
//   2. CONSUMER-AGNOSTIC. Pure data + pure helpers, zero Three.js / streets-gl / Strata imports, zero
//      SF/Bay/GGB hardcoding (§5, §0.6). Another tool must be able to read these records without the
//      game. This file therefore lives in `roadcompiler/` next to the solver, not under `app/bridge/`.
//
// Heights live per control point; the height *between* control points is smooth, grade-limited
// interpolation (never forced flat-equal) — that interpolation is a later checkpoint and reuses
// `deckHeightAt`'s ramp math; this module only owns the record + its read/write/export.
//
// Pure + unit-tested in RoadHeightEdit.test.ts; no engine deps.

import {VerticalClass} from "./VerticalClass";

/** Current on-disk / export schema version. Bump when the record shape changes incompatibly. */
export const ROAD_HEIGHT_EDIT_SCHEMA = "strata.roadHeightEdit.v1";

/**
 * One height handle along a way's centerline.
 *
 * Position is given EITHER by `osmNodeId` (the handle is snapped to a real OSM vertex — the preferred,
 * most stable, graph-native form) OR by `fractionAlong` (a free handle dropped *between* vertices, at
 * this fraction of the way's arc-length). Exactly one of the two is set; `validateControlPoint`
 * enforces it. Ordering and interpolation along the way need a single numeric position, so callers map
 * an `osmNodeId` to its `fractionAlong` via a {@link NodePositionResolver} built from the live geometry
 * — the pure module itself never needs the geometry.
 */
export interface RoadHeightControlPoint {
	/** Snapped to this OSM node (graph-native identity). Mutually exclusive with `fractionAlong`. */
	osmNodeId?: number;
	/** Free handle at this fraction [0, 1] of the way's arc-length. Mutually exclusive with `osmNodeId`. */
	fractionAlong?: number;
	/** Edited / solved absolute height at this handle, in world height units. */
	z: number;
	/** The vertical class the human asserts (or the solver assigned) here: -1 / 0 / +1. */
	verticalClass: VerticalClass;
}

/**
 * A way's full set of height handles — the overlay record for one road.
 * `points` is kept ordered by position along the way (see {@link sortControlPoints}).
 */
export interface RoadHeightEdit {
	/** OSM way identity. The overlay is keyed to OSM, not engine geometry. */
	osmWayId: number;
	/** Height handles, ordered along the centerline. */
	points: RoadHeightControlPoint[];
}

/** Maps an OSM node id to its fraction [0, 1] along the owning way, or `undefined` if not on the way. */
export type NodePositionResolver = (osmNodeId: number) => number | undefined;

const EPS = 1e-9;

function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

function isVerticalClass(v: unknown): v is VerticalClass {
	return v === -1 || v === 0 || v === 1;
}

/**
 * Validate a single control point. Returns an error string, or `null` if valid.
 * Rule: exactly one of `osmNodeId` / `fractionAlong`; `fractionAlong` in [0, 1]; finite `z`; valid class.
 */
export function validateControlPoint(p: RoadHeightControlPoint): string | null {
	const hasNode = p.osmNodeId !== undefined;
	const hasFrac = p.fractionAlong !== undefined;

	if (hasNode === hasFrac) {
		return "control point must set exactly one of osmNodeId or fractionAlong";
	}
	if (hasNode && !Number.isInteger(p.osmNodeId)) {
		return "osmNodeId must be an integer";
	}
	if (hasFrac && (!isFiniteNumber(p.fractionAlong) || p.fractionAlong! < 0 || p.fractionAlong! > 1)) {
		return "fractionAlong must be a number in [0, 1]";
	}
	if (!isFiniteNumber(p.z)) {
		return "z must be a finite number";
	}
	if (!isVerticalClass(p.verticalClass)) {
		return "verticalClass must be -1, 0, or 1";
	}
	return null;
}

/**
 * Validate a whole edit record. Returns an error string, or `null` if valid.
 * Does NOT require points to be pre-sorted (use {@link sortControlPoints}) — order is a caller concern.
 */
export function validateRoadHeightEdit(edit: RoadHeightEdit): string | null {
	if (!Number.isInteger(edit.osmWayId)) {
		return "osmWayId must be an integer";
	}
	if (!Array.isArray(edit.points)) {
		return "points must be an array";
	}
	for (let i = 0; i < edit.points.length; i++) {
		const err = validateControlPoint(edit.points[i]);
		if (err) {
			return `points[${i}]: ${err}`;
		}
	}
	return null;
}

/** Resolve a control point's numeric position [0, 1] along the way, using `resolver` for node handles. */
export function positionOf(p: RoadHeightControlPoint, resolver: NodePositionResolver): number | undefined {
	if (p.fractionAlong !== undefined) {
		return p.fractionAlong;
	}
	if (p.osmNodeId !== undefined) {
		return resolver(p.osmNodeId);
	}
	return undefined;
}

/** Two control points address the same handle iff they share an osmNodeId, or are free handles at the
 *  (numerically) same fraction. Used so re-editing a handle replaces it rather than stacking. */
export function sameControlPoint(a: RoadHeightControlPoint, b: RoadHeightControlPoint): boolean {
	if (a.osmNodeId !== undefined || b.osmNodeId !== undefined) {
		return a.osmNodeId === b.osmNodeId;
	}
	return Math.abs((a.fractionAlong ?? NaN) - (b.fractionAlong ?? NaN)) <= EPS;
}

/** Stable-sort control points ascending by their position along the way. Points whose position can't be
 *  resolved (unknown node) are kept in their original relative order, after the resolvable ones. */
export function sortControlPoints(
	points: RoadHeightControlPoint[],
	resolver: NodePositionResolver
): RoadHeightControlPoint[] {
	return points
		.map((p, i) => ({p, i, pos: positionOf(p, resolver)}))
		.sort((a, b) => {
			const ap = a.pos;
			const bp = b.pos;
			if (ap === undefined && bp === undefined) return a.i - b.i;
			if (ap === undefined) return 1;
			if (bp === undefined) return -1;
			return ap === bp ? a.i - b.i : ap - bp;
		})
		.map(e => e.p);
}

/** A fresh, empty edit for a way. */
export function createRoadHeightEdit(osmWayId: number): RoadHeightEdit {
	return {osmWayId, points: []};
}

/**
 * Insert `point`, or replace an existing handle at the same identity (so dragging a handle updates it
 * in place). Returns a NEW edit (immutable update) with points re-sorted by position.
 */
export function upsertControlPoint(
	edit: RoadHeightEdit,
	point: RoadHeightControlPoint,
	resolver: NodePositionResolver
): RoadHeightEdit {
	const kept = edit.points.filter(p => !sameControlPoint(p, point));
	kept.push(point);
	return {osmWayId: edit.osmWayId, points: sortControlPoints(kept, resolver)};
}

/** Remove the handle matching `point`'s identity. Returns a NEW edit (no-op if none matched). */
export function removeControlPoint(edit: RoadHeightEdit, point: RoadHeightControlPoint): RoadHeightEdit {
	return {osmWayId: edit.osmWayId, points: edit.points.filter(p => !sameControlPoint(p, point))};
}

/** The serialized export envelope (what the Print/export button emits, what import reads back). */
export interface RoadHeightEditExport {
	schema: typeof ROAD_HEIGHT_EDIT_SCHEMA;
	/** "© OpenStreetMap contributors" — these records are an ODbL derivative (roadmap §5). */
	attribution: string;
	edits: RoadHeightEdit[];
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/** Serialize edits to the canonical export JSON (stable, attributed, versioned). */
export function serializeEdits(edits: RoadHeightEdit[], pretty = true): string {
	const envelope: RoadHeightEditExport = {
		schema: ROAD_HEIGHT_EDIT_SCHEMA,
		attribution: OSM_ATTRIBUTION,
		edits,
	};
	return JSON.stringify(envelope, null, pretty ? 2 : undefined);
}

/**
 * Parse export JSON back into edits. Throws on a missing/unknown schema or any invalid record, so a
 * corrupt batch fails loudly rather than silently dropping edits.
 */
export function parseEdits(json: string): RoadHeightEdit[] {
	const data = JSON.parse(json) as Partial<RoadHeightEditExport>;
	if (data.schema !== ROAD_HEIGHT_EDIT_SCHEMA) {
		throw new Error(`unexpected schema ${String(data.schema)} (want ${ROAD_HEIGHT_EDIT_SCHEMA})`);
	}
	if (!Array.isArray(data.edits)) {
		throw new Error("export is missing an edits array");
	}
	for (const edit of data.edits) {
		const err = validateRoadHeightEdit(edit);
		if (err) {
			throw new Error(`invalid edit for way ${edit?.osmWayId}: ${err}`);
		}
	}
	return data.edits;
}
