//! Compare the fixed-width optimization with an unbounded integer oracle.
use earthforge_core::{exact::Scale, material::Layer};
use num_bigint::{BigInt, BigUint, Sign};
use num_traits::{ToPrimitive, Zero};
fn next(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}
fn oracle_units(value: f64, exponent: i32) -> BigInt {
    let bits = value.to_bits();
    let biased = ((bits >> 52) & 2047) as i32;
    let mut significand = BigUint::from(bits & ((1u64 << 52) - 1));
    let power = if biased == 0 {
        -1074
    } else {
        significand += BigUint::from(1u8) << 52;
        biased - 1075
    };
    let shift = power - exponent;
    let units = if shift >= 0 {
        significand << shift as usize
    } else {
        let denominator = BigUint::from(1u8) << (-shift) as usize;
        assert!((&significand % &denominator).is_zero());
        significand / denominator
    };
    BigInt::from_biguint(
        if bits >> 63 == 0 {
            Sign::Plus
        } else {
            Sign::Minus
        },
        units,
    )
}
#[test]
fn fixed_width_units_and_promoted_sums_match_unbounded_integer_oracle() {
    let mut seed = 0xa1772_617deadbeef;
    for iteration in 0..5000 {
        let mut values = Vec::new();
        for _ in 0..(iteration % 8 + 1) {
            // Exercise the full finite exponent range, including subnormals.
            values.push(f64::from_bits(next(&mut seed) % 0x7ff0000000000000));
        }
        let cancelled = f64::from_bits(next(&mut seed) % 0x7ff0000000000000);
        values.extend([-cancelled, cancelled]);
        let scale = Scale::new(values.iter().map(|x| x.abs())).unwrap();
        let mut expected = BigInt::zero();
        for &value in &values {
            let oracle = oracle_units(value, scale.exponent);
            assert_eq!(scale.signed(value).unwrap(), oracle);
            expected += oracle;
        }
        assert_eq!(scale.sum(values).unwrap(), expected.to_biguint().unwrap());
    }
    let scale = Scale { exponent: 0 };
    assert_eq!(scale.units(0.0).unwrap(), BigUint::zero());
    assert_eq!(scale.units(-0.0).unwrap(), BigUint::zero());
    assert!(scale.units(0.5).is_err());
    assert!(scale.units(f64::NAN).is_err());
    assert!(scale.sum([1.0, -2.0]).is_err());
    // A nonzero integer exactly at the fixed-width edge must promote on sum.
    let large = 2.0f64.powi(127);
    assert_eq!(
        scale.sum([large, large, -large]).unwrap(),
        BigUint::from(1u8) << 127
    );
}
#[test]
fn fixed_width_projection_rounds_like_big_integer_and_chunks_reconstruct_exactly() {
    let mut seed = 0x42de71ad_u64;
    let mut cases = vec![0, 1, u128::MAX];
    for k in 53..128 {
        let first = 1u128 << k;
        let halfway = 1u128 << (k - 53);
        cases.extend([first + halfway - 1, first + halfway, first + halfway + 1]);
    }
    for _ in 0..20000 {
        cases.push(((next(&mut seed) as u128) << 64) | next(&mut seed) as u128);
    }
    for value in cases {
        let integer = BigUint::from(value);
        for exponent in [-96, -64, 0] {
            let scale = Scale { exponent };
            let expected = integer.to_f64().unwrap() * 2.0f64.powi(exponent);
            assert_eq!(
                scale.number(&integer).unwrap().to_bits(),
                expected.to_bits()
            );
            let chunks = scale.chunks(&integer).unwrap();
            let restored: BigInt = chunks.into_iter().map(|x| oracle_units(x, exponent)).sum();
            assert_eq!(restored.to_biguint().unwrap(), integer);
        }
    }
}
#[test]
fn exact_material_extents_keep_memory_without_retaining_empty_allocations() {
    let mut layer = Layer::empty(7, 10.0);
    layer.solid = 4.0;
    layer.fraction = 0.3;
    layer.burial = 100.0;
    layer.loading = 70.0;
    layer.offset_x = 0.1;
    layer.offset_y = 0.2;
    layer.offset_z = 0.3;
    layer.lengths = vec![10.0, 2.0f64.powi(-60)];
    let simple = layer.with_lengths(vec![3.0, 7.0]).unwrap();
    assert_eq!(simple.height, 10.0);
    assert_eq!(simple.lengths.capacity(), 0);
    assert_eq!(
        (
            simple.bed,
            simple.solid,
            simple.fraction,
            simple.burial,
            simple.loading,
            simple.offset_x,
            simple.offset_y,
            simple.offset_z
        ),
        (7, 4.0, 0.3, 100.0, 70.0, 0.1, 0.2, 0.3)
    );
    let thin = layer.with_lengths(vec![10.0, 2.0f64.powi(-60)]).unwrap();
    assert_eq!(thin.lengths, layer.lengths);
    let none = layer.portion(vec![0.0]).unwrap();
    assert_eq!((none.height, none.solid), (0.0, 0.0));
    assert_eq!(none.lengths.capacity(), 0);
    assert!(layer.with_lengths(vec![0.0]).is_err());
}
