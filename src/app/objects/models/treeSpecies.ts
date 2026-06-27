import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";

// Strata Lane B (s11) — shared tree-species config for the model-tree pipeline. Lives here (not on a
// renderable object) so the world scatter can use it without the old hand-placed Presidio probe
// cluster, which has been removed. Each species is a textured GLB whose trunk/foliage are split into
// an OPAQUE bark bucket + a BLEND alpha-leaf bucket (color lives in the textures, not vertex colors).

export interface SpeciesDef {
	glb: string;         // resource name of the GLB
	bark: string;        // resource name of the opaque bark/trunk texture
	leaf: string | null; // resource name of the alpha leaf texture (null = leafless, e.g. dead trees)
	exclude?: string[];  // drop bad variants by GLB node name (deterministic), e.g. a "Twisted" model
	// true = the GLB is ONE tree whose trunk + foliage may be split across separate nodes (merge them
	// into a single variant). false/undefined = a multi-tree pack where each node is its own tree.
	singleTree?: boolean;
}

// The two realistic CC-BY species (Andriy Shekh pine + Daniel "Realistic Tree"). Clean 2-material
// textured GLBs (OPAQUE trunk + BLEND alpha-leaf), stripped to geometry-only + textures to PNG. The old
// stylized Quaternius/MegaKit packs are kept below (commented) so the look can be A/B'd or re-mixed.
// Drop/add a line to change what the scatter renders; order doesn't matter.
export const TREE_SPECIES: SpeciesDef[] = [
	{glb: 'realPine', bark: 'realPineBark', leaf: 'realPineLeaf', singleTree: true},
	{glb: 'realTree', bark: 'realTreeBark', leaf: 'realTreeLeaf', singleTree: true}
	// --- stylized packs, kept for later (Quaternius CC0 / MegaKit Kenney-style) ---
	// {glb: 'quaterniusBirch', bark: 'quaterniusBirchBark', leaf: 'quaterniusBirchLeaf'},
	// {glb: 'quaterniusMaple', bark: 'quaterniusMapleBark', leaf: 'quaterniusMapleLeaf'},
	// {glb: 'quaterniusPalm', bark: 'quaterniusPalmBark', leaf: 'quaterniusPalmLeaf'},
	// {glb: 'quaterniusGeneric', bark: 'quaterniusGenericBark', leaf: 'quaterniusGenericLeaf'},
	// {glb: 'megakitPine', bark: 'megakitPineBark', leaf: 'megakitPineLeaf'},
	// {glb: 'megakitTree', bark: 'megakitTreeBark', leaf: 'megakitTreeLeaf'},
	// {glb: 'megakitTwisted', bark: 'megakitTwistedBark', leaf: 'megakitTwistedLeaf'}
];

// One renderable species: its merged bark + leaf meshes + the texture resource names to bind.
export interface RenderSpecies {
	bark: string;
	leaf: string | null;
	barkMesh: AbstractMesh | null;
	leafMesh: AbstractMesh | null;
}
