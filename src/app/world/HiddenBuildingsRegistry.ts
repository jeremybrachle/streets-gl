// Strata Lane B — user-hidden buildings ("delete from view"). A live, persisted set of packed
// feature ids (Tile.packFeatureId(osmId, osmType)) the user has removed from the map by clicking them
// + pressing Delete. The engine already supports an instant per-building hide (Tile.hideBuilding,
// which patches the extruded-mesh display buffer — no re-mesh); this registry just remembers WHICH
// buildings so the hide survives tiles streaming out/in and page reloads (TileObjectsSystem re-applies
// it on tile load). Deliberately a plain singleton (like bridgeRegistry) so UI edits take effect at
// once. Undo pops the most recent hide; restoreAll clears everything.

const STORAGE_KEY = 'strata.hiddenBuildings.v1';

export class HiddenBuildingsRegistry {
	// Insertion order preserved (Set) so undo can pop the most recently hidden building.
	private readonly hidden = new Set<number>();

	public constructor() {
		this.load();
	}

	public isHidden(packedId: number): boolean {
		return this.hidden.has(packedId);
	}

	public count(): number {
		return this.hidden.size;
	}

	public list(): number[] {
		return [...this.hidden];
	}

	/** Hide a building (idempotent). Persists. */
	public hide(packedId: number): void {
		if (this.hidden.has(packedId)) {
			return;
		}
		this.hidden.add(packedId);
		this.save();
	}

	/** Un-hide the most recently hidden building; returns its packed id, or null if none. Persists. */
	public undoLast(): number | null {
		if (this.hidden.size === 0) {
			return null;
		}
		let last = 0;
		for (const id of this.hidden) {
			last = id; // Set iterates in insertion order; the final value is the newest
		}
		this.hidden.delete(last);
		this.save();
		return last;
	}

	/** Clear every hidden building. Returns the ids that were hidden (so callers can re-show them). */
	public clear(): number[] {
		const all = [...this.hidden];
		this.hidden.clear();
		this.save();
		return all;
	}

	private save(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}
		// Packed ids are < 2^52 so they round-trip exactly through JSON numbers.
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.hidden]));
	}

	private load(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return;
		}
		try {
			const ids = JSON.parse(raw) as number[];
			if (Array.isArray(ids)) {
				for (const id of ids) {
					if (typeof id === 'number') {
						this.hidden.add(id);
					}
				}
			}
		} catch {
			// Corrupt payload — keep an empty set.
		}
	}
}

export const hiddenBuildingsRegistry = new HiddenBuildingsRegistry();
