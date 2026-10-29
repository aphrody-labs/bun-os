// SPDX-License-Identifier: Apache-2.0
//! Opt-in shared product metadata foundation. No automatic provisioning or cutover.
//! Applications explicitly select a dedicated allocated PostgreSQL database and
//! pass this set to the existing checksummed/advisory-lock migration runner.

use crate::{MigrateOptions, MigrationSet, Result};

/// Schema is separate from local home and existing product migration ledgers.
pub const SCHEMA: &str = "aphrody_product";

/// Additive PostgreSQL metadata migrations (no auth credentials or private payloads).
///
/// # Errors
/// Returns an error if an embedded migration identity is invalid.
pub fn migrations() -> Result<MigrationSet> {
    crate::embed_migrations!("../migrations/aphrody-product/0001_metadata.sql")
}

/// Dedicated ledger; applying requires explicit least-privilege DB allocation.
#[must_use]
pub fn migration_options() -> MigrateOptions {
    MigrateOptions::in_schema(SCHEMA)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_migrations_have_dedicated_versioned_ledger() {
        let set = migrations().expect("embedded migration");
        assert_eq!(set.len(), 1);
        assert_eq!(set.latest_version(), Some(1));
        let migration = set.iter().next().expect("metadata migration");
        assert_eq!(migration.name, "metadata");
        assert_eq!(migration.sha256.len(), 64);
        assert_eq!(migration_options().schema.as_deref(), Some(SCHEMA));
    }
}
