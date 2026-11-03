use super::*;

#[test]
fn nested_scope_restores_the_previous_document() {
    let outer = Path::new("outer.pcraft");
    let inner = Path::new("inner.pcraft");
    let _outer = scope(Some(outer));
    assert_eq!(current().as_deref(), Some(outer));
    {
        let _inner = scope(Some(inner));
        assert_eq!(current().as_deref(), Some(inner));
    }
    assert_eq!(current().as_deref(), Some(outer));
}

#[test]
fn scope_restores_after_unwinding_and_is_thread_local() {
    let outer = Path::new("outer.pcraft");
    let _outer = scope(Some(outer));
    let result = std::panic::catch_unwind(|| {
        let _inner = scope(Some(Path::new("inner.pcraft")));
        panic!("exercise drop");
    });
    assert!(result.is_err());
    assert_eq!(current().as_deref(), Some(outer));
    assert!(std::thread::spawn(current).join().unwrap().is_none());
}

#[test]
fn restricted_scope_cannot_be_elevated_by_nested_scope() {
    let _restricted = scope_authorized(Some(Path::new("project.pcraft")), false);
    assert_eq!(resolve("linked.png"), Err(NotFollowed::PermissionDenied));
    let _nested = scope_authorized(Some(Path::new("other.pcraft")), true);
    assert_eq!(resolve("linked.png"), Err(NotFollowed::PermissionDenied));
}
