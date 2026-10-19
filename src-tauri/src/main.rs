// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod single_instance {
    use std::ptr::null_mut;

    #[link(name = "kernel32")]
    #[link(name = "user32")]
    extern "system" {
        fn CreateMutexW(
            lpMutexAttributes: *mut std::ffi::c_void,
            bInitialOwner: i32,
            lpName: *const u16,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
        fn FindWindowW(lpClassName: *const u16, lpWindowName: *const u16) -> *mut std::ffi::c_void;
        fn SetForegroundWindow(hWnd: *mut std::ffi::c_void) -> i32;
        fn ShowWindow(hWnd: *mut std::ffi::c_void, nCmdShow: i32) -> i32;
    }

    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SW_RESTORE: i32 = 9;
    const SW_SHOW: i32 = 5;

    pub fn ensure_single_instance() -> bool {
        // Use Local\ session namespace to guarantee standard user permissions without admin rights
        let name: Vec<u16> = "Local\\SUBaka_SingleInstance_App_Mutex_v1\0"
            .encode_utf16()
            .collect();
        let mutex = unsafe { CreateMutexW(null_mut(), 1, name.as_ptr()) };
        
        let err = unsafe { GetLastError() };
        if err == ERROR_ALREADY_EXISTS {
            // Another instance is already running; find and bring existing window to front
            let win_name: Vec<u16> = "SUBaka\0".encode_utf16().collect();
            let hwnd = unsafe { FindWindowW(null_mut(), win_name.as_ptr()) };
            if !hwnd.is_null() {
                unsafe {
                    ShowWindow(hwnd, SW_SHOW);
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                }
            }
            return false;
        }

        if mutex.is_null() {
            // Fallback: if mutex creation failed, check if already exists was the cause
            return err != ERROR_ALREADY_EXISTS;
        }

        true
    }
}

fn main() {
    #[cfg(windows)]
    {
        if !single_instance::ensure_single_instance() {
            // Another instance of SUBaka is already running
            std::process::exit(0);
        }
    }

    subaka_lib::run();
}
