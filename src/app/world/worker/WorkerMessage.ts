export namespace WorkerMessage {
	export enum ToWorkerType {
		Start,
		Height,
		// Road-compiler (Checkpoint ③ step 3): push the set of height-edited way ids to this worker so it
		// suppresses their flat draped roadway at decode (no ghost under the lifted ribbon). Broadcast to
		// every worker; carries no tile.
		SetEditedWays
	}

	export interface ToWorker {
		type: ToWorkerType;
		tile: [number, number];
		overpassEndpoint?: string;
		tileServerEndpoint?: string;
		vectorTilesEndpointTemplate?: string;
		isTerrainHeightEnabled?: boolean;
		height?: Float64Array;
		editedWayIds?: number[];
	}

	export enum FromWorkerType {
		Success,
		Error,
		RequestHeight
	}

	export interface FromWorker {
		type: FromWorkerType;
		tile: [number, number];
		payload?: any;
	}
}
