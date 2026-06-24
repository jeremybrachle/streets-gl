#include <versionPrecision>

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec2 vUv;
out vec3 vNormal;
out vec3 vPosition;
out vec4 vClipPos;
out vec4 vClipPosPrev;

uniform MainBlock {
	mat4 projectionMatrix;
	mat4 modelMatrix;
	mat4 viewMatrix;
	mat4 modelViewMatrixPrev;
	mat4 carMatrix;
	mat4 carMatrixPrev;
};

void main() {
	vUv = uv;

	vec4 localPos = carMatrix * vec4(position, 1.0);
	vec4 localPosPrev = carMatrixPrev * vec4(position, 1.0);
	vec4 cameraSpacePosition = viewMatrix * modelMatrix * localPos;
	vec4 cameraSpacePositionPrev = modelViewMatrixPrev * localPosPrev;

	vec3 worldNormal = normalize((carMatrix * vec4(normal, 0.0)).xyz);
	vNormal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);

	vPosition = vec3(cameraSpacePosition);
	vClipPos = projectionMatrix * cameraSpacePosition;
	vClipPosPrev = projectionMatrix * cameraSpacePositionPrev;

	gl_Position = vClipPos;
}
