/** Exact bookkeeping for finite nonnegative binary lengths. This decides cuts
 * and ownership only; physical coordinate APIs continue to use Numbers. */
const buffer = new ArrayBuffer(8), view = new DataView(buffer);
export function binaryLength(x: number) {
  if (!(x >= 0) || !Number.isFinite(x)) throw Error('Invalid exact length');
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0), e = Number((bits >> 52n) & 2047n), m = bits & ((1n << 52n) - 1n);
  return { mantissa: e ? m + (1n << 52n) : m, exponent: e ? e - 1075 : -1074 };
}
export function exactLengthScale(values: readonly number[]) {
  const pieces = values.map(binaryLength), exponent = pieces.reduce((e, p) => p.mantissa ? Math.min(e, p.exponent) : e, 0);
  const units = (x: number) => {
    const p = binaryLength(x);
    const shift = p.exponent - exponent;
    if (shift >= 0) return p.mantissa << BigInt(shift);
    const divisor = 1n << BigInt(-shift);
    if (p.mantissa % divisor) throw Error('Length below the declared exact scale');
    return p.mantissa / divisor;
  };
  const chunks = (u: bigint) => {
    if (u < 0n) throw Error('Negative exact length');
    const out: number[] = [];
    while (u > 0n) {
      const shift = Math.max(0, u.toString(2).length - 53), mantissa = u >> BigInt(shift);
      const height = Number(mantissa) * 2 ** (exponent + shift);
      if (!(height > 0) || !Number.isFinite(height)) throw Error('Unrepresentable exact length chunk');
      out.push(height); u -= mantissa << BigInt(shift);
    }
    return out;
  };
  // Project the exact value once. Adding its chunks sequentially can lose a
  // sticky low bit at a half-ULP tie and round the physical height incorrectly.
  const number = (u: bigint) => {
    if (u < 0n) throw Error('Negative exact length');
    if (u === 0n) return 0;
    const shift = Math.max(0, u.toString(2).length - 53);
    let mantissa = u >> BigInt(shift);
    if (shift > 0) {
      const remainder = u - (mantissa << BigInt(shift)), half = 1n << BigInt(shift - 1);
      if (remainder > half || (remainder === half && (mantissa & 1n) !== 0n)) mantissa++;
    }
    const value = Number(mantissa) * 2 ** (exponent + shift);
    if (!(value > 0) || !Number.isFinite(value)) throw Error('Unrepresentable exact length projection');
    return value;
  };
  return { exponent, units, chunks, number };
}
