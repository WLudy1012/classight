const FLOW = /* glsl */ `
vec3 curl(vec3 p, float t) {
  return vec3(
    cos(p.y + t * 0.61) - sin(p.z - t * 0.47),
    cos(p.z + t * 0.53) - sin(p.x + t * 0.39),
    cos(p.x - t * 0.43) - sin(p.y + t * 0.57)
  );
}
`

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
uniform vec3 uMousePrev;
uniform vec3 uMouseVelocity;
uniform vec3 uCenter;
uniform float uScale;
${FLOW}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  vec4 tg = texture2D(tTarget, uv);
  float seed = tg.w;
  float loose = smoothstep(0.92, 1.0, seed);
  vec3 rest = tg.xyz * uScale + uCenter;
  vec3 current = curl(tg.xyz * 12.0, uTime * 0.65);
  current += curl(tg.xyz * 23.0 + seed * 4.0, uTime * 0.9) * 0.3;
  vec3 target = rest + current * uNoise * (0.5 + seed * 0.35 + loose * 2.8);
  target.z += sin(uTime * 0.72 + tg.x * 10.0 + seed * 2.0) * uNoise * 1.5;

  float k = uSpring * mix(0.06, 1.0, uAssemble) * (0.8 + seed * 0.4);
  vec3 acc = (target - pos) * k;

  vec2 segment = uMouse.xy - uMousePrev.xy;
  float along = clamp(dot(pos.xy - uMousePrev.xy, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
  vec3 nearest = vec3(uMousePrev.xy + segment * along, 0.0);
  vec3 d = pos - nearest;
  d.z *= 0.35;
  float dist = length(d);
  vec3 dir = d / max(dist, 0.001);
  float influence = (1.0 - smoothstep(0.0, uRadius, dist)) * uMouseOn;
  float speed = min(length(uMouseVelocity), 18.0);
  float force = influence * uStrength * (0.65 + seed * 0.55);
  acc += dir * force;
  acc += vec3(-dir.y, dir.x, 0.3 + seed * 0.5) * force * (0.16 + speed * 0.016);
  acc += uMouseVelocity * influence * 1.8;

  vel = (vel + acc * uDt) * exp(-uDamp * uDt);
  vel *= min(1.0, 24.0 / max(length(vel), 0.001));
  gl_FragColor = vec4(vel, influence * (0.45 + speed * 0.03));
}
`

export const positionShader = /* glsl */ `
uniform float uDt;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  float heat = max(v.w, p.w * exp(-1.8 * uDt));
  gl_FragColor = vec4(p.xyz + v.xyz * uDt, heat);
}
`

export const pointsVertex = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tPrevious;
uniform float uBlend;
uniform float uSize;
uniform float uPixelRatio;
uniform float uFade;
uniform float uSizeScale;
uniform float uKeep;
uniform vec3 uLight;
attribute vec2 aRef;
attribute float aSeed;
attribute vec3 aNormal;
varying float vAlpha;
varying float vHeat;
varying float vShade;
varying vec3 vLight;
void main() {
  vec4 p = mix(texture2D(tPrevious, aRef), texture2D(tPos, aRef), uBlend);
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(1.0, -mv.z);
  float keep = step(aSeed, uKeep);
  float s = (0.72 + aSeed * 0.6) * (1.0 + p.w * 0.24);
  gl_PointSize = max(1.0, uSize * uSizeScale * uPixelRatio * s * (16.0 / depth));
  vAlpha = keep * (0.66 + 0.2 * clamp(0.5 + p.z * 0.6, 0.0, 1.0)) * uFade;
  vHeat = p.w;
  vLight = normalize(uLight - p.xyz);
  vShade = max(0.0, dot(aNormal, vLight));
}
`

export const pointsFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
varying float vAlpha;
varying float vHeat;
varying float vShade;
varying vec3 vLight;
void main() {
  vec2 xy = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);
  float r2 = dot(xy, xy);
  if (r2 > 1.0) discard;
  vec3 normal = vec3(xy, sqrt(max(0.0, 1.0 - r2)));
  float diffuse = max(0.0, dot(normal, vLight));
  vec3 halfLight = normalize(vLight + vec3(0.0, 0.0, 1.0));
  float specular = pow(max(0.0, dot(normal, halfLight)), 24.0);
  float light = vShade * 0.42 + diffuse * 0.16;
  vec3 color = mix(uColor * 0.65, uTint, light);
  color += vec3(0.34, 0.36, 0.39) * specular * (0.22 + vHeat * 0.35);
  float alpha = (1.0 - smoothstep(0.55, 1.0, r2)) * vAlpha;
  gl_FragColor = vec4(color, alpha);
}
`

export const shadowVertex = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tPrevious;
uniform float uBlend;
uniform float uSize;
uniform float uSizeScale;
uniform float uPixelRatio;
uniform float uFade;
uniform float uKeep;
uniform vec3 uLight;
attribute vec2 aRef;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 p = mix(texture2D(tPrevious, aRef), texture2D(tPos, aRef), uBlend).xyz;
  float elevation = max(0.06, p.z + 0.55);
  vec3 direction = normalize(uLight - p);
  p.xy -= direction.xy * elevation * 0.32;
  p.z = -0.55;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (uSize + elevation * 3.5) * uSizeScale * uPixelRatio * 16.0 / max(1.0, -mv.z);
  vAlpha = step(aSeed, uKeep) * uFade * 0.07 / (1.0 + elevation);
}
`

export const shadowFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor, vAlpha * exp(-r * r * 4.0) * (1.0 - smoothstep(0.7, 1.0, r)));
}
`

export const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uLight;
attribute vec3 aBase;
attribute float aSeed;
varying float vA;
${FLOW}
void main() {
  vec3 p = aBase + curl(aBase * 0.2 + aSeed, uTime * 0.28) * 0.65;
  p.y += sin(uTime * 0.18 + aSeed * 23.0) * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, (0.85 + aSeed * 1.2) * uPixelRatio * (14.0 / max(1.0, -mv.z)));
  float light = 1.0 / (1.0 + length(uLight.xy - p.xy) * 0.15);
  vA = (0.08 + aSeed * 0.14) * (0.65 + light * 0.6);
}
`

export const dustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, vA * (1.0 - smoothstep(0.2, 0.5, d)));
}
`
