// Persistent cache for dynamically-fetched road-graph areas (P2.5). Once a city's clean OSM graph is
// pulled from Overpass, we keep it so a revisit is instant and we never re-hit the API. Two layers:
//  - an in-memory Map for instant same-session revisits;
//  - IndexedDB (not localStorage — the assets are multi-hundred-KB to multi-MB, past localStorage's
//    ~5 MB per-origin quota) so caches survive a page reload / offline.
//
// Keyed by the snapped area key (RoadGraphAsset.areaKey). Stores the ASSEMBLED RoadGraphAsset (already
// filtered/deduped), not the raw Overpass response, so a cache hit skips both the network AND the assemble.
// Pure-ish I/O helper — no engine deps; safe to call from the main thread. Failures degrade to "no cache"
// (we just re-fetch) rather than throwing, so a blocked/absent IndexedDB never breaks the overlay.

import {RoadGraphAsset} from "./RoadGraphAsset";

const DB_NAME = "strata-roadgraph";
const STORE = "areas";
const DB_VERSION = 1;

const memory = new Map<string, RoadGraphAsset>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
	if (dbPromise) {
		return dbPromise;
	}

	dbPromise = new Promise<IDBDatabase | null>(resolve => {
		if (typeof indexedDB === "undefined") {
			resolve(null);
			return;
		}
		try {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = (): void => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.createObjectStore(STORE);
				}
			};
			req.onsuccess = (): void => resolve(req.result);
			req.onerror = (): void => resolve(null);
		} catch {
			resolve(null);
		}
	});

	return dbPromise;
}

/** Look up a cached asset for an area key (in-memory first, then IndexedDB). null = not cached. */
export async function cacheGet(key: string): Promise<RoadGraphAsset | null> {
	const mem = memory.get(key);
	if (mem) {
		return mem;
	}

	const db = await openDB();
	if (!db) {
		return null;
	}

	return new Promise<RoadGraphAsset | null>(resolve => {
		try {
			const tx = db.transaction(STORE, "readonly");
			const req = tx.objectStore(STORE).get(key);
			req.onsuccess = (): void => {
				const asset = req.result as RoadGraphAsset | undefined;
				if (asset) {
					memory.set(key, asset);
				}
				resolve(asset ?? null);
			};
			req.onerror = (): void => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

/** Store an assembled asset for an area key (both layers). Best-effort — never throws. */
export async function cachePut(key: string, asset: RoadGraphAsset): Promise<void> {
	memory.set(key, asset);

	const db = await openDB();
	if (!db) {
		return;
	}

	try {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).put(asset, key);
	} catch {
		// IndexedDB write failed (quota, private mode, ...) — the in-memory copy still serves this session.
	}
}
