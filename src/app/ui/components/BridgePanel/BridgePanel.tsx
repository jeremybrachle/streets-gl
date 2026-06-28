import React, {useEffect, useState} from "react";
import styles from './BridgePanel.scss';
import {bridgeRegistry} from "~/app/bridge/BridgeRegistry";
import {buildingCollisionRegistry} from "~/app/collision/BuildingCollisionRegistry";
import {terrainTextureRegistry} from "~/app/render/materials/TerrainTextureRegistry";
import DraggablePanel from "~/app/ui/components/DraggablePanel";
import Config from "~/app/Config";

// Exact-entry number box paired with each slider. Keeps its own text state while focused so a
// partial edit (empty, "-", "1.") doesn't snap back to the controlled value; commits every time the
// text parses to a finite number. NOT range-clamped — you can type a value past the slider's min/max
// (the whole point: the sliders can't reach the exact value the user wants). Enter / blur returns
// focus to the canvas so WASD driving resumes (same intent as the sliders' onPointerUp blur).
export const NumberField: React.FC<{
	value: number;
	digits: number;
	step: number;
	onCommit: (v: number) => void;
}> = ({value, digits, step, onCommit}) => {
	const [focused, setFocused] = useState(false);
	const [text, setText] = useState('');
	// Sync from the live value (slider drag, Reset, etc.) only while NOT editing.
	useEffect(() => {
		if (!focused) {
			setText(value.toFixed(digits));
		}
	}, [value, digits, focused]);

	return (
		<input
			className={styles['bridgePanel__num']}
			type="number"
			step={step}
			value={text}
			onFocus={(): void => setFocused(true)}
			onChange={(e): void => {
				setText(e.target.value);
				const n = parseFloat(e.target.value);
				if (Number.isFinite(n)) {
					onCommit(n);
				}
			}}
			onBlur={(): void => setFocused(false)}
			onKeyDown={(e): void => {
				if (e.key === 'Enter') {
					e.currentTarget.blur();
				}
			}}
		/>
	);
};

// Friendly labels for the corridor selector (falls back to the raw id).
const CORRIDOR_LABELS: Record<string, string> = {
	'golden-gate': 'Golden Gate',
	'bay-bridge-west': 'Bay Bridge (West span)',
};

