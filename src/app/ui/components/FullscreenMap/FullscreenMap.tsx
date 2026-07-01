import React, {useCallback, useEffect, useRef} from "react";
import styles from './FullscreenMap.scss';
import {carTelemetry} from "~/app/controls/CarTelemetry";
import {roadGraphOverlay} from "~/app/roadcompiler/RoadGraphOverlayRegistry";
import {routeRegistry} from "~/app/roadcompiler/RouteRegistry";

// Strata GPS — the full-screen "magnify" map, opened by clicking the minimap. It draws the same clean
// frame-E road graph (roadGraphOverlay.frameEPolylines, blue) over a large pannable/zoomable top-down view,
// plus the live car (cyan), the picked destination (red), and the computed A* route (yellow). CLICK anywhere
// to set a destination: it snaps to the nearest road and RouteRegistry computes the route from the car —
// which then also shows on the minimap and (with KeyP) as the yellow ribbon in the 3D world.
//
// North-up only. All screen mapping is in CSS px; the canvas is scaled by devicePixelRatio for crispness.
// The view is redrawn in a throttled rAF so the car dot tracks live while driving.

interface Props {
	onClose: () => void;
}

// Zoom = meters-per-pixel. Smaller = more zoomed in. Clamped to this range.
const MIN_MPP = 0.5;
const MAX_MPP = 40;
const DEFAULT_MPP = 4; // ~a few km across a laptop screen
// A click that moves less than this many px between down/up is a pick, not a pan.
const CLICK_SLOP = 5;

