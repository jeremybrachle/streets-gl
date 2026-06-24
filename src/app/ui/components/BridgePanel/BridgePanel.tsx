import React, {useEffect, useState} from "react";
import styles from './BridgePanel.scss';
import {bridgeRegistry} from "~/app/bridge/BridgeRegistry";
import DraggablePanel from "~/app/ui/components/DraggablePanel";

// The RollerCoaster-Tycoon builder, first pass. Edits the live bridgeRegistry singleton directly
// (the override store the drive physics reads every frame) so dragging a slider reshapes the deck
// on the very next frame — no recompile. For now it tunes the first corridor (Golden Gate); later
// this becomes select-a-corridor + persist/export.
const BridgePanel: React.FC = () => {
	const corridor = bridgeRegistry.corridors[0];
	const [, bump] = useState(0);
	const rerender = (): void => bump(n => n + 1);

	const setCourse = (v: boolean): void => {
		bridgeRegistry.courseMode = v;
		bridgeRegistry.markDirty();
		rerender();
	};

	type NumKey =
		'deckHeight' | 'rampLength' | 'halfWidth' | 'maxGrade' |
		'modelScale' | 'modelStretch' | 'modelYaw' | 'modelOffsetX' | 'modelOffsetY' | 'modelOffsetZ';

	const setField = (key: NumKey, v: number): void => {
		corridor[key] = v;
		bridgeRegistry.markDirty();
		rerender();
	};

	const setModelEnabled = (v: boolean): void => {
		corridor.modelEnabled = v;
		bridgeRegistry.markDirty();
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
			<span className={styles['bridgePanel__value']}>{(corridor[key] ?? 0).toFixed(digits)}</span>
		</label>
	);

	return (
		<DraggablePanel prefId="bridgeBuilder" title="Bridge Builder" defaultStyle={{top: 70, left: 16}} bare>
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
				<span>Show GGB model</span>
			</label>
			{slider('Scale', 'modelScale', 1, 200, 0.5, 1)}
			{slider('Stretch (span)', 'modelStretch', 0.2, 6, 0.05, 2)}
			{slider('Yaw', 'modelYaw', -3.15, 3.15, 0.01, 2)}
			{slider('Offset X', 'modelOffsetX', -3000, 3000, 5, 0)}
			{slider('Offset Y', 'modelOffsetY', -50, 400, 1, 0)}
			{slider('Offset Z', 'modelOffsetZ', -3000, 3000, 5, 0)}

			<div className={styles['bridgePanel__buttons']}>
				<button type="button" onClick={onSave} onPointerUp={releaseFocus}>
					{savedFlash ? 'Saved ✓' : 'Save'}
				</button>
				<button type="button" onClick={onReset} onPointerUp={releaseFocus}>Reset</button>
			</div>
		</div>
		</DraggablePanel>
	);
};

export default BridgePanel;
