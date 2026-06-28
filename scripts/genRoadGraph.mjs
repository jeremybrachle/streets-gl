// Road graph extractor (roadmap §0.5 s24 redirect, §1.5, §8) — Strata "Lane B" P1.
//
// One OFFLINE Overpass query for ALL drivable roads in a bbox → a clean, node-deduplicated road-graph
// JSON asset: every way's ORDERED osm node ids + a shared node->[lat,lon] table + the bridge/tunnel/
// layer/lanes/oneway tags the streets.gl PBF tiles strip. This is the CLEAN, continuous, routable
// geometry the editable road layer + autodrive ride — NOT the clipped/simplified render-tile fragments
// that fold (the s24 root-cause). Geometry is raw WGS84 so the asset is engine-portable (BeamNG etc.);
// Strata projects it into frame E via MathUtils.degrees2meters at load.
//
// The pure assembly + schema live in src/app/roadcompiler/RoadGraphAsset.ts (jest-pinned, single-source);
// this script is just the Overpass fetch + file write. Node imports the .ts directly (type-stripping).
//
//   node scripts/genRoadGraph.mjs sf
//   node scripts/genRoadGraph.mjs --bbox 32.74,-96.83,32.81,-96.76 --name dallas-downtown
//   node scripts/genRoadGraph.mjs sf --out /tmp/sfRoadGraph.generated.json
//   node scripts/genRoadGraph.mjs sf --verify 537838948
//
// NOT in any hot path. Re-run to follow OSM drift. Data © OpenStreetMap contributors (ODbL) — roadmap §5.
// See scripts/README-roadgraph.md.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleRoadGraph, waysWithMissingNodes} from '../src/app/roadcompiler/RoadGraphAsset.ts';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

// Named region bboxes: [south, west, north, east]. SF "wide" contains both full bridge spans (Checkpoint ①).
const REGIONS = {
	sf: {bbox: [37.70, -122.53, 37.84, -122.28], label: 'San Francisco'}
};

function flag(name) {
	const i = process.argv.indexOf(name);
	return i !== -1 ? process.argv[i + 1] : undefined;
}

function resolveRegion() {
	const bboxArg = flag('--bbox');
	if (bboxArg) {
		const parts = bboxArg.split(',').map(Number);
		if (parts.length !== 4 || parts.some(Number.isNaN)) {
			throw new Error(`--bbox must be "S,W,N,E" (got "${bboxArg}")`);
		}
		const name = flag('--name') ?? 'custom';
		return {region: name, label: flag('--name') ?? 'Custom bbox', bbox: parts};
	}
	const region = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
	if (!region || !REGIONS[region]) {
		throw new Error(
			`Usage: node scripts/genRoadGraph.mjs <${Object.keys(REGIONS).join('|')}> [--out PATH] [--verify WAYID]\n` +
			`   or: node scripts/genRoadGraph.mjs --bbox S,W,N,E --name <slug> [--out PATH]`
		);
	}
	return {region, label: REGIONS[region].label, bbox: REGIONS[region].bbox};
}

async function overpass(query) {
	const res = await fetch(OVERPASS, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'strata-roadgraph/0.1 (research)'},
		body: 'data=' + encodeURIComponent(query)
	});
	if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
	return res.json();
}

async function main() {
	const {region, label, bbox} = resolveRegion();
	const [s, w, n, e] = bbox;

	const here = path.dirname(fileURLToPath(import.meta.url));
	const outPath = flag('--out')
		?? path.join(here, '..', 'src', 'lib', 'tile-processing', 'vector', 'sidecar', `${region}RoadGraph.generated.json`);

	// `out body;` → ways with ordered node-id lists + tags; `>;` selects all referenced nodes (even past
	// the bbox edge → ways are never clipped); `out skel qt;` → each node's id + lat + lon.
	const query = `[out:json][timeout:180];
way[highway](${s},${w},${n},${e});
out body;
>;
out skel qt;`;

	console.error(`Querying Overpass for ${label} drivable roads [S ${s}, W ${w}, N ${n}, E ${e}]...`);
	const data = await overpass(query);

	const asset = assembleRoadGraph(data.elements, {region, label, bbox});

	fs.writeFileSync(outPath, JSON.stringify(asset), 'utf8');

	const bytes = fs.statSync(outPath).size;
	const bridges = asset.ways.filter(w => w.bridge).length;
	const tunnels = asset.ways.filter(w => w.tunnel).length;
	const missing = waysWithMissingNodes(asset);
	console.error(
		`Wrote ${asset.meta.wayCount} ways / ${asset.meta.nodeCount} nodes ` +
		`(${bridges} bridge, ${tunnels} tunnel) ${(bytes / 1024 / 1024).toFixed(2)} MB -> ${outPath}`
	);
	if (missing.length) {
		console.error(`⚠ ${missing.length} way(s) reference a node with no coords (incomplete fetch?): ${missing.slice(0, 10).join(', ')}`);
	}

	const verifyId = flag('--verify');
	if (verifyId !== undefined) {
		const id = Number(verifyId);
		const way = asset.ways.find(w => w.id === id);
		if (!way) {
			console.error(`--verify ${id}: NOT FOUND among kept ways`);
		} else {
			const first = asset.nodes[way.nodes[0]];
			console.error(
				`--verify ${id}: highway=${way.highway} bridge=${way.bridge ?? false} layer=${way.layer ?? '-'} ` +
				`lanes=${way.lanes ?? '-'} oneway=${way.oneway ?? false} nodes=${way.nodes.length} ` +
				`firstNode=[${first?.[0]}, ${first?.[1]}]`
			);
		}
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
