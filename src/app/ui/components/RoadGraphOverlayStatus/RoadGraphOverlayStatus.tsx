import React, {useEffect, useState} from "react";
import styles from './RoadGraphOverlayStatus.scss';
import {roadGraphOverlay} from "~/app/roadcompiler/RoadGraphOverlayRegistry";
import Config from "~/app/Config";

// Strata P2.5 — a small bottom-center indicator for the road-graph overlay's dynamic load. When you fly to
// a city that isn't bundled and toggle the overlay (KeyO), the clean OSM graph is fetched from Overpass;
// this shows "Loading road graph…" while that one-shot fetch runs, and briefly reports a failure. The
// overlay state lives OUTSIDE React (the render pass / registry singleton), so we poll it each frame and
// re-render only when the visible bits change. Self-gates on Config.RoadGraphOverlay.
const RoadGraphOverlayStatus: React.FC = () => {
	const [, bump] = useState(0);

	useEffect(() => {
		let raf = 0;
		let sig = "";
		const tick = (): void => {
			// Signature of everything the indicator draws — re-render only when it changes.
			const next = `${roadGraphOverlay.visible}|${roadGraphOverlay.loading}|${roadGraphOverlay.loadingLabel}|${roadGraphOverlay.lastError ?? ""}`;
			if (next !== sig) {
				sig = next;
				bump(n => n + 1);
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	if (!Config.RoadGraphOverlay || !roadGraphOverlay.visible) {
		return null;
	}

	if (roadGraphOverlay.loading) {
		return (
			<div className={styles.status}>
				<span className={styles.status__spinner}/>
				<span>Loading road graph{roadGraphOverlay.loadingLabel ? ` — ${roadGraphOverlay.loadingLabel}` : ""}…</span>
			</div>
		);
	}

	if (roadGraphOverlay.lastError) {
		return (
			<div className={`${styles.status} ${styles['status--error']}`}>
				<span>Road graph unavailable: {roadGraphOverlay.lastError}</span>
			</div>
		);
	}

	return null;
};

export default RoadGraphOverlayStatus;
