/** Exact bookkeeping for finite nonnegative binary lengths. This decides cuts
 * and ownership only; physical coordinate APIs continue to use Numbers. */
const buffer = new ArrayBuffer(8), view = new DataView(buffer);
export interface BinaryLength { readonly mantissa: bigint; readonly exponent: number }
const TWO32 = 4294967296, TWO52 = 4503599627370496;
export function binaryLength(x: number): BinaryLength {
  if (!(x >= 0) || !Number.isFinite(x)) throw Error('Invalid exact length');
  // Two 32-bit reads and one BigInt conversion; the same mantissa and exponent as the IEEE fields.
  view.setFloat64(0, x);
  const hi = view.getUint32(0), lo = view.getUint32(4), e = (hi >>> 20) & 2047, m = (hi & 0xfffff) * TWO32 + lo;
  return { mantissa: BigInt(e ? m + TWO52 : m), exponent: e ? e - 1075 : -1074 };
}
/** The binary exponent of a finite nonnegative length alone, without a BigInt. */
export function binaryExponent(x: number): number {
  if (!(x >= 0) || !Number.isFinite(x)) throw Error('Invalid exact length');
  view.setFloat64(0, x);
  const e = (view.getUint32(0) >>> 20) & 2047;
  return e ? e - 1075 : -1074;
}
/** The scale exponent after one more length: the smallest exponent of any nonzero value. */
export const exponentWith = (x: number, exponent: number) => { const e = binaryExponent(x); return x !== 0 && e < exponent ? e : exponent; };
// Small BigInt constants are reused rather than converted on every shift.
const bigints: bigint[] = [], powers: bigint[] = [];
const big = (n: number) => bigints[n] ?? (bigints[n] = BigInt(n));
const pow2 = (n: number) => powers[n] ?? (powers[n] = 1n << BigInt(n));
const TWO1000 = 1n << 1000n;
/** Number of binary digits of a nonnegative BigInt, without rendering it as text. */
export function bitLength(u: bigint): number {
  if (u < 0n) throw Error('Negative exact length');
  if (u === 0n) return 0;
  // Values near or above 1024 bits overflow Number; they are rare and reduced first.
  let n = 0;
  while (u >= TWO1000) { u >>= 1000n; n += 1000; }
  // Number(u) rounds, so the estimate may be off by one either way; comparisons
  // against cached powers of two settle it without allocating anything.
  let k = Math.floor(Math.log2(Number(u))) + 1;
  while (k > 1 && u < pow2(k - 1)) k--;
  while (u >= pow2(k)) k++;
  return n + k;
}
export function exactLengthScale(values: readonly number[]) {
  let exponent = 0;
  for (const value of values) exponent = exponentWith(value, exponent);
  return exactLengthScaleAt(exponent);
}
export type LengthScale = ReturnType<typeof exactLengthScaleAt>;
/** The exact scale with a given exponent; callers that iterate their lengths without building arrays use this. */
export function exactLengthScaleAt(exponent: number) {
  const units = (x: number) => {
    const p = binaryLength(x);
    const shift = p.exponent - exponent;
    if (shift >= 0) return shift ? p.mantissa << big(shift) : p.mantissa;
    const divisor = pow2(-shift);
    if (p.mantissa % divisor) throw Error('Length below the declared exact scale');
    return p.mantissa / divisor;
  };
  const chunks = (u: bigint) => {
    if (u < 0n) throw Error('Negative exact length');
    const out: number[] = [];
    while (u > 0n) {
      const shift = Math.max(0, bitLength(u) - 53), mantissa = shift ? u >> big(shift) : u;
      const height = Number(mantissa) * 2 ** (exponent + shift);
      if (!(height > 0) || !Number.isFinite(height)) throw Error('Unrepresentable exact length chunk');
      out.push(height); u -= shift ? mantissa << big(shift) : mantissa;
    }
    return out;
  };
  // Project the exact value once. Adding its chunks sequentially can lose a
  // sticky low bit at a half-ULP tie and round the physical height incorrectly.
  const number = (u: bigint) => {
    if (u < 0n) throw Error('Negative exact length');
    if (u === 0n) return 0;
    const shift = Math.max(0, bitLength(u) - 53);
    let mantissa = shift ? u >> big(shift) : u;
    if (shift > 0) {
      const remainder = u - (mantissa << big(shift)), half = pow2(shift - 1);
      if (remainder > half || (remainder === half && (mantissa & 1n) !== 0n)) mantissa++;
    }
    const value = Number(mantissa) * 2 ** (exponent + shift);
    if (!(value > 0) || !Number.isFinite(value)) throw Error('Unrepresentable exact length projection');
    return value;
  };
  return { exponent, units, chunks, number };
}
