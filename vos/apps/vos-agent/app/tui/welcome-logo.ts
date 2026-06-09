export type LogoCell = Readonly<{
  glyph: string;
  color: `#${string}`;
  bold: boolean;
  dim: boolean;
}>;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
type Vec4 = readonly [number, number, number, number];

const sourceWidth = 1280;
const sourceHeight = 720;
const sourceAspectRatio = sourceWidth / sourceHeight;
const terminalCellAspectRatio = 0.5;
const glyphs = [" ", "·", "•", "●", "●"] as const;

type ShaderLogoOptions = Readonly<{
  width: number;
  height: number;
  time: number;
  zoom?: number;
}>;

export function logoColumnsForHeight(height: number): number {
  return Math.round((height * sourceAspectRatio) / terminalCellAspectRatio);
}

export function logoRowsForColumns(columns: number): number {
  return Math.round((columns * terminalCellAspectRatio) / sourceAspectRatio);
}

export function renderShaderLogo({ width, height, time, zoom = 1 }: ShaderLogoOptions): LogoCell[][] {
  const resolution: Vec2 = [sourceWidth, sourceHeight];
  const sampleWidth = sourceWidth / zoom;
  const sampleHeight = sourceHeight / zoom;
  const origin: Vec2 = [(sourceWidth - sampleWidth) / 2, (sourceHeight - sampleHeight) / 2];

  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) => {
      const color = shaderSample(
        [
          origin[0] + ((column + 0.5) / width) * sampleWidth,
          origin[1] + ((height - row - 0.5) / height) * sampleHeight,
        ],
        resolution,
        time,
      );
      const red = clamp(color[0], 0, 1);
      const green = clamp(color[1], 0, 1);
      const blue = clamp(color[2], 0, 1);
      const peak = Math.max(red, green, blue);
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const signal = clamp(luminance * 1.65 + peak * 0.45, 0, 1);
      const glyphIndex = Math.min(glyphs.length - 1, Math.floor(signal * glyphs.length * 1.15));

      return {
        glyph: glyphs[glyphIndex],
        color: rgbToHex([
          clamp(red * 1.25 + signal * 0.08, 0, 1),
          clamp(green * 1.2 + signal * 0.05, 0, 1),
          clamp(blue * 1.25 + signal * 0.1, 0, 1),
        ]),
        bold: signal > 0.68,
        dim: signal < 0.2,
      };
    }),
  );
}

function shaderSample(fragCoord: Vec2, resolution: Vec2, time: number): Vec4 {
  const pos: Vec3 = [
    fragCoord[0] - resolution[0] / 2,
    fragCoord[1] - resolution[1] / 2,
    0,
  ];
  const light = normalize3([Math.sin(time), Math.sin(time * 0.5), Math.cos(time)]);
  const radius = resolution[1] / 3;
  const radiusSquared = radius * radius;
  const xySquared = pos[0] * pos[0] + pos[1] * pos[1];
  let color = 0;

  if (xySquared <= radiusSquared) {
    const zIn = Math.sqrt(Math.max(radiusSquared - xySquared, 0));
    let normal = normalize3([pos[0], pos[1], zIn]);
    const normalOffset = 0.05;
    const nx = fbm([normal[0] + normalOffset, normal[1], normal[2]]) * 0.5 + 0.5;
    const ny = fbm([normal[0], normal[1] + normalOffset, normal[2]]) * 0.5 + 0.5;
    const nz = fbm([normal[0], normal[1], normal[2] + normalOffset]) * 0.5 + 0.5;
    normal = normalize3([normal[0] * nx, normal[1] * ny, normal[2] * nz]);

    const texture = 1 - (fbm(normal) * 0.5 + 0.5);
    const innerAtmosphere = Math.max(0, (radius * 0.2) / Math.max(zIn, 0.0001) - 0.2);
    const diffuse = Math.max(0, dot3(normal, light));
    color += texture * diffuse + innerAtmosphere * diffuse;
  }

  if (xySquared >= radiusSquared) {
    const zOut = Math.sqrt(Math.max(xySquared - radiusSquared, 0));
    const normalOut = normalize3([pos[0], pos[1], zOut]);
    const outerAtmosphere = Math.max(0, (radius * 0.2) / Math.max(zOut, 0.0001) - 0.4);
    const diffuseOut = Math.max(0, dot3(normalOut, light) + 0.3);
    color += outerAtmosphere * diffuseOut;
  }

  return [color, color, color, 1];
}

