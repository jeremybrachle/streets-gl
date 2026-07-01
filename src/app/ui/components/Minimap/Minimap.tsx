import React, {useContext, useEffect, useRef, useState} from "react";
import {useRecoilValue} from "recoil";
import styles from './Minimap.scss';
import {AtomsContext} from "~/app/ui/UI";
import DraggablePanel from "~/app/ui/components/DraggablePanel";
import {carTelemetry} from "~/app/controls/CarTelemetry";
import {roadGraphOverlay} from "~/app/roadcompiler/RoadGraphOverlayRegistry";
import {routeRegistry} from "~/app/roadcompiler/RouteRegistry";

// Strata s28 — a GTA-style 2D top-down minimap that follows the car while driving. It draws the SAME clean
// frame-E road graph the KeyO overlay uses (roadGraphOverlay.frameEPolylines) — so it works in every city
// the overlay can load, for free — centered on the live car pose (carTelemetry). The minimap itself drives
// the graph load (ensureForCamera + a markDirty on drive-start), so roads appear WITHOUT toggling KeyO:
// bundled SF is instant, any other city fetches once proactively.
//
// Draggable (DraggablePanel, persists position); toggle North-up / Heading-up; zoom in/out. The zoom-out is
// the lightweight "magnify" — the full-screen routable map with clickable route dots lands with the GPS work.

// On-screen diameter (CSS px). Rendered at devicePixelRatio for crispness.
const SIZE = 168;
// Zoom = the half-view in meters (radius of what the circle shows). Smaller = more zoomed in.
const ZOOM_LEVELS = [150, 300, 600, 1200];
const DEFAULT_ZOOM_INDEX = 1;

function drawMinimap(canvas: HTMLCanvasElement, headingUp: boolean, viewRadiusMeters: number): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}

	const size = canvas.width; // device px (SIZE * dpr)
	const c = size / 2;
	const radius = c;
	const scale = radius / viewRadiusMeters; // device px per meter
	const cullSq = (viewRadiusMeters * 1.2) ** 2;

	const carX = carTelemetry.x;
	const carZ = carTelemetry.z;
	const h = carTelemetry.heading;
	const cosH = Math.cos(h);
	const sinH = Math.sin(h);

	// Frame-E world (X north / Z east) → canvas px, centered on the car. North-up: east→+x, north→−y;
	// heading-up: project onto the car's forward/right so forward points up. Shared by roads + route.
	const project = (wx: number, wz: number): [number, number] => {
		const dx = wx - carX;
		const dz = wz - carZ;
		if (headingUp) {
			return [c + (-dx * sinH + dz * cosH) * scale, c - (dx * cosH + dz * sinH) * scale];
		}
		return [c + dz * scale, c - dx * scale];
	};

	ctx.clearRect(0, 0, size, size);
	ctx.save();

	// Circular clip + dark glass.
	ctx.beginPath();
	ctx.arc(c, c, radius, 0, Math.PI * 2);
	ctx.closePath();
	ctx.fillStyle = "rgba(18, 20, 26, 0.82)";
	ctx.fill();
	ctx.clip();

	// Roads. Frame E: X from lat (north), Z from lon (east).
	//  - North-up: east → +screenX, north → −screenY.
	//  - Heading-up: project (dx, dz) onto the car's forward = (cosH, sinH) and right = (−sinH, cosH) axes,
	//    so forward points up. A segment draws only if an endpoint is within the view (cheap distance cull);
	//    the per-way path is stroked only when it has a visible point (skips the thousands of far ways).
	ctx.lineWidth = Math.max(1, size * 0.006);
	ctx.strokeStyle = "rgba(80, 230, 255, 0.95)"; // neon blue
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
			const dx = pts[i][0] - carX;
			const dz = pts[i][1] - carZ;
			const inRange = dx * dx + dz * dz <= cullSq;

			const [sx, sy] = project(pts[i][0], pts[i][1]);

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

	// Active GPS route — bright yellow, drawn whenever a route exists (the minimap is the GPS display, so
	// this shows regardless of the KeyP world-overlay toggle). Destination = red dot.
	if (routeRegistry.hasRoute) {
		ctx.strokeStyle = "rgba(255, 255, 0, 0.98)"; // neon yellow
		ctx.lineWidth = Math.max(2, size * 0.016);
		ctx.beginPath();
		const route = routeRegistry.routePolyline;
		for (let i = 0; i < route.length; i++) {
			const [sx, sy] = project(route[i][0], route[i][1]);
			if (i === 0) {
				ctx.moveTo(sx, sy);
			} else {
				ctx.lineTo(sx, sy);
			}
		}
		ctx.stroke();

		if (routeRegistry.destination) {
			const [ex, ey] = project(routeRegistry.destination[0], routeRegistry.destination[1]);
			ctx.beginPath();
			ctx.arc(ex, ey, size * 0.03, 0, Math.PI * 2);
			ctx.fillStyle = "#2ecc40"; // green destination
			ctx.fill();
		}
	}

	// Car marker (always at the center). Heading-up → points up; north-up → rotates to the world heading.
	ctx.translate(c, c);
	ctx.rotate(headingUp ? 0 : Math.atan2(-cosH, sinH) + Math.PI / 2);
	const r = size * 0.055;
	ctx.beginPath();
	ctx.moveTo(0, -r);
	ctx.lineTo(r * 0.7, r * 0.75);
	ctx.lineTo(0, r * 0.35);
	ctx.lineTo(-r * 0.7, r * 0.75);
	ctx.closePath();
	ctx.fillStyle = "#ff2a2a"; // red player arrow
	ctx.fill();

	ctx.restore();

	// Ring border.
	ctx.beginPath();
	ctx.arc(c, c, radius - 1, 0, Math.PI * 2);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
	ctx.lineWidth = Math.max(1, size * 0.01);
	ctx.stroke();
}

