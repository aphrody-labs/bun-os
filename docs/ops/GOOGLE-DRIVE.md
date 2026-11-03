# Optional Google Drive mount

The unified image includes rclone. A COSMIC autostart entry starts the user's
`gdrive:` remote at `~/Google Drive` only when that user has a private
`~/.config/rclone/rclone.conf` owned by them with mode 0600. A missing config
does nothing. The mount refuses symlinks and nonempty local directories, so it
does not hide existing files. The VFS write cache stays under the user's home;
an application write is not proof that an upload has reached Google Drive.
The mount holds a lock in that cache to prevent two sessions using it at once.
Before mounting it refreshes the remote through rclone and asks the Google Drive
`about` API for the authenticated user's permission ID. A private SHA-256
marker binds the cache to that identity and the configured Drive root; a changed
identity or remote, unavailable identity, or unidentified existing cache is
refused without deleting it. `RCLONE_*` environment overrides are refused so
the inspected config is the one used by the mount. This verification needs
Google connectivity and an access token authorized for Drive; it does not
provide offline startup or authenticate changes made while rclone is running.
Pending cached uploads may resume on a later launch with the same configuration;
the mounted service must be qualified before relying on recovery.
The user's home remains the local persistent volume; Google One is an account
storage plan, not a replacement filesystem or a separate API.

The proposed WebOS session integration exposes `/dev/fuse` only when
`WEBOS_SESSIONS_DRIVE_FUSE=1` and `WEBOS_SESSIONS_DRIVE_FUSE_USER` names the
exact single allowed identity. The manager requires each `aphrody-home-<slug>`
volume to carry an `aphrody.user` label matching the session identity. When
the volume is absent it creates one with that label and reads it back; existing
unlabeled or mismatched volumes are refused. This does not migrate, relabel,
or replace existing data.

The proposed server path uses `WEBOS_SESSIONS_MANAGED=1`; the session-manager
changes are not part of this image-only change and have not yet been qualified.
The OAuth broker's owner credentials are not automatically provisioned into
user homes. Multi-user isolation, FUSE mounting, upload completion and recovery
after interruption still require end-to-end qualification. Never copy a token
or rclone configuration into logs, arguments, or another user's home.

An isolated VPS smoke test uses rclone 1.75.1 and a temporary local alias to
exercise FUSE, write-back, cache locking, and recovery after killing rclone
before write-back. It replaces account verification with a mock and does not
qualify that path. A separate mocked check verifies refusal of insecure
configs, nonempty mountpoints, unidentifiable existing caches, concurrent
config changes and changed account identities. Google authentication, remote
writes, and a WebOS container remain to be qualified end to end.
