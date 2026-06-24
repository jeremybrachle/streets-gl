import React, {useCallback, useEffect, useRef, useState} from "react";
import styles from "./DraggablePanel.scss";
import {uiPrefs, PanelPref} from "~/app/ui/UIPrefs";

// Strata Lane B — a reusable movable/hideable chrome wrapper for the "X buildings hidden" menu and the
// Bridge Builder dev panel. A title bar acts as the drag handle; a "–" button collapses the panel to a
// small launcher pill; position + collapsed state persist (uiPrefs) keyed by `prefId`. When the user
// has never dragged it, the panel sits at `defaultStyle` (its original CSS spot); once dragged it
// switches to absolute viewport px. Additive: panels keep their own look, this only adds chrome.
interface Props {
	/** Stable id for persisting position + collapsed state. */
	prefId: string;
	/** Shown in the drag-handle title bar and on the collapsed launcher pill. */
	title: string;
	/** Fallback positioning used until the user first drags (the panel's original spot). */
	defaultStyle?: React.CSSProperties;
	/** When true the wrapper draws no background/border/padding — the child supplies its own look
	 *  (e.g. the Bridge Builder's dark glass). The drag bar is still rendered. */
	bare?: boolean;
	children: React.ReactNode;
}

// Keep at least this many px of the panel on screen so a dragged panel can't be lost off an edge.
const MIN_VISIBLE = 48;

const DraggablePanel: React.FC<Props> = ({prefId, title, defaultStyle, bare, children}) => {
	const [pref, setPref] = useState<PanelPref>(() => uiPrefs.get(prefId));
	const containerRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{startX: number; startY: number; baseX: number; baseY: number} | null>(null);

	const hidden = pref.hidden ?? false;
	const hasPos = typeof pref.x === 'number' && typeof pref.y === 'number';

	const onPointerMove = useCallback((e: PointerEvent): void => {
		if (!drag.current) {
			return;
		}
		const dx = e.clientX - drag.current.startX;
		const dy = e.clientY - drag.current.startY;
		const x = Math.max(0, Math.min(window.innerWidth - MIN_VISIBLE, drag.current.baseX + dx));
		const y = Math.max(0, Math.min(window.innerHeight - MIN_VISIBLE, drag.current.baseY + dy));
		setPref(p => ({...p, x, y}));
	}, []);

	const onPointerUp = useCallback((): void => {
		if (!drag.current) {
			return;
		}
		drag.current = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		// Persist wherever it landed.
		setPref(p => {
			if (typeof p.x === 'number' && typeof p.y === 'number') {
				uiPrefs.setPosition(prefId, p.x, p.y);
			}
			return p;
		});
	}, [onPointerMove, prefId]);

	useEffect(() => {
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};
	}, [onPointerMove, onPointerUp]);

	const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		drag.current = {startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	};

	const setHidden = (v: boolean): void => {
		uiPrefs.setHidden(prefId, v);
		setPref(p => ({...p, hidden: v}));
	};

	// Position: dragged px wins; otherwise the panel's default CSS spot.
	const posStyle: React.CSSProperties = hasPos
		? {left: pref.x, top: pref.y, right: 'auto', bottom: 'auto', transform: 'none'}
		: (defaultStyle ?? {});

	if (hidden) {
		return (
			<button
				type="button"
				className={styles.launcher}
				style={posStyle}
				onClick={(): void => setHidden(false)}
			>
				{title} ▸
			</button>
		);
	}

	const containerClass = bare
		? `${styles.draggablePanel} ${styles['draggablePanel--bare']}`
		: styles.draggablePanel;

	return (
		<div ref={containerRef} className={containerClass} style={posStyle}>
			<div className={styles.draggablePanel__bar} onPointerDown={onHandlePointerDown}>
				<span className={styles.draggablePanel__title}>{title}</span>
				<button
					type="button"
					className={styles.draggablePanel__hide}
					title="Hide"
					onPointerDown={(e): void => e.stopPropagation()}
					onClick={(): void => setHidden(true)}
				>
					–
				</button>
			</div>
			<div className={styles.draggablePanel__body}>
				{children}
			</div>
		</div>
	);
};

export default DraggablePanel;