const FullscreenMap: React.FC<Props> = ({onClose}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Live view state kept in refs (the rAF loop reads them; no React re-render per frame).
	const centerRef = useRef<[number, number]>([carTelemetry.x, carTelemetry.z]); // frame-E [X, Z]
	const mppRef = useRef<number>(DEFAULT_MPP);
	const drag = useRef<{sx: number; sy: number; cx: number; cz: number; moved: boolean} | null>(null);

	// Esc closes.
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.code === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	// The draw loop.
	useEffect(() => {
		let raf = 0;
		let lastDraw = 0;

		const loop = (t: number): void => {
			raf = requestAnimationFrame(loop);
			if (t - lastDraw < 40) { // ~25 fps — plenty for a map; keeps the big road draw cheap
				return;
			}
			lastDraw = t;
			draw();
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, []);

	const draw = (): void => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px

		const [cx, cz] = centerRef.current;
		const mpp = mppRef.current;

		// Frame-E world (X north / Z east) → screen px (north-up): east→+x, north→−y.
		const toScreen = (wx: number, wz: number): [number, number] => [w / 2 + (wz - cz) / mpp, h / 2 - (wx - cx) / mpp];

		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = "#0e1014";
		ctx.fillRect(0, 0, w, h);

		// World half-extents visible (with a margin) for a cheap cull.
		const halfW = (w / 2) * mpp * 1.2;
		const halfH = (h / 2) * mpp * 1.2;

		// Roads (neon blue).
		ctx.strokeStyle = "rgba(80, 230, 255, 0.9)";
		ctx.lineWidth = 1;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const way of roadGraphOverlay.frameEPolylines) {
			const pts = way.points;
			if (pts.length < 2) {
				continue;
			}
			ctx.beginPath();
			let any = false;
			let prevInRange = false;
			for (let i = 0; i < pts.length; i++) {
				const inRange = Math.abs(pts[i][0] - cx) < halfH && Math.abs(pts[i][1] - cz) < halfW;
				const [sx, sy] = toScreen(pts[i][0], pts[i][1]);
				if (i === 0) {
					ctx.moveTo(sx, sy);
				} else if (inRange || prevInRange) {
					ctx.lineTo(sx, sy);
					any = true;
				} else {
					ctx.moveTo(sx, sy);
				}
				prevInRange = inRange;
			}
			if (any) {
				ctx.stroke();
			}
		}

		// Route (yellow).
		if (routeRegistry.hasRoute) {
			ctx.strokeStyle = "rgba(255, 255, 0, 0.98)"; // neon yellow
			ctx.lineWidth = 4;
			ctx.beginPath();
			const route = routeRegistry.routePolyline;
			for (let i = 0; i < route.length; i++) {
				const [sx, sy] = toScreen(route[i][0], route[i][1]);
				if (i === 0) {
					ctx.moveTo(sx, sy);
				} else {
					ctx.lineTo(sx, sy);
				}
			}
			ctx.stroke();
		}

		// Destination (green).
		if (routeRegistry.destination) {
			const [dx, dy] = toScreen(routeRegistry.destination[0], routeRegistry.destination[1]);
			ctx.beginPath();
			ctx.arc(dx, dy, 7, 0, Math.PI * 2);
			ctx.fillStyle = "#2ecc40";
			ctx.fill();
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Player — a RED arrow at the live car pos, always facing the driving direction (north-up map).
		const [carSx, carSy] = toScreen(carTelemetry.x, carTelemetry.z);
		const cosH = Math.cos(carTelemetry.heading);
		const sinH = Math.sin(carTelemetry.heading);
		ctx.save();
		ctx.translate(carSx, carSy);
		ctx.rotate(Math.atan2(-cosH, sinH) + Math.PI / 2);
		const ar = 9;
		ctx.beginPath();
		ctx.moveTo(0, -ar);
		ctx.lineTo(ar * 0.7, ar * 0.75);
		ctx.lineTo(0, ar * 0.35);
		ctx.lineTo(-ar * 0.7, ar * 0.75);
		ctx.closePath();
		ctx.fillStyle = "#ff2a2a";
		ctx.fill();
		ctx.strokeStyle = "#000";
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();

		// Status text.
		ctx.font = "13px sans-serif";
		ctx.fillStyle = "rgba(255,255,255,0.85)";
		let status = "Click the map to set a destination";
		if (routeRegistry.lastError) {
			status = `No route: ${routeRegistry.lastError}`;
		} else if (routeRegistry.hasRoute) {
			status = `Route: ${routeRegistry.routeNodeIds.length} waypoints, ~${(routePolylineMeters() / 1000).toFixed(2)} km`;
		}
		ctx.fillText(status, 14, h - 16);
	};

	// Approximate route length in frame-E meters (web-mercator; overestimates real ground distance by
	// ~1/cos(lat), fine for a dev GPS read-out).
	const routePolylineMeters = (): number => {
		const p = routeRegistry.routePolyline;
		let m = 0;
		for (let i = 0; i < p.length - 1; i++) {
			m += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
		}
		return m;
	};

	const screenToWorld = (sx: number, sy: number): [number, number] => {
		const container = containerRef.current;
		const w = container ? container.clientWidth : window.innerWidth;
		const h = container ? container.clientHeight : window.innerHeight;
		const [cx, cz] = centerRef.current;
		const mpp = mppRef.current;
		return [cx - (sy - h / 2) * mpp, cz + (sx - w / 2) * mpp];
	};

	const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const [cx, cz] = centerRef.current;
		drag.current = {sx: e.clientX - rect.left, sy: e.clientY - rect.top, cx, cz, moved: false};
		canvas.setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
		const canvas = canvasRef.current;
		if (!drag.current || !canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const dsx = sx - drag.current.sx;
		const dsy = sy - drag.current.sy;
		if (Math.abs(dsx) > CLICK_SLOP || Math.abs(dsy) > CLICK_SLOP) {
			drag.current.moved = true;
		}
		const mpp = mppRef.current;
		// Pan: keep the world point under the cursor fixed (north-up: +x→+Z, +y→−X).
		centerRef.current = [drag.current.cx + dsy * mpp, drag.current.cz - dsx * mpp];
	};

	const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
		const d = drag.current;
		drag.current = null;
		if (!d) {
			return;
		}
		const canvas = canvasRef.current;
		if (!d.moved && canvas) {
			// A click (not a pan): set the destination here and route from the car.
			const rect = canvas.getBoundingClientRect();
			const [wx, wz] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
			routeRegistry.setRoute(carTelemetry.x, carTelemetry.z, wx, wz);
		}
	};

	const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
		const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
		mppRef.current = Math.max(MIN_MPP, Math.min(MAX_MPP, mppRef.current * factor));
	};

	const zoom = useCallback((factor: number): void => {
		mppRef.current = Math.max(MIN_MPP, Math.min(MAX_MPP, mppRef.current * factor));
	}, []);

	const recenter = useCallback((): void => {
		centerRef.current = [carTelemetry.x, carTelemetry.z];
	}, []);

	const clearRoute = useCallback((): void => {
		routeRegistry.clear();
	}, []);

	return (
		<div className={styles.fullscreenMap}>
			<div className={styles.fullscreenMap__header}>
				<span className={styles.fullscreenMap__title}>Map</span>
				<span className={styles.fullscreenMap__hint}>Click to set a destination · drag to pan · scroll to zoom</span>
				<div className={styles.fullscreenMap__spacer}/>
				<button type="button" onClick={(): void => zoom(1 / 1.4)} title="Zoom in">+</button>
				<button type="button" onClick={(): void => zoom(1.4)} title="Zoom out">−</button>
				<button type="button" onClick={recenter} title="Center on car">Car</button>
				<button type="button" onClick={clearRoute} title="Clear route">Clear</button>
				<button type="button" className={styles.fullscreenMap__close} onClick={onClose} title="Close (Esc)">✕</button>
			</div>
			<div ref={containerRef} className={styles.fullscreenMap__canvasWrap}>
				<canvas
					ref={canvasRef}
					className={styles.fullscreenMap__canvas}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onWheel={onWheel}
				/>
			</div>
		</div>
	);
};

export default FullscreenMap;
