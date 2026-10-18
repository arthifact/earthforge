//! Native and deterministic Wasm builds share versioned scalar arithmetic.
//! Fast 2D browser previews use host scalar primitives; simulation and material
//! state remain in Rust. Research requests select deterministic Wasm in the loader.
#[cfg(all(target_arch = "wasm32", not(feature = "deterministic-math")))]
#[link(wasm_import_module = "math")]
unsafe extern "C" {
    #[link_name = "exp"]
    fn host_exp(x: f64) -> f64;
    #[link_name = "expm1"]
    fn host_expm1(x: f64) -> f64;
    #[link_name = "tanh"]
    fn host_tanh(x: f64) -> f64;
    #[link_name = "sin"]
    fn host_sin(x: f64) -> f64;
    #[link_name = "tan"]
    fn host_tan(x: f64) -> f64;
    #[link_name = "cbrt"]
    fn host_cbrt(x: f64) -> f64;
}
macro_rules! unary {
    ($name:ident,$host:ident) => {
        pub fn $name(x: f64) -> f64 {
            #[cfg(all(target_arch = "wasm32", not(feature = "deterministic-math")))]
            {
                unsafe { $host(x) }
            }
            #[cfg(any(not(target_arch = "wasm32"), feature = "deterministic-math"))]
            {
                crate::native_math::$name(x)
            }
        }
    };
}
unary!(exp, host_exp);
unary!(expm1, host_expm1);
unary!(tanh, host_tanh);
unary!(sin, host_sin);
unary!(tan, host_tan);
unary!(cbrt, host_cbrt);

/// Explicit scaled Euclidean norm. Keep operation order stable for deterministic
/// fault-domain boundaries (the V8 two-argument Math.hypot convention).
pub fn hypot(x: f64, y: f64) -> f64 {
    let a = x.abs();
    let b = y.abs();
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let scale = a.max(b);
    if scale == 0.0 {
        return 0.0;
    }
    let a = a / scale;
    let b = b / scale;
    (a * a + b * b).sqrt() * scale
}
