#include <versionPrecision>
#include <gBufferOut>

// Strata GPS/overlay — an UNLIT, GLOWING variant of car.frag for the road-graph + route ribbons. It writes
// the vertex colour into BOTH the albedo AND the glow buffer, so the deferred shading pass ADDS it on top
// of lighting (shading.frag: `color += texture(tGlow, vUv).rgb * 2.`). That makes the line read as a bright
// neon stroke regardless of time-of-day / shadow — matching the flat 2D minimap — instead of being dimmed
// like a normal lit surface. Reuses car.vert (same ins), so only the fragment differs from the car.

in vec3 vColor;
in vec3 vNormal;
in vec3 vPosition;
in vec4 vClipPos;
in vec4 vClipPosPrev;

#include <packNormal>
#include <getMotionVector>

void main() {
	outColor = vec4(vColor, 1.0);
	outGlow = vColor; // emissive: added (x2) after lighting → bright neon, unaffected by shadow

	vec3 normal = normalize(vNormal) * (float(gl_FrontFacing) * 2.0 - 1.0);
	outNormal = packNormal(normal);

	outRoughnessMetalnessF0 = vec3(0.7, 0.05, 0.04);
	outMotion = getMotionVector(vClipPos, vClipPosPrev);
	outObjectId = 0u;
}
