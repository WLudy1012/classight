/* GPGPU particle physics + point rendering for the class-name cloud. */

const NOISE = /* glsl */ `
vec3 flow(vec3 p, float t) {
  return vec3(
    sin(p.y * 1.7 + t * 1.3) + sin(p.z * 2.3 - t),
    sin(p.z * 1.9 + t * 1.1) + sin(p.x * 2.1 + t * 0.7),
    sin(p.x * 1.3 - t * 0.9) + sin(p.y * 2.7 + t * 1.2)
  );
}
`

/** velocity: spring toward the (moving) target + ambient drift + pointer repel/swirl. w = disturbance heat */
export const velocityShader = /* glsl */ `
uniform sampler2D tTarget;
uniform float uTime;
uniform float uDt;
uniform float uAssemble;
uniform float uSpring;
uniform float uDamp;
uniform float uNoise;
uniform float uRadius;
uniform float uStrength;
uniform float uMouseOn;
uniform vec3 uMouse;
uniform vec3 uCenter;
uniform float uScale;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  vec4 tg = texture2D(tTarget, uv);
  vec3 target = tg.xyz * uScale + uCenter;
  float seed = tg.w;

  // pull: weak while the cloud is still dispersed, full once assembled
  float k = uSpring * mix(0.035, 1.0, uAssemble) * (0.75 + 0.5 * seed);
  vec3 acc = (target - pos) * k;

  // Nearby particles share the same current, keeping the letterforms coherent.
  acc += flow(target * 0.48 + seed * 0.8, uTime * 0.16) * uNoise * (0.65 + seed * 0.35);

  // pointer: repel along the radial, add a swirl so disturbed ink curls rather than bounces
  vec3 d = pos - uMouse;
  d.z *= 0.45;
  float dist = length(d);
  vec3 dir = d / max(dist, 0.0001);
  float f = smoothstep(uRadius, 0.0, dist) * uMouseOn;
  acc += dir * f * uStrength * (0.55 + seed * 0.9);
  acc += cross(dir, vec3(0.0, 0.0, 1.0)) * f * uStrength * 0.18;

  vel += acc * uDt;
  vel *= exp(-uDamp * uDt);
  gl_FragColor = vec4(vel, f);
}
`

/** position: integrate. w = heat (fast attack, slow decay) used to brighten disturbed particles */
export const positionShader = /* glsl */ `
uniform float uDt;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  float heat = max(v.w, p.w * (1.0 - 1.6 * uDt));
  gl_FragColor = vec4(p.xyz + v.xyz * uDt, heat);
}
`

export const pointsVertex = /* glsl */ `
uniform sampler2D tPos;
uniform float uSize;
uniform float uPixelRatio;
uniform float uFade;
uniform float uSizeScale;
uniform float uKeep;
attribute vec2 aRef;
attribute float aSeed;
varying float vAlpha;
varying float vMix;
varying float vHeat;
void main() {
  vec4 p = texture2D(tPos, aRef);
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  float s = (0.7 + aSeed * 0.5) * (1.0 + p.w * 0.35);
  // as the name shrinks into the header, thin the cloud so small letters stay legible
  float keep = step(aSeed, uKeep);
  gl_PointSize = keep * max(1.0, uSize * uSizeScale * uPixelRatio * s * (16.0 / depth));
  // far/back particles recede; disturbed ones lift
  float z = clamp(0.5 + p.z * 0.12, 0.0, 1.0);
  vAlpha = ((0.54 + 0.3 * z) * (0.82 + 0.18 * aSeed) + p.w * 0.12) * uFade;
  vMix = aSeed;
  vHeat = p.w;
}
`

export const pointsFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
varying float vAlpha;
varying float vMix;
varying float vHeat;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.34, d) * clamp(vAlpha, 0.0, 1.0);
  vec3 c = mix(uColor, uTint, vMix * 0.32 * (1.0 - vHeat));
  gl_FragColor = vec4(c, a);
}
`

export const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uBounds;
attribute vec3 aBase;
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = aBase;
  p.x += sin(uTime * 0.05 + aSeed * 40.0) * 0.9;
  p.y += sin(uTime * 0.04 + aSeed * 23.0) * 0.7;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, (0.9 + aSeed) * uPixelRatio * (14.0 / -mv.z));
  vA = 0.14 + 0.2 * aSeed;
}
`

export const dustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.3, d));
}
`
