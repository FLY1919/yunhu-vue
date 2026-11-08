//! Pure policy shared by the Windows implementation and offline Rust regression tests.
pub const IDENTITY_NOT_FOUND: i32 = 0x80070490u32 as i32;

// A missing Setting entry is not a disabled-notifications decision. Windows creates
// this entry lazily for unpackaged apps; only an explicit nonzero setting blocks.
pub fn setting_may_send(setting: Result<i32, i32>) -> Result<bool, i32> {
    match setting {
        Ok(value) => Ok(value == 0),
        Err(IDENTITY_NOT_FOUND) => Ok(true),
        Err(error) => Err(error),
    }
}

// Repair exactly once, and only after an explicit missing-identity failure.
// Successful submissions and unrelated errors must never cause another delivery.
pub fn with_identity_repair<T, E>(
    mut send: impl FnMut() -> Result<T, E>,
    mut repair: impl FnMut() -> Result<(), E>,
    is_missing: impl Fn(&E) -> bool,
) -> Result<T, E> {
    match send() {
        Err(error) if is_missing(&error) => { repair()?; send() }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn missing_settings_allow_actual_submission_but_disabled_settings_do_not() {
        assert_eq!(setting_may_send(Err(IDENTITY_NOT_FOUND)), Ok(true));
        assert_eq!(setting_may_send(Ok(0)), Ok(true));
        for disabled in 1..=4 { assert_eq!(setting_may_send(Ok(disabled)), Ok(false)); }
        assert_eq!(setting_may_send(Ok(99)), Ok(false));
        assert_eq!(setting_may_send(Err(0x80070005u32 as i32)), Err(0x80070005u32 as i32));
    }

    #[test]
    fn a_successful_submission_is_not_repaired_or_repeated() {
        let calls = Cell::new(0);
        let result = with_identity_repair(|| { calls.set(calls.get() + 1); Ok::<_, i32>(()) },
            || panic!("successful send must not repair"), |e| *e == IDENTITY_NOT_FOUND);
        assert_eq!(result, Ok(())); assert_eq!(calls.get(), 1);
    }

    #[test]
    fn missing_identity_is_repaired_once_and_retried_once() {
        let calls = Cell::new(0); let repairs = Cell::new(0);
        let result = with_identity_repair(|| {
            calls.set(calls.get() + 1);
            if calls.get() == 1 { Err(IDENTITY_NOT_FOUND) } else { Ok(()) }
        }, || { repairs.set(repairs.get() + 1); Ok(()) }, |e| *e == IDENTITY_NOT_FOUND);
        assert_eq!(result, Ok(())); assert_eq!(calls.get(), 2); assert_eq!(repairs.get(), 1);
    }

    #[test]
    fn persistent_failure_is_returned_without_an_endless_retry() {
        let calls = Cell::new(0);
        let result = with_identity_repair(|| { calls.set(calls.get() + 1); Err::<(), _>(IDENTITY_NOT_FOUND) },
            || Ok(()), |e| *e == IDENTITY_NOT_FOUND);
        assert_eq!(result, Err(IDENTITY_NOT_FOUND)); assert_eq!(calls.get(), 2);
    }

    #[test]
    fn repair_failure_and_unrelated_errors_are_preserved() {
        let calls = Cell::new(0);
        let result = with_identity_repair(|| { calls.set(calls.get() + 1); Err::<(), _>(IDENTITY_NOT_FOUND) },
            || Err(7), |e| *e == IDENTITY_NOT_FOUND);
        assert_eq!(result, Err(7)); assert_eq!(calls.get(), 1);
        assert_eq!(with_identity_repair(|| Err::<(), _>(5), || panic!("unrelated error"),
            |e| *e == IDENTITY_NOT_FOUND), Err(5));
    }
}
