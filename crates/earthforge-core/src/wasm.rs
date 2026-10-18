//! One coarse request per simulation. No JS callbacks in numerical loops.
//! Host-owned input allocation and engine-owned response have separate lifetimes.
use std::cell::RefCell;
thread_local! {static RESPONSE:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};}
#[unsafe(no_mangle)]
pub extern "C" fn earthforge_alloc(len: usize) -> *mut u8 {
    if len > 64 * 1024 * 1024 {
        return std::ptr::null_mut();
    }
    let buffer = vec![0u8; len].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8
}
/// # Safety
/// `ptr,len` must identify a live allocation returned by earthforge_alloc.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn earthforge_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))) }
    }
}
/// # Safety
/// Input must be an initialized live earthforge_alloc allocation of len bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn earthforge_run(ptr: *const u8, len: usize) -> usize {
    let result = if ptr.is_null() || len > 64 * 1024 * 1024 {
        br#"{"ok":false,"error":"Invalid input allocation"}"#.to_vec()
    } else {
        crate::api::process(unsafe { std::slice::from_raw_parts(ptr, len) })
    };
    RESPONSE.with(|slot| {
        let mut slot = slot.borrow_mut();
        *slot = result;
        slot.len()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn earthforge_result_ptr() -> *const u8 {
    RESPONSE.with(|slot| slot.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn earthforge_result_free() {
    RESPONSE.with(|slot| {
        *slot.borrow_mut() = Vec::new();
    });
}