interface MinimapProps {
	/** Clicking the map canvas opens the larger full-screen map view (set by MainScreen). */
	onExpand?: () => void;
}

const Minimap: React.FC<MinimapProps> = ({onExpand}) => {
	const atoms = useContext(AtomsContext);
	const driveActive = useRecoilValue(atoms.driveActive);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const [headingUp, setHeadingUp] = useState<boolean>(true);
	const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);

	// The rAF loop reads live values via refs so we don't restart it on every toggle.
	const headingUpRef = useRef(headingUp);
	headingUpRef.current = headingUp;
	const zoomRef = useRef(zoomIndex);
	zoomRef.current = zoomIndex;

	useEffect(() => {
		if (!driveActive) {
			return;
		}

		// Proactively load the road graph for wherever we're driving (bundled city = instant, else one fetch).
		roadGraphOverlay.markDirty();

		let raf = 0;
		let lastDraw = 0;
		const loop = (t: number): void => {
			raf = requestAnimationFrame(loop);
			if (t - lastDraw < 33) { // throttle to ~30 fps — the car moves slowly, redraw is cheap-but-not-free
				return;
			}
			lastDraw = t;

			const canvas = canvasRef.current;
			if (!canvas) {
				return;
			}
			roadGraphOverlay.ensureForCamera(carTelemetry.x, carTelemetry.z);
			drawMinimap(canvas, headingUpRef.current, ZOOM_LEVELS[zoomRef.current]);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [driveActive]);

	if (!driveActive) {
		return null;
	}

	const dpr = window.devicePixelRatio || 1;

	return (
		<DraggablePanel prefId="minimap" title="Map" defaultStyle={{left: 16, bottom: 132}} bare>
			<div className={styles.minimap}>
				<canvas
					ref={canvasRef}
					className={styles.minimap__canvas}
					width={SIZE * dpr}
					height={SIZE * dpr}
					style={{width: SIZE, height: SIZE, cursor: onExpand ? 'pointer' : 'default'}}
					title="Open full map"
					onClick={onExpand}
				/>
				<div className={styles.minimap__controls}>
					<button type="button" title="North-up / Heading-up" onClick={(): void => setHeadingUp(v => !v)}>
						{headingUp ? 'H' : 'N'}
					</button>
					<button
						type="button"
						title="Zoom in"
						onClick={(): void => setZoomIndex(i => Math.max(0, i - 1))}
					>
						+
					</button>
					<button
						type="button"
						title="Zoom out"
						onClick={(): void => setZoomIndex(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
					>
						−
					</button>
				</div>
			</div>
		</DraggablePanel>
	);
};

export default React.memo(Minimap);
