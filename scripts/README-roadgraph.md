# Road graph extractor (`genRoadGraph.mjs`)

Offline CLI that pulls a **clean, continuous, routable road graph** for a bounding box straight from
OpenStreetMap (via Overpass) and writes it as a static JSON asset. This is the data source for Strata's
editable road layer, autodrive, and (later) GPS/minimap.

## Why it exists

The streets.gl PBF render tiles **clip roads at every tile seam and simplify them per zoom**, so a single
OSM way arrives as scattered fragments — you can't rebuild a continuous, routable centerline from them
(this caused the height-edit "folds + discontinuous lines" in session 24). This extractor sidesteps the
render tiles entirely: one Overpass query returns each way's **complete, ordered node list** plus the
shared node coordinates — clean by construction, never clipped (the query recurses to every node a way
touches, even past the bbox edge).

## Run it

Requires Node ≥ 22 (the script imports the TypeScript builder directly via native type-stripping). Run
from the repo root.

```bash
# A named region (currently: sf)
node scripts/genRoadGraph.mjs sf

# An arbitrary bbox  (order: South,West,North,East)
node scripts/genRoadGraph.mjs --bbox 32.74,-96.83,32.81,-96.76 --name dallas-downtown

# Custom output path
node scripts/genRoadGraph.mjs sf --out /tmp/sfRoadGraph.generated.json

# Print a sanity readout for one way after generating (e.g. the Golden Gate Bridge)
node scripts/genRoadGraph.mjs sf --verify 537838948
```

Default output: `src/lib/tile-processing/vector/sidecar/<region>RoadGraph.generated.json`.

Re-run any time to follow OSM drift; commit the regenerated asset.

## Output schema

Geometry is stored as **raw WGS84 `[lat, lon]`** — no projection is baked in, so the asset is
engine-portable (Strata projects it into its render frame via `degrees2meters` at load; another engine
applies its own projection). Nodes are **deduplicated** into a shared table; a node id appearing in two
ways IS a junction (the routing-graph adjacency).

```jsonc
{
  "meta": {
    "region": "sf",
    "label": "San Francisco",
    "bbox": [37.70, -122.53, 37.84, -122.28],   // [S, W, N, E]
    "generated": "…Z",
    "attribution": "© OpenStreetMap contributors (ODbL)",
    "nodeCount": 123456,
    "wayCount": 12345
  },
  "nodes": { "65314115": [37.8094, -122.4108], … },   // osm node id -> [lat, lon]
  "ways": [
    {
      "id": 537838948,
      "nodes": [65314115, 65314116, …],   // ORDERED osm node ids; geometry = resolve through `nodes`
      "highway": "motorway",
      "bridge": true,                      // present only when tagged
      "tunnel": true,                      // present only when tagged
      "layer": 1,                          // osm `layer` ordinal (stacking, not height); only when tagged
      "lanes": 6,                          // only when tagged
      "oneway": true                       // only for an actual oneway
    }
  ]
}
```

Only **drivable** highway classes are kept (motorway…service; footway/cycleway/path/steps dropped). The
canonical schema, drivable filter, and pure assembly live in
[`src/app/roadcompiler/RoadGraphAsset.ts`](../src/app/roadcompiler/RoadGraphAsset.ts) (unit-tested in
`RoadGraphAsset.test.ts`); this script is only the network fetch + file write.

## Licensing

The graph is derived from OSM, which is **ODbL**. The asset carries
`© OpenStreetMap contributors (ODbL)` in its `meta`; ship a `LICENSES.md` before distributing it
(roadmap §5).