function noise3D(p: Vec3): number {
  return fract(Math.sin(dot3(p, [12.9898, 78.233, 128.852])) * 43758.5453) * 2 - 1;
}

function simplex3D(p: Vec3): number {
  const f3 = 1 / 3;
  const s = (p[0] + p[1] + p[2]) * f3;
  const i = Math.floor(p[0] + s);
  const j = Math.floor(p[1] + s);
  const k = Math.floor(p[2] + s);
  const g3 = 1 / 6;
  const t = (i + j + k) * g3;
  const x0 = p[0] - (i - t);
  const y0 = p[1] - (j - t);
  const z0 = p[2] - (k - t);
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  let i2 = 0;
  let j2 = 0;
  let k2 = 0;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1;
      i2 = 1;
      j2 = 1;
    } else if (x0 >= z0) {
      i1 = 1;
      i2 = 1;
      k2 = 1;
    } else {
      k1 = 1;
      i2 = 1;
      k2 = 1;
    }
  } else if (y0 < z0) {
    k1 = 1;
    j2 = 1;
    k2 = 1;
  } else if (x0 < z0) {
    j1 = 1;
    j2 = 1;
    k2 = 1;
  } else {
    j1 = 1;
    i2 = 1;
    j2 = 1;
  }

  const x1 = x0 - i1 + g3;
  const y1 = y0 - j1 + g3;
  const z1 = z0 - k1 + g3;
  const x2 = x0 - i2 + 2 * g3;
  const y2 = y0 - j2 + 2 * g3;
  const z2 = z0 - k2 + 2 * g3;
  const x3 = x0 - 1 + 3 * g3;
  const y3 = y0 - 1 + 3 * g3;
  const z3 = z0 - 1 + 3 * g3;
  const ijk0: Vec3 = [i, j, k];
  const ijk1: Vec3 = [i + i1, j + j1, k + k1];
  const ijk2: Vec3 = [i + i2, j + j2, k + k2];
  const ijk3: Vec3 = [i + 1, j + 1, k + 1];
  const gr0 = noiseGradient(ijk0);
  const gr1 = noiseGradient(ijk1);
  const gr2 = noiseGradient(ijk2);
  const gr3 = noiseGradient(ijk3);

  return 96 * (
    simplexContribution([x0, y0, z0], gr0) +
    simplexContribution([x1, y1, z1], gr1) +
    simplexContribution([x2, y2, z2], gr2) +
    simplexContribution([x3, y3, z3], gr3)
  );
}

function fbm(p: Vec3): number {
  let value = 0;
  let point = p;
  value += 0.5 * simplex3D(point);
  point = scale3(point, 2.01);
  value += 0.25 * simplex3D(point);
  point = scale3(point, 2.02);
  value += 0.125 * simplex3D(point);
  point = scale3(point, 2.03);
  value += 0.0625 * simplex3D(point);
  point = scale3(point, 2.04);
  value += 0.03125 * simplex3D(point);
  point = scale3(point, 2.05);
  value += 0.015625 * simplex3D(point);

  return value;
}

function noiseGradient(point: Vec3): Vec3 {
  return normalize3([
    noise3D(point),
    noise3D(scale3(point, 2.01)),
    noise3D(scale3(point, 2.02)),
  ]);
}

function simplexContribution(offset: Vec3, gradient: Vec3): number {
  let t = 0.5 - dot3(offset, offset);
  if (t < 0) {
    return 0;
  }

  t *= t;
  return t * t * dot3(gradient, offset);
}

function addScalar3(value: Vec3, scalar: number): Vec3 {
  return [value[0] + scalar, value[1] + scalar, value[2] + scalar];
}

function scale3(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot3(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length3(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize3(value: Vec3): Vec3 {
  const length = length3(value);
  if (length <= 0.00001) {
    return [0, 0, 0];
  }

  return [value[0] / length, value[1] / length, value[2] / length];
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function componentToHex(value: number): string {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex([red, green, blue]: Vec3): `#${string}` {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`;
}
