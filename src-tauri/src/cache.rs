//! Values kept in memory after the first read of slow or prompting storage,
//! such as the OS keychain.

use std::sync::RwLock;

/// Read once per run; failed reads aren't kept, so they're tried again.
pub struct Cached<T>(RwLock<Option<T>>);

impl<T: Clone> Cached<T> {
    pub const fn new() -> Self {
        Self(RwLock::new(None))
    }

    pub fn get_or_load<E>(&self, load: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        if let Some(value) = self.0.read().unwrap_or_else(|e| e.into_inner()).as_ref() {
            return Ok(value.clone());
        }
        let mut slot = self.0.write().unwrap_or_else(|e| e.into_inner());
        if let Some(value) = slot.as_ref() {
            return Ok(value.clone());
        }
        let value = load()?;
        *slot = Some(value.clone());
        Ok(value)
    }

    pub fn set(&self, value: T) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = Some(value);
    }

    /// Replaces the value with `value` only if it has been read and `expected`
    /// says it's still the one the caller saw. Returns whether it did.
    pub fn replace_if(&self, expected: impl FnOnce(&T) -> bool, value: T) -> bool {
        let mut slot = self.0.write().unwrap_or_else(|e| e.into_inner());
        match slot.as_ref() {
            Some(current) if expected(current) => {
                *slot = Some(value);
                true
            }
            _ => false,
        }
    }

    /// Forgets the value, so the next read goes to storage again.
    pub fn clear(&self) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn loads_once_and_keeps_it() {
        let cache: Cached<String> = Cached::new();
        let reads = Cell::new(0);
        let load = || {
            reads.set(reads.get() + 1);
            Ok::<_, ()>("token".to_string())
        };
        assert_eq!(cache.get_or_load(load).unwrap(), "token");
        assert_eq!(cache.get_or_load(load).unwrap(), "token");
        assert_eq!(reads.get(), 1);
    }

    #[test]
    fn a_failed_read_is_tried_again() {
        let cache: Cached<String> = Cached::new();
        assert!(cache.get_or_load(|| Err::<String, _>("denied")).is_err());
        assert_eq!(
            cache.get_or_load(|| Ok::<_, ()>("token".into())).unwrap(),
            "token"
        );
    }

    #[test]
    fn set_and_clear_replace_what_was_read() {
        let cache: Cached<Option<String>> = Cached::new();
        cache.set(None);
        assert_eq!(
            cache
                .get_or_load(|| Ok::<_, ()>(Some("stale".into())))
                .unwrap(),
            None
        );
        cache.clear();
        assert_eq!(
            cache
                .get_or_load(|| Ok::<_, ()>(Some("fresh".into())))
                .unwrap(),
            Some("fresh".into())
        );
    }

    #[test]
    fn replaces_only_what_it_expects() {
        let cache: Cached<Option<String>> = Cached::new();
        assert!(!cache.replace_if(|_| true, None), "nothing read yet");
        cache.set(Some("new".into()));
        assert!(!cache.replace_if(|v| v.as_deref() == Some("old"), None));
        assert_eq!(
            cache.get_or_load(|| Ok::<_, ()>(None)).unwrap(),
            Some("new".into())
        );
        assert!(cache.replace_if(|v| v.as_deref() == Some("new"), None));
        assert_eq!(
            cache.get_or_load(|| Ok::<_, ()>(Some("x".into()))).unwrap(),
            None
        );
    }
}
