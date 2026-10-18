//! Shared scalar compatibility with the V8 13.6 reference (Node 24.18).
//! Fused operations are explicit, so compiler contraction flags cannot change
//! fault geometry or compaction branches. Large trig arguments use pinned libm.
//! The generator uses only the small/medium argument path.
//! See ../licenses/V8.txt and the Sun permission notice below.
// Copyright (C) 1993, 2004 Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
// V8 adaptations Copyright 2016 the V8 project authors. All rights reserved.
const LN2_HI: f64 = f64::from_bits(0x3fe62e42fee00000);
const LN2_LO: f64 = f64::from_bits(0x3dea39ef35793c76);
const INV_LN2: f64 = f64::from_bits(0x3ff71547652b82fe);
fn high(x: f64) -> u32 {
    (x.to_bits() >> 32) as u32
}
fn pow2(k: i32) -> f64 {
    f64::from_bits(((1023 + k) as u64) << 52)
}
fn chopped(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & 0xffffffff00000000)
}
pub fn exp(mut x: f64) -> f64 {
    let hx = high(x) & 0x7fffffff;
    let negative = x.is_sign_negative();
    if !x.is_finite() {
        return if x == f64::NEG_INFINITY { 0.0 } else { x + x };
    }
    if x > f64::from_bits(0x40862e42fefa39ef) {
        return f64::INFINITY;
    }
    if x < f64::from_bits(0xc0874910d52d3051) {
        return 0.0;
    }
    let mut k = 0;
    let mut hi = 0.0;
    let mut lo = 0.0;
    if hx > 0x3fd62e42 {
        if hx < 0x3ff0a2b2 {
            if x == 1.0 {
                return std::f64::consts::E;
            }
            if negative {
                hi = x + LN2_HI;
                lo = -LN2_LO;
                k = -1;
            } else {
                hi = x - LN2_HI;
                lo = LN2_LO;
                k = 1;
            }
        } else {
            k = (INV_LN2.mul_add(x, if negative { -0.5 } else { 0.5 })) as i32;
            hi = (-(k as f64)).mul_add(LN2_HI, x);
            lo = k as f64 * LN2_LO;
        }
        x = hi - lo;
    } else if hx < 0x3e300000 {
        return 1.0 + x;
    }
    let p = [
        f64::from_bits(0x3fc555555555553e),
        f64::from_bits(0xbf66c16c16bebd93),
        f64::from_bits(0x3f11566aaf25de2c),
        f64::from_bits(0xbebbbd41c5d26bf1),
        f64::from_bits(0x3e66376972bea4d0),
    ];
    let t = x * x;
    let poly = t.mul_add(p[4], p[3]);
    let poly = t.mul_add(poly, p[2]);
    let poly = t.mul_add(poly, p[1]);
    let poly = t.mul_add(poly, p[0]);
    let c = (-t).mul_add(poly, x);
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 {
            y * 2.0 * pow2(1023)
        } else {
            y * pow2(k)
        }
    } else {
        y * pow2(k + 1000) * pow2(-1000)
    }
}
pub fn expm1(mut x: f64) -> f64 {
    let hx = high(x) & 0x7fffffff;
    let negative = x.is_sign_negative();
    if x.is_nan() {
        return x + x;
    }
    if x == f64::INFINITY {
        return x;
    }
    if x == f64::NEG_INFINITY {
        return -1.0;
    }
    if x > f64::from_bits(0x40862e42fefa39ef) {
        return f64::INFINITY;
    }
    if hx >= 0x4043687a && negative {
        return -1.0;
    }
    let k;
    let c;
    if hx > 0x3fd62e42 {
        let hi;
        let lo;
        if hx < 0x3ff0a2b2 {
            if negative {
                hi = x + LN2_HI;
                lo = -LN2_LO;
                k = -1;
            } else {
                hi = x - LN2_HI;
                lo = LN2_LO;
                k = 1;
            }
        } else {
            k = (INV_LN2.mul_add(x, if negative { -0.5 } else { 0.5 })) as i32;
            hi = (-(k as f64)).mul_add(LN2_HI, x);
            lo = k as f64 * LN2_LO;
        }
        x = hi - lo;
        c = (hi - x) - lo;
    } else if hx < 0x3c900000 {
        return x;
    } else {
        k = 0;
        c = 0.0;
    }
    let q = [
        f64::from_bits(0xbfa11111111110f4),
        f64::from_bits(0x3f5a01a019fe5585),
        f64::from_bits(0xbf14ce199eaadbb7),
        f64::from_bits(0x3ed0cfca86e65239),
        f64::from_bits(0xbe8afdb76e09c32d),
    ];
    let hfx = 0.5 * x;
    let hxs = x * hfx;
    let r1 = hxs.mul_add(q[4], q[3]);
    let r1 = hxs.mul_add(r1, q[2]);
    let r1 = hxs.mul_add(r1, q[1]);
    let r1 = hxs.mul_add(r1, q[0]);
    let r1 = hxs.mul_add(r1, 1.0);
    let t = (-r1).mul_add(hfx, 3.0);
    let mut e = hxs * ((r1 - t) / (-x).mul_add(t, 6.0));
    if k == 0 {
        return x - x.mul_add(e, -hxs);
    }
    e = x.mul_add(e - c, -c);
    e -= hxs;
    if k == -1 {
        return (x - e).mul_add(0.5, -0.5);
    }
    if k == 1 {
        return if x < -0.25 {
            -2.0 * (e - (x + 0.5))
        } else {
            (x - e).mul_add(2.0, 1.0)
        };
    }
    if k <= -2 || k > 56 {
        let y = 1.0 - (e - x);
        return if k == 1024 {
            y * 2.0 * pow2(1023) - 1.0
        } else {
            y * pow2(k) - 1.0
        };
    }
    let y = if k < 20 {
        let t = f64::from_bits(((0x3ff00000u32 - (0x200000u32 >> k)) as u64) << 32);
        t - (e - x)
    } else {
        let t = pow2(-k);
        let mut y = x - (e + t);
        y += 1.0;
        y
    };
    y * pow2(k)
}
pub fn tanh(x: f64) -> f64 {
    if x.is_nan() {
        return x + x;
    }
    if x.is_infinite() {
        return x.signum();
    }
    let a = x.abs();
    let hx = high(a);
    if hx < 0x3e300000 {
        return x;
    }
    let z = if hx < 0x40360000 {
        if hx >= 0x3ff00000 {
            let t = expm1(2.0 * a);
            1.0 - 2.0 / (t + 2.0)
        } else {
            let t = expm1(-2.0 * a);
            -t / (t + 2.0)
        }
    } else {
        1.0
    };
    if x.is_sign_negative() { -z } else { z }
}
pub fn cbrt(x: f64) -> f64 {
    let raw = x.to_bits();
    let sign = raw & 0x8000000000000000;
    let hx = high(x) & 0x7fffffff;
    if hx >= 0x7ff00000 {
        return x + x;
    }
    if raw & 0x7fffffffffffffff == 0 {
        return x;
    }
    let rough = if hx < 0x00100000 {
        (high(x * pow2(54)) & 0x7fffffff) / 3 + 696219795
    } else {
        hx / 3 + 715094163
    };
    let mut t = f64::from_bits(sign | ((rough as u64) << 32));
    let p = [
        f64::from_bits(0x3ffe03e60f61e692),
        f64::from_bits(0xbffe28e092f02420),
        f64::from_bits(0x3ff9f1604a49d6c2),
        f64::from_bits(0xbfe844cbbee751d9),
        f64::from_bits(0x3fc2b000d4e4edd7),
    ];
    let r = (t * t) * (t / x);
    t *= ((r * r) * r).mul_add(
        r.mul_add(p[4], p[3]),
        r.mul_add(r.mul_add(p[2], p[1]), p[0]),
    );
    t = f64::from_bits(t.to_bits().wrapping_add(0x80000000) & 0xffffffffc0000000);
    let s = t * t;
    let r = x / s;
    let w = t + t;
    let r = (r - t) / (w + r);
    t.mul_add(r, t)
}
fn reduce(x: f64) -> (i32, f64, f64) {
    let h = high(x);
    let ix = h & 0x7fffffff;
    let negative = x.is_sign_negative();
    let p1 = f64::from_bits(0x3ff921fb54400000);
    let p1t = f64::from_bits(0x3dd0b4611a626331);
    let p2 = f64::from_bits(0x3dd0b4611a600000);
    let p2t = f64::from_bits(0x3ba3198a2e037073);
    let p3 = f64::from_bits(0x3ba3198a2e000000);
    let p3t = f64::from_bits(0x397b839a252049c1);
    if ix <= 0x3fe921fb {
        return (0, x, 0.0);
    }
    if ix < 0x4002d97c {
        if !negative {
            let mut z = x - p1;
            let (a, b) = if ix != 0x3ff921fb {
                let a = z - p1t;
                (a, (z - a) - p1t)
            } else {
                z -= p2;
                let a = z - p2t;
                (a, (z - a) - p2t)
            };
            return (1, a, b);
        } else {
            let mut z = x + p1;
            let (a, b) = if ix != 0x3ff921fb {
                let a = z + p1t;
                (a, (z - a) + p1t)
            } else {
                z += p2;
                let a = z + p2t;
                (a, (z - a) + p2t)
            };
            return (-1, a, b);
        }
    }
    // The generator's validated trigonometric arguments are all far below this.
    assert!(ix <= 0x413921fb);
    let inv = f64::from_bits(0x3fe45f306dc9c883);
    let mut t = x.abs();
    let n = t.mul_add(inv, 0.5) as i32;
    let f = n as f64;
    let mut r = (-f).mul_add(p1, t);
    let mut w = f * p1t;
    let mut a = r - w;
    const TABLE: [u32; 32] = [
        0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb,
        0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb,
        0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c,
        0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb,
        0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
    ];
    if n >= 32 || ix == TABLE[n as usize - 1] {
        let j = (ix >> 20) as i32;
        let mut i = j - ((high(a) >> 20) & 0x7ff) as i32;
        if i > 16 {
            t = r;
            w = f * p2;
            r = t - w;
            w = f.mul_add(p2t, -((t - r) - w));
            a = r - w;
            i = j - ((high(a) >> 20) & 0x7ff) as i32;
            if i > 49 {
                t = r;
                w = f * p3;
                r = t - w;
                w = f.mul_add(p3t, -((t - r) - w));
                a = r - w;
            }
        }
    }
    let b = (r - a) - w;
    if negative { (-n, -a, -b) } else { (n, a, b) }
}
fn kernel_sin(x: f64, y: f64, tail: bool) -> f64 {
    if high(x) & 0x7fffffff < 0x3e400000 {
        return x;
    }
    let s = [
        f64::from_bits(0xbfc5555555555549),
        f64::from_bits(0x3f8111111110f8a6),
        f64::from_bits(0xbf2a01a019c161d5),
        f64::from_bits(0x3ec71de357b1fe7d),
        f64::from_bits(0xbe5ae5e68a2b9ceb),
        f64::from_bits(0x3de5d93a5acfd57c),
    ];
    let z = x * x;
    let v = z * x;
    let r = z.mul_add(s[5], s[4]);
    let r = z.mul_add(r, s[3]);
    let r = z.mul_add(r, s[2]);
    let r = z.mul_add(r, s[1]);
    if !tail {
        v.mul_add(z.mul_add(r, s[0]), x)
    } else {
        x - (-v).mul_add(s[0], z.mul_add(0.5 * y - v * r, -y))
    }
}
fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high(x) & 0x7fffffff;
    if ix < 0x3e400000 {
        return 1.0;
    }
    let c = [
        f64::from_bits(0x3fa555555555554c),
        f64::from_bits(0xbf56c16c16c15177),
        f64::from_bits(0x3efa01a019cb1590),
        f64::from_bits(0xbe927e4f809c52ad),
        f64::from_bits(0x3e21ee9ebdb4b1c4),
        f64::from_bits(0xbda8fae9be8838d4),
    ];
    let z = x * x;
    let r = z.mul_add(c[5], c[4]);
    let r = z.mul_add(r, c[3]);
    let r = z.mul_add(r, c[2]);
    let r = z.mul_add(r, c[1]);
    let r = z * z.mul_add(r, c[0]);
    let remainder = z.mul_add(r, -x * y);
    if ix < 0x3fd33333 {
        1.0 - z.mul_add(0.5, -remainder)
    } else {
        let q = if ix > 0x3fe90000 {
            0.28125
        } else {
            f64::from_bits(((ix - 0x00200000) as u64) << 32)
        };
        let iz = z.mul_add(0.5, -q);
        (1.0 - q) - (iz - remainder)
    }
}
fn kernel_tan(mut x: f64, mut y: f64, iy: i32) -> f64 {
    let hx = high(x);
    let ix = hx & 0x7fffffff;
    if ix < 0x3e300000 {
        if x == 0.0 && iy == -1 {
            return 1.0 / x.abs();
        }
        if iy == 1 {
            return x;
        }
        let w = x + y;
        let z = chopped(w);
        let v = y - (z - x);
        let a = -1.0 / w;
        let t = chopped(a);
        let s = t.mul_add(z, 1.0);
        return a.mul_add(t.mul_add(v, s), t);
    }
    if ix >= 0x3fe59428 {
        if x.is_sign_negative() {
            x = -x;
            y = -y;
        }
        let z = std::f64::consts::FRAC_PI_4 - x;
        let w = f64::from_bits(0x3c81a62633145c07) - y;
        x = z + w;
        y = 0.0;
    }
    let t = [
        f64::from_bits(0x3fd5555555555563),
        f64::from_bits(0x3fc111111110fe7a),
        f64::from_bits(0x3faba1ba1bb341fe),
        f64::from_bits(0x3f9664f48406d637),
        f64::from_bits(0x3f8226e3e96e8493),
        f64::from_bits(0x3f6d6d22c9560328),
        f64::from_bits(0x3f57dbc8fee08315),
        f64::from_bits(0x3f4344d8f2f26501),
        f64::from_bits(0x3f3026f71a8d1068),
        f64::from_bits(0x3f147e88a03792a6),
        f64::from_bits(0x3f12b80f32f0a7e9),
        f64::from_bits(0xbef375cbdb605373),
        f64::from_bits(0x3efb2a7074bf7ad4),
    ];
    let z = x * x;
    let w = z * z;
    let r = w.mul_add(t[11], t[9]);
    let r = w.mul_add(r, t[7]);
    let r = w.mul_add(r, t[5]);
    let r = w.mul_add(r, t[3]);
    let r = w.mul_add(r, t[1]);
    let v = w.mul_add(t[12], t[10]);
    let v = w.mul_add(v, t[8]);
    let v = w.mul_add(v, t[6]);
    let v = w.mul_add(v, t[4]);
    let v = z * w.mul_add(v, t[2]);
    let s = z * x;
    let r = z.mul_add(s.mul_add(r + v, y), y);
    let r = t[0].mul_add(s, r);
    let w = x + r;
    if ix >= 0x3fe59428 {
        let v = iy as f64;
        let sign = if hx & 0x80000000 != 0 { -1.0 } else { 1.0 };
        return sign * (-2.0f64).mul_add(x - (w * w / (w + v) - r), v);
    }
    if iy == 1 {
        return w;
    }
    let z = chopped(w);
    let v = r - (z - x);
    let a = -1.0 / w;
    let t = chopped(a);
    let s = t.mul_add(z, 1.0);
    a.mul_add(t.mul_add(v, s), t)
}
pub fn sin(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if high(x) & 0x7fffffff > 0x413921fb {
        return libm::sin(x);
    }
    if high(x) & 0x7fffffff <= 0x3fe921fb {
        return kernel_sin(x, 0.0, false);
    }
    let (n, a, b) = reduce(x);
    match n & 3 {
        0 => kernel_sin(a, b, true),
        1 => kernel_cos(a, b),
        2 => -kernel_sin(a, b, true),
        _ => -kernel_cos(a, b),
    }
}
pub fn tan(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if high(x) & 0x7fffffff > 0x413921fb {
        return libm::tan(x);
    }
    if high(x) & 0x7fffffff <= 0x3fe921fb {
        return kernel_tan(x, 0.0, 1);
    }
    let (n, a, b) = reduce(x);
    kernel_tan(a, b, 1 - ((n & 1) << 1))
}

#[cfg(test)]
mod regression_tests {
    #[test]
    fn sine_tail_preserves_reference_unfused_product_rounding() {
        // Independent Node24/V8 outputs that distinguish contracting v*r from
        // the reference evaluation of half*y-v*r. The half*y product is exact.
        for (input, expected) in [
            (0xc0530a36b2af1455, 0xbfe613be48273ddd),
            (0xc0523da082e5b158, 0x3fe4c4bdfeda37aa),
            (0x401bb8bdcad14a00, 0x3fe34b941bfba161),
            (0x40523f2c49e71b74, 0xbfe559b99ae72c7d),
            (0x4057b55c134a180a, 0x3fe1b2351ebde490),
        ] {
            assert_eq!(super::sin(f64::from_bits(input)).to_bits(), expected);
        }
    }
}
