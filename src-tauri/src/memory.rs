//! Ask WebView2 to reduce cache use while Hush is inactive. This never suspends
//! script execution: signaling, incoming messages and timers keep running.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryTarget {
    Normal,
    Low,
}

#[derive(Clone, Copy, Debug)]
struct MemoryPolicy {
    focused: bool,
    minimized: bool,
    call_active: bool,
}

impl Default for MemoryPolicy {
    fn default() -> Self {
        Self {
            focused: true,
            minimized: false,
            call_active: false,
        }
    }
}

impl MemoryPolicy {
    fn target(self) -> MemoryTarget {
        if !self.call_active && (!self.focused || self.minimized) {
            MemoryTarget::Low
        } else {
            MemoryTarget::Normal
        }
    }
}

#[derive(Default)]
struct State {
    policy: MemoryPolicy,
    pending: bool,
    applied: Option<MemoryTarget>,
    supported: Option<bool>,
}

/// Diagnostics contain only the memory policy, never profile or account data.
/// `applied_target` means the WebView2 API accepted that target; memory release
/// itself remains best-effort and must be measured across the complete process
/// tree rather than inferred from this flag.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    pub focused: bool,
    pub minimized: bool,
    pub call_active: bool,
    pub requested_target: MemoryTarget,
    pub applied_target: Option<MemoryTarget>,
    pub supported: Option<bool>,
}

#[derive(Clone, Default)]
pub struct MemoryController {
    state: Arc<Mutex<State>>,
}

impl MemoryController {
    pub fn update_window(
        &self,
        window: &WebviewWindow,
        focused: bool,
        minimized: bool,
    ) -> Result<(), String> {
        {
            let mut state = self.lock()?;
            state.policy.focused = focused;
            state.policy.minimized = minimized;
        }
        self.apply(window)
    }

    /// Active calls always get the normal budget, including calls folded into
    /// the desktop widget or running while the window is minimized/unfocused.
    pub fn set_call_active(&self, window: &WebviewWindow, active: bool) -> Result<(), String> {
        self.lock()?.policy.call_active = active;
        self.apply(window)
    }

    pub fn status(&self) -> Result<MemoryStatus, String> {
        let state = self.lock()?;
        Ok(MemoryStatus {
            focused: state.policy.focused,
            minimized: state.policy.minimized,
            call_active: state.policy.call_active,
            requested_target: state.policy.target(),
            applied_target: state.applied,
            supported: state.supported,
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>, String> {
        self.state
            .lock()
            .map_err(|_| "Impossibile aggiornare la gestione della memoria.".to_owned())
    }

    fn apply(&self, window: &WebviewWindow) -> Result<(), String> {
        {
            let mut state = self.lock()?;
            if state.pending
                || state.supported == Some(false)
                || state.applied == Some(state.policy.target())
            {
                return Ok(());
            }
            state.pending = true;
        }

        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows_core::Interface;

            let shared = Arc::clone(&self.state);
            let result = window.with_webview(move |webview| {
                let Ok(mut state) = shared.lock() else {
                    return;
                };
                state.pending = false;
                // Read the current policy on the WebView's owning UI thread.
                // A queued background request must not apply stale Low after
                // a call starts or the user has restored/focused the window.
                let target = state.policy.target();
                if state.applied == Some(target) {
                    return;
                }
                // SAFETY: Tauri invokes with_webview on the owning UI thread.
                // Its controller and derived COM interfaces are used only in
                // this closure and are never stored or moved across threads.
                // The state lock serializes policy changes with the COM call.
                unsafe {
                    let Ok(core) = webview.controller().CoreWebView2() else {
                        return;
                    };
                    let Ok(memory) = core.cast::<ICoreWebView2_19>() else {
                        // Older runtimes keep the default Normal behavior.
                        state.supported = Some(false);
                        return;
                    };
                    let native_target = match target {
                        MemoryTarget::Normal => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                        MemoryTarget::Low => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                    };
                    if memory.SetMemoryUsageTargetLevel(native_target).is_ok() {
                        state.applied = Some(target);
                        state.supported = Some(true);
                    }
                    // Transient COM failures leave the previous target intact
                    // and permit retry at the next focus/resize/call update.
                }
            });
            if result.is_err() {
                self.lock()?.pending = false;
                return Err("Impossibile aggiornare la gestione della memoria.".to_owned());
            }
        }

        #[cfg(not(windows))]
        {
            let _ = window;
            let mut state = self.lock()?;
            state.pending = false;
            state.supported = Some(false);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{MemoryPolicy, MemoryTarget};

    #[test]
    fn active_window_keeps_the_normal_memory_budget() {
        assert_eq!(MemoryPolicy::default().target(), MemoryTarget::Normal);
    }

    #[test]
    fn inactive_or_minimized_window_can_release_caches_without_suspending() {
        for (focused, minimized) in [(false, false), (true, true), (false, true)] {
            let policy = MemoryPolicy {
                focused,
                minimized,
                call_active: false,
            };
            assert_eq!(policy.target(), MemoryTarget::Low);
        }
    }

    #[test]
    fn active_calls_never_receive_low_memory_even_when_the_widget_is_folded() {
        for focused in [true, false] {
            for minimized in [true, false] {
                let policy = MemoryPolicy {
                    focused,
                    minimized,
                    call_active: true,
                };
                assert_eq!(policy.target(), MemoryTarget::Normal);
            }
        }
    }

    #[test]
    fn restoring_and_focusing_returns_to_normal() {
        let mut policy = MemoryPolicy {
            focused: false,
            minimized: true,
            call_active: false,
        };
        assert_eq!(policy.target(), MemoryTarget::Low);
        policy.minimized = false;
        assert_eq!(policy.target(), MemoryTarget::Low);
        policy.focused = true;
        assert_eq!(policy.target(), MemoryTarget::Normal);
    }

    #[test]
    fn incoming_call_overrides_a_pending_background_target() {
        let mut policy = MemoryPolicy {
            focused: false,
            minimized: true,
            call_active: false,
        };
        let queued_before_call = policy.target();
        policy.call_active = true;
        assert_eq!(queued_before_call, MemoryTarget::Low);
        assert_eq!(policy.target(), MemoryTarget::Normal);
        policy.call_active = false;
        assert_eq!(policy.target(), MemoryTarget::Low);
    }
}
