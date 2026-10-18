//! Exact interval ownership. Physical constitutive evaluations still use f64.
use num_bigint::{BigInt, BigUint, Sign};
use num_traits::{ToPrimitive, Zero};

pub fn binary(x: f64) -> Result<(u64, i32), String> {
    if !x.is_finite() || x < 0.0 {
        return Err("Invalid exact length".into());
    }
    let bits = x.to_bits();
    let e = ((bits >> 52) & 2047) as i32;
    let m = bits & ((1u64 << 52) - 1);
    Ok((
        if e == 0 { m } else { m + (1u64 << 52) },
        if e == 0 { -1074 } else { e - 1075 },
    ))
}

#[derive(Clone, Copy, Debug)]
pub struct Scale {
    pub exponent: i32,
}
impl Scale {
    pub fn new(values: impl IntoIterator<Item = f64>) -> Result<Self, String> {
        let mut exponent = 0;
        for x in values {
            let (_, e) = binary(x)?;
            if x != 0.0 {
                exponent = exponent.min(e);
            }
        }
        Ok(Self { exponent })
    }
    // Most model lengths need at most two machine words at their shared scale.
    // A non-fitting value is promoted; no precision is discarded.
    fn small_units(self, x: f64) -> Result<Option<u128>, String> {
        let (m, e) = binary(x)?;
        if m == 0 {
            return Ok(Some(0));
        }
        let shift = e.checked_sub(self.exponent).ok_or("Invalid exact scale")?;
        if shift >= 0 {
            let width = 64 - m.leading_zeros();
            return Ok((shift as u32 <= 128 - width).then(|| (m as u128) << shift));
        }
        let right = shift.unsigned_abs();
        if right >= 64 || m & ((1u64 << right) - 1) != 0 {
            return Err("Length below the declared exact scale".into());
        }
        Ok(Some((m >> right) as u128))
    }
    pub fn units(self, x: f64) -> Result<BigUint, String> {
        if let Some(n) = self.small_units(x)? {
            return Ok(BigUint::from(n));
        }
        let (m, e) = binary(x)?;
        Ok(BigUint::from(m) << (e - self.exponent) as usize)
    }
    pub fn signed(self, x: f64) -> Result<BigInt, String> {
        Ok(BigInt::from_biguint(
            if x < 0.0 { Sign::Minus } else { Sign::Plus },
            self.units(x.abs())?,
        ))
    }
    pub fn sum(self, values: impl IntoIterator<Item = f64>) -> Result<BigUint, String> {
        let mut small = 0i128;
        let mut promoted: Option<BigInt> = None;
        for x in values {
            if let Some(big) = &mut promoted {
                *big += self.signed(x)?;
                continue;
            }
            let term = self
                .small_units(x.abs())?
                .and_then(|n| i128::try_from(n).ok())
                .and_then(|n| if x < 0.0 { n.checked_neg() } else { Some(n) });
            if let Some(sum) = term.and_then(|n| small.checked_add(n)) {
                small = sum;
            } else {
                promoted = Some(BigInt::from(small) + self.signed(x)?);
            }
        }
        match promoted {
            Some(big) => big.to_biguint(),
            None if small >= 0 => Some(BigUint::from(small as u128)),
            None => None,
        }
        .ok_or_else(|| "Negative exact length".into())
    }
    fn scaled(self, mantissa: u64, shift: usize) -> Result<f64, String> {
        // Multiply in the normal range first so a representable subnormal is not
        // lost by evaluating 2^exponent in isolation.
        let e = self.exponent + shift as i32;
        let x = if e < -1022 {
            (mantissa as f64 * 2.0f64.powi(e + 1022)) * f64::MIN_POSITIVE
        } else {
            mantissa as f64 * 2.0f64.powi(e)
        };
        if !(x > 0.0 && x.is_finite()) {
            return Err("Unrepresentable exact length projection".into());
        }
        Ok(x)
    }
    pub fn number(self, n: &BigUint) -> Result<f64, String> {
        if n.is_zero() {
            return Ok(0.0);
        }
        if let Some(value) = n.to_u128() {
            let shift = (128 - value.leading_zeros()).saturating_sub(53);
            let mut m = (value >> shift) as u64;
            if shift > 0 {
                let remainder = value & ((1u128 << shift) - 1);
                let half = 1u128 << (shift - 1);
                if remainder > half || (remainder == half && m & 1 != 0) {
                    m += 1;
                }
            }
            return self.scaled(m, shift as usize);
        }
        let shift = n.bits().saturating_sub(53) as usize;
        let mut m = (n >> shift).to_u64().ok_or("Invalid exact mantissa")?;
        if shift > 0 {
            let remainder = n - ((n >> shift) << shift);
            let half = BigUint::from(1u8) << (shift - 1);
            if remainder > half || (remainder == half && m & 1 != 0) {
                m += 1;
            }
        }
        self.scaled(m, shift)
    }
    pub fn chunks(self, n: &BigUint) -> Result<Vec<f64>, String> {
        if let Some(mut left) = n.to_u128() {
            let mut out = Vec::new();
            while left != 0 {
                let shift = (128 - left.leading_zeros()).saturating_sub(53);
                out.push(self.scaled((left >> shift) as u64, shift as usize)?);
                left = if shift == 0 {
                    0
                } else {
                    left & ((1u128 << shift) - 1)
                };
            }
            return Ok(out);
        }
        let mut left = n.clone();
        let mut out = Vec::new();
        while !left.is_zero() {
            let shift = left.bits().saturating_sub(53) as usize;
            let m = (&left >> shift).to_u64().ok_or("Invalid exact mantissa")?;
            out.push(self.scaled(m, shift)?);
            left -= BigUint::from(m) << shift;
        }
        Ok(out)
    }
}
