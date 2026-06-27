#include <versionPrecision>
#include <gBufferOut>

// Strata Lane B (s9 models) — textured, alpha-cutout tree material. Pairs with deck.vert (position/
// normal/uv + the carMatrix precision pivot); samples tDiffuse and discards alpha < 0.5 so the
// Quaternius leaf cards read as foliage. Bark (opaque, alpha=1) flows through the same shader.
in vec2 vUv;
in vec3 vNormal;
in vec3 vPosition;
in vec4 vClipPos;
in vec4 vClipPosPrev;

uniform sampler2D tDiffuse;

#include <packNormal>
#include <getMotionVector>

void main() {
    vec4 color = texture(tDiffuse, vUv);

    if (color.a < 0.5) {
        discard;
    }

    outColor = vec4(color.rgb, 1.0);
    outGlow = vec3(0);

    vec3 normal = normalize(vNormal) * (float(gl_FrontFacing) * 2.0 - 1.0);
    outNormal = packNormal(normal);

    outRoughnessMetalnessF0 = vec3(0.9, 0.0, 0.03);
    outMotion = getMotionVector(vClipPos, vClipPosPrev);
    outObjectId = 0u;
}
