#include <versionPrecision>
#include <gBufferOut>

in vec2 vUv;
in vec3 vNormal;
in vec3 vPosition;
in vec4 vClipPos;
in vec4 vClipPosPrev;

uniform sampler2D tDiffuse;

#include <packNormal>
#include <getMotionVector>

void main() {
	outColor = texture(tDiffuse, vUv);
	outGlow = vec3(0);

	vec3 normal = normalize(vNormal) * (float(gl_FrontFacing) * 2.0 - 1.0);
	outNormal = packNormal(normal);

	outRoughnessMetalnessF0 = vec3(0.85, 0.0, 0.04);
	outMotion = getMotionVector(vClipPos, vClipPosPrev);
	outObjectId = 0u;
}