// The RollerCoaster-Tycoon builder, first pass. Edits the live bridgeRegistry singleton directly
// (the override store the drive physics reads every frame) so dragging a slider reshapes the deck
// on the very next frame — no recompile. A corridor selector (s14) picks which bridge the sliders
// tune; all edits target the selected corridor.
const BridgePanel: React.FC = () => {
	const [, bump] = useState(0);
	const rerender = (): void => bump(n => n + 1);

	// Which corridor the sliders edit. Clamped to the live list so a removed corridor can't dangle.
	const corridors = bridgeRegistry.corridors;
	const [selectedIdx, setSelectedIdx] = useState(0);
	const corridor = corridors[Math.min(selectedIdx, corridors.length - 1)] ?? corridors[0];

	// Auto-persist every edit so tuned values survive a refresh without remembering to click Save
	// (the user's complaint: values went away on reload). The explicit Save button stays for the
	// "Saved ✓" confirmation; both call the same registry.save().
	const setCourse = (v: boolean): void => {
		bridgeRegistry.courseMode = v;
		bridgeRegistry.markDirty();
		bridgeRegistry.save();
		rerender();
	};

	type NumKey =
		'deckHeight' | 'rampLength' | 'halfWidth' | 'maxGrade' |
		'modelScale' | 'modelStretch' | 'modelYaw' | 'modelOffsetX' | 'modelOffsetY' | 'modelOffsetZ';

	const setField = (key: NumKey, v: number): void => {
		corridor[key] = v;
		bridgeRegistry.markDirty();
		bridgeRegistry.save();
		rerender();
	};

	const setModelEnabled = (v: boolean): void => {
		corridor.modelEnabled = v;
		bridgeRegistry.markDirty();
		bridgeRegistry.save();
		rerender();
	};

	// Building wall collision (physics spike). These live on buildingCollisionRegistry, not the
	// corridor — collision is global, not bridge-specific. `enabled` mirrors the KeyB toggle.
	const setCollisionEnabled = (v: boolean): void => {
		buildingCollisionRegistry.enabled = v;
		rerender();
	};
	const setCollisionDebug = (v: boolean): void => {
		buildingCollisionRegistry.showDebug = v;
		rerender();
	};
	const setCollisionRadius = (v: number): void => {
		buildingCollisionRegistry.radius = v;
		rerender();
	};

	// Terrain base-ground texture — live swap (GBufferPass rebinds tDetailMaps on the registry's
	// revision). "Grass / rock (current)" is the default so reverting is one click.
	const setTerrainTexture = (id: string): void => {
		terrainTextureRegistry.select(id);
		rerender();
	};

	// Live base-terrain tiling (s15). 1.0 = engine default; higher = finer/less-zoomed so the base
	// ground can be dragged to match the tighter-tiled projected landuse decals. GBufferPass reads
	// `detailScale` into the terrain uniform every frame — no recompile.
	const setDetailScale = (v: number): void => {
		terrainTextureRegistry.setDetailScale(v);
		rerender();
	};

	// While an <input> holds focus the drive controls ignore WASD (ControlsNavigator.isInFocus is
	// false for inputs). Blur on release so keyboard focus returns to the canvas and you can drive
	// again without cycling the view. Deferred a frame so the value/toggle commits first.
	const releaseFocus = (e: React.PointerEvent<HTMLElement>): void => {
		const el = e.currentTarget;
		requestAnimationFrame(() => el.blur());
	};

	const [savedFlash, setSavedFlash] = useState(false);
	useEffect(() => {
		if (!savedFlash) {
			return;
		}
		const t = setTimeout(() => setSavedFlash(false), 1200);
		return () => clearTimeout(t);
	}, [savedFlash]);

	const onSave = (): void => {
		bridgeRegistry.save();
		setSavedFlash(true);
	};

	const onReset = (): void => {
		bridgeRegistry.resetToDefaults();
		bridgeRegistry.markDirty();
		rerender();
	};

	// Print the current tuned values to the console as a copy-paste block: a human-readable list AND
	// a code-ready snippet to bake straight into GoldenGate.ts defaults. (User asked for an easy way
	// to read off the fine-tuned values so they can become the new defaults.)
	const onPrint = (): void => {
		const lines = [
			'=== Bridge tuned values (' + (corridor.id ?? 'corridor') + ') ===',
			`road  deckHeight: ${corridor.deckHeight}   halfWidth: ${corridor.halfWidth}   ` +
				`rampLength: ${corridor.rampLength}   maxGrade: ${corridor.maxGrade}`,
			`GGB   scale: ${corridor.modelScale}   stretch: ${corridor.modelStretch}   yaw: ${corridor.modelYaw}   ` +
				`offsetX: ${corridor.modelOffsetX}   offsetY: ${corridor.modelOffsetY}   offsetZ: ${corridor.modelOffsetZ}`,
			'--- GoldenGate.ts defaults ---',
			`  halfWidth: ${corridor.halfWidth},`,
			`  deckHeight: ${corridor.deckHeight},`,
			`  rampLength: ${corridor.rampLength},`,
			`  maxGrade: ${corridor.maxGrade},`,
			`  modelScale: ${corridor.modelScale},`,
			`  modelStretch: ${corridor.modelStretch},`,
			`  modelYaw: ${corridor.modelYaw},`,
			`  modelOffsetX: ${corridor.modelOffsetX},`,
			`  modelOffsetY: ${corridor.modelOffsetY},`,
			`  modelOffsetZ: ${corridor.modelOffsetZ},`,
		];
		// eslint-disable-next-line no-console
		console.log(lines.join('\n'));
		bridgeRegistry.save(); // also persist, so a printed value can't be lost on reload
		setSavedFlash(true);
	};

	const slider = (
		label: string,
		key: NumKey,
		min: number,
		max: number,
		step: number,
		digits: number
	): JSX.Element => (
		<label className={styles['bridgePanel__row']}>
			<span className={styles['bridgePanel__label']}>{label}</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={corridor[key] ?? 0}
				onChange={(e): void => setField(key, parseFloat(e.target.value))}
				onPointerUp={releaseFocus}
			/>
			<NumberField
				value={corridor[key] ?? 0}
				digits={digits}
				step={step}
				onCommit={(v): void => setField(key, v)}
			/>
		</label>
	);

	return (
		<DraggablePanel prefId="bridgeBuilder" title="Dev panel" defaultStyle={{top: 70, left: 16}} bare>
		<div className={styles.bridgePanel}>
			<label className={styles['bridgePanel__row']}>
				<input
					type="checkbox"
					checked={bridgeRegistry.courseMode}
					onChange={(e): void => setCourse(e.target.checked)}
					onPointerUp={releaseFocus}
				/>
				<span>Course mode (toggle: L)</span>
			</label>

			<label className={styles['bridgePanel__row']}>
				<span className={styles['bridgePanel__label']}>Bridge</span>
				<select
					value={Math.min(selectedIdx, corridors.length - 1)}
					onChange={(e): void => {
						setSelectedIdx(parseInt(e.target.value, 10));
						rerender();
					}}
					onPointerUp={releaseFocus}
				>
					{corridors.map((c, i) => (
						<option key={c.id ?? i} value={i}>
							{CORRIDOR_LABELS[c.id ?? ''] ?? c.id ?? `Corridor ${i}`}
						</option>
					))}
				</select>
			</label>

			{slider('Deck height', 'deckHeight', 0, 200, 1, 0)}
			{slider('Ramp length', 'rampLength', 10, 600, 5, 0)}
			{slider('Half width', 'halfWidth', 5, 80, 1, 0)}
			{slider('Max grade', 'maxGrade', 0.02, 0.2, 0.005, 3)}

			<div className={styles['bridgePanel__title']}>Hero model</div>
			<label className={styles['bridgePanel__row']}>
				<input
					type="checkbox"
					checked={corridor.modelEnabled ?? false}
					onChange={(e): void => setModelEnabled(e.target.checked)}
					onPointerUp={releaseFocus}
				/>
				<span>Show hero model</span>
			</label>
			{slider('Scale', 'modelScale', 1, 200, 0.5, 1)}
			{slider('Stretch (span)', 'modelStretch', 0.2, 6, 0.05, 2)}
			{slider('Yaw', 'modelYaw', -3.15, 3.15, 0.01, 2)}
			{slider('Offset X', 'modelOffsetX', -3000, 3000, 5, 0)}
			{slider('Offset Y', 'modelOffsetY', -50, 400, 1, 0)}
			{slider('Offset Z', 'modelOffsetZ', -3000, 3000, 5, 0)}

			<div className={styles['bridgePanel__title']}>Building collision (physics spike)</div>
			<label className={styles['bridgePanel__row']}>
				<input
					type="checkbox"
					checked={buildingCollisionRegistry.enabled}
					onChange={(e): void => setCollisionEnabled(e.target.checked)}
					onPointerUp={releaseFocus}
				/>
				<span>Enabled (toggle: B)</span>
			</label>
			<label className={styles['bridgePanel__row']}>
				<input
					type="checkbox"
					checked={buildingCollisionRegistry.showDebug}
					onChange={(e): void => setCollisionDebug(e.target.checked)}
					onPointerUp={releaseFocus}
				/>
				<span>Show boundaries (red)</span>
			</label>
			<label className={styles['bridgePanel__row']}>
				<span className={styles['bridgePanel__label']}>Car radius</span>
				<input
					type="range"
					min={0.2}
					max={6}
					step={0.1}
					value={buildingCollisionRegistry.radius}
					onChange={(e): void => setCollisionRadius(parseFloat(e.target.value))}
					onPointerUp={releaseFocus}
				/>
				<NumberField
					value={buildingCollisionRegistry.radius}
					digits={1}
					step={0.1}
					onCommit={(v): void => setCollisionRadius(v)}
				/>
			</label>

			{/* Terrain texture switcher parked (Config.TerrainTextureSwitcher) — distracting while only
			    one area is editable; revisit with click-to-edit terrain. */}
			{Config.TerrainTextureSwitcher && (<>
			<div className={styles['bridgePanel__title']}>Terrain texture</div>
			{terrainTextureRegistry.options.map(opt => (
				<label className={styles['bridgePanel__row']} key={opt.id}>
					<input
						type="radio"
						name="strata-terrain-texture"
						checked={terrainTextureRegistry.currentId === opt.id}
						onChange={(): void => setTerrainTexture(opt.id)}
						onPointerUp={releaseFocus}
					/>
					<span>{opt.label}</span>
				</label>
			))}

			<label className={styles['bridgePanel__row']}>
				<span className={styles['bridgePanel__label']}>Detail scale</span>
				<input
					type="range"
					min={0.25}
					max={8}
					step={0.05}
					value={terrainTextureRegistry.detailScale}
					onChange={(e): void => setDetailScale(parseFloat(e.target.value))}
					onPointerUp={releaseFocus}
				/>
				<NumberField
					value={terrainTextureRegistry.detailScale}
					digits={2}
					step={0.05}
					onCommit={(v): void => setDetailScale(v)}
				/>
			</label>
			</>)}

			<div className={styles['bridgePanel__buttons']}>
				<button type="button" onClick={onSave} onPointerUp={releaseFocus}>
					{savedFlash ? 'Saved ✓' : 'Save'}
				</button>
				<button type="button" onClick={onPrint} onPointerUp={releaseFocus}>Print</button>
				<button type="button" onClick={onReset} onPointerUp={releaseFocus}>Reset</button>
			</div>
		</div>
		</DraggablePanel>
	);
};

export default BridgePanel;
