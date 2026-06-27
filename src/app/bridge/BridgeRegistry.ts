import {BridgeCorridor, deckHeightAt} from "./BridgeDeck";
import {GOLDEN_GATE_CORRIDOR} from "./corridors/GoldenGate";
import {BAY_BRIDGE_CORRIDOR} from "./corridors/BayBridge";

// The live override store — the RollerCoaster-Tycoon builder's single source of truth. The drive
// physics reads it every frame (hot path), the bridge panel edits it. Deliberately a plain
// singleton with no React/atom plumbing so edits take effect on the very next frame, no recompile.
// Tuned values persist to localStorage (Save) so playtested tweaks survive a reload.

const STORAGE_KEY = 'strata.bridge.overrides.v1';

const TUNABLE_KEYS = [
	'deckHeight', 'rampLength', 'halfWidth', 'maxGrade',
	// Hero-model transform (panel sliders) — persisted so a placed model survives reload.
	'modelScale', 'modelStretch', 'modelYaw', 'modelOffsetX', 'modelOffsetY', 'modelOffsetZ',
] as const;
type TunableKey = typeof TUNABLE_KEYS[number];
type CorridorTunables = Record<TunableKey, number>;

export class BridgeRegistry {
	/**
	 * "Course mode" / bowling-lane bumpers. OFF (default) keeps the open-world DEM driving exactly
	 * as it is today; ON makes bridge corridors drivable as elevated decks.
	 */
	public courseMode = false;
	public corridors: BridgeCorridor[] = [GOLDEN_GATE_CORRIDOR, BAY_BRIDGE_CORRIDOR];

	// Bumped whenever a tunable or courseMode changes (the panel calls markDirty). The visible deck
	// mesh (DeckRibbon) watches this and rebuilds when it changes, so slider drags reshape the drawn
	// road live. The car's physics query reads the corridors directly and doesn't need it.
	public revision = 0;

	// Snapshot of the code-default tunables, taken before any saved override is applied, so Reset
	// can restore them live.
	private readonly defaults = new Map<string, CorridorTunables>();

	public constructor() {
		this.captureDefaults();
		this.load();
	}

	/** Signal that a corridor tunable or courseMode changed so the visible deck mesh rebuilds. */
	public markDirty(): void {
		this.revision++;
	}

	/** Deck height to drive on at world (x, z) given the DEM groundY, or null if off every corridor. */
	public query(x: number, z: number, groundY: number): number | null {
		let best: number | null = null;

		for (const corridor of this.corridors) {
			const h = deckHeightAt(corridor, x, z, groundY);
			if (h !== null && (best === null || h > best)) {
				best = h;
			}
		}

		return best;
	}

	/** Snapshot current tunables as the restore-to-defaults baseline (called once at construction). */
	public captureDefaults(): void {
		this.defaults.clear();
		for (const corridor of this.corridors) {
			if (corridor.id) {
				this.defaults.set(corridor.id, snapshot(corridor));
			}
		}
	}

	/** Persist the current course-mode flag + per-corridor tunables to localStorage. */
	public save(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}

		const overrides: Record<string, CorridorTunables> = {};
		for (const corridor of this.corridors) {
			if (corridor.id) {
				overrides[corridor.id] = snapshot(corridor);
			}
		}

		localStorage.setItem(STORAGE_KEY, JSON.stringify({courseMode: this.courseMode, overrides}));
	}

	/** Apply any persisted overrides over the seeded corridors (called once at construction). */
	public load(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}

		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return;
		}

		try {
			const data = JSON.parse(raw) as {courseMode?: boolean; overrides?: Record<string, Partial<CorridorTunables>>};

			if (typeof data.courseMode === 'boolean') {
				this.courseMode = data.courseMode;
			}

			for (const corridor of this.corridors) {
				const override = corridor.id ? data.overrides?.[corridor.id] : undefined;
				if (override) {
					applyTunables(corridor, override);
				}
			}
		} catch {
			// Corrupt/old payload — ignore and keep code defaults.
		}
	}

	/** Restore code-default tunables and drop the saved override. */
	public resetToDefaults(): void {
		for (const corridor of this.corridors) {
			const def = corridor.id ? this.defaults.get(corridor.id) : undefined;
			if (def) {
				applyTunables(corridor, def);
			}
		}

		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem(STORAGE_KEY);
		}
	}
}

function snapshot(corridor: BridgeCorridor): CorridorTunables {
	const out = {} as CorridorTunables;
	for (const key of TUNABLE_KEYS) {
		out[key] = corridor[key] as number;
	}
	return out;
}

function applyTunables(corridor: BridgeCorridor, values: Partial<CorridorTunables>): void {
	for (const key of TUNABLE_KEYS) {
		const v = values[key];
		if (typeof v === 'number') {
			corridor[key] = v;
		}
	}
}

export const bridgeRegistry = new BridgeRegistry();
