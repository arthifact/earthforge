//! Certified bounded fast path for software f64 FMA on WebAssembly.
//! Dekker splitting and error-free TwoSum recover an expansion of a*b+c.
//! An outward interval must fit strictly within the candidate's rounding cell;
//! ties, special values and values outside the safe normal range use std FMA.
//! Primary background: https://ir.cwi.nl/pub/9158 (Dekker, 1971).
const LOWER: f64 = f64::from_bits((1023 - 400) << 52);
const UPPER: f64 = f64::from_bits((1023 + 400) << 52);
#[inline]
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let sum = a + b;
    let taken = sum - a;
    (sum, (a - (sum - taken)) + (b - taken))
}
#[inline]
fn bounded(x: f64) -> bool {
    x.abs() >= LOWER && x.abs() <= UPPER
}
#[inline]
fn try_fma(a: f64, b: f64, c: f64) -> Option<f64> {
    if !bounded(a) || !bounded(b) || !bounded(c) {
        return None;
    }
    let product = a * b;
    let (sum, sum_error) = two_sum(product, c);
    if !bounded(product) || !bounded(sum) {
        return None;
    }
    // The exponent guards leave ample headroom for splitting and ensure the
    // smallest product/error lattice is normal. Keep these operations unfused.
    const SPLIT: f64 = 134_217_729.0; // 2^27 + 1 for binary64.
    let split_a = SPLIT * a;
    let high_a = split_a - (split_a - a);
    let low_a = a - high_a;
    let split_b = SPLIT * b;
    let high_b = split_b - (split_b - b);
    let low_b = b - high_b;
    let error_1 = product - high_a * high_b;
    let error_2 = error_1 - low_a * high_b;
    let error_3 = error_2 - high_a * low_b;
    let product_error = low_a * low_b - error_3;
    let (tail, tail_error) = two_sum(sum_error, product_error);
    let (candidate, remainder) = two_sum(sum, tail);
    if !bounded(candidate) {
        return None;
    }
    // Exact value = candidate + remainder + tail_error. Widen each rounded
    // bound by one representable step, enclosing the exact residual without
    // assuming that a second nearest rounding cannot land on a tie.
    let lo = (remainder - tail_error.abs()).next_down();
    let hi = (remainder + tail_error.abs()).next_up();
    let half_down = (candidate - candidate.next_down()) * 0.5;
    let half_up = (candidate.next_up() - candidate) * 0.5;
    (lo > -half_down && hi < half_up).then_some(candidate)
}
#[inline]
pub(crate) fn fma(a: f64, b: f64, c: f64) -> f64 {
    try_fma(a, b, c).unwrap_or_else(|| a.mul_add(b, c))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn random(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }
    fn equal(a: f64, b: f64) {
        assert!(
            a.is_nan() && b.is_nan() || a.to_bits() == b.to_bits(),
            "{a:?} != {b:?}"
        );
    }
    #[test]
    fn bounded_expansions_match_independent_hardware_fma_including_cancellation() {
        let mut state = 0x79b5_ac13_84ef_693d;
        let mut fast = 0;
        for i in 0..2_000_000 {
            let mut value = || {
                let bits = random(&mut state);
                let exponent = ((bits >> 52) % 401) + 823;
                f64::from_bits((bits & 0x800f_ffff_ffff_ffff) | (exponent << 52))
            };
            let a = value();
            let b = value();
            let mut c = value();
            if i % 7 == 0 {
                c = -(a * b);
                if i % 3 == 0 {
                    c = c.next_up();
                }
                if i % 3 == 1 {
                    c = c.next_down();
                }
            }
            let expected = a.mul_add(b, c);
            if let Some(result) = try_fma(a, b, c) {
                fast += 1;
                equal(result, expected);
            }
            equal(fma(a, b, c), expected);
        }
        assert!(fast > 1_000_000, "fast path exercised only {fast} times");
        eprintln!(
            "Portable FMA: {fast}/2000000 bounded/cancellation cases certified, all match hardware"
        );
    }
    #[test]
    fn special_extreme_and_tie_inputs_preserve_ieee_fallback_behavior() {
        let mut state = 0x5293_7a1d_8fed_413b;
        for _ in 0..200_000 {
            let a = f64::from_bits(random(&mut state));
            let b = f64::from_bits(random(&mut state));
            let c = f64::from_bits(random(&mut state));
            equal(fma(a, b, c), a.mul_add(b, c));
        }
        for a in [
            -0.0,
            0.0,
            f64::MIN_POSITIVE,
            f64::from_bits(1),
            f64::MAX,
            f64::INFINITY,
            f64::NAN,
        ] {
            for b in [-1.0, 0.0, 1.0, f64::INFINITY] {
                for c in [-0.0, 0.0, -f64::MIN_POSITIVE, f64::MAX, f64::NEG_INFINITY] {
                    equal(fma(a, b, c), a.mul_add(b, c));
                }
            }
        }
        for power in -50..=50 {
            let a = (power as f64).exp2();
            for b in [1.0 + 2.0f64.powi(-27), 1.0 - 2.0f64.powi(-27)] {
                for c in [-a, (-a).next_up(), (-a).next_down()] {
                    equal(fma(a, b, c), a.mul_add(b, c));
                }
            }
        }
    }
}
