// Strata Lane B — small persisted UI preferences for movable/hideable panels (the "X buildings
// hidden" menu and the Bridge Builder dev panel). Mirrors the bridgeRegistry / hiddenBuildingsRegistry
// pattern: a plain singleton backed by one localStorage key, keyed by a stable panel id, so a dragged
// position and a collapsed/hidden state survive reloads. Deliberately NOT routed through the engine's
// settings storage — it's UI chrome, not a render/world setting, and this keeps it self-contained.

const STORAGE_KEY = 'strata.uiPrefs.v1';

export interface PanelPref {
	/** Last dragged position (viewport px from top-left). Absent = use the panel's default CSS spot. */
	x?: number;
	y?: number;
	/** Collapsed/hidden by the user (a small launcher pill is shown instead). */
	hidden?: boolean;
}

class UIPrefsStore {
	private prefs: Record<string, PanelPref> = {};

	public constructor() {
		this.load();
	}

	/** Current prefs for a panel (a copy, never the live object). */
	public get(id: string): PanelPref {
		return {...this.prefs[id]};
	}

	public setPosition(id: string, x: number, y: number): void {
		this.prefs[id] = {...this.prefs[id], x, y};
		this.save();
	}

	public setHidden(id: string, hidden: boolean): void {
		this.prefs[id] = {...this.prefs[id], hidden};
		this.save();
	}

	private save(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
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
			const data = JSON.parse(raw) as Record<string, PanelPref>;
			if (data && typeof data === 'object') {
				this.prefs = data;
			}
		} catch {
			// Corrupt payload — keep defaults.
		}
	}
}

export const uiPrefs = new UIPrefsStore();
