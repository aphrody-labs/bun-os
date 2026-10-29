//! Clan and club management, member rosters, roles, and clan leaderboards.
//!
//! Reconstructed and ported from a previous clan system
//! (`apps/achillea-bot/src/services/ClanService.ts` and `@achillea/core/clan`):
//! - Clan creation, tag validation (`[TAG]`), and emblem selection
//! - Role hierarchy: Leader, CoLeader, Officer, Member
//! - AP contribution aggregation and seasonal clan leaderboard rankings

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Role hierarchy within a clan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub enum ClanRole {
    /// Regular team member.
    #[default]
    Member = 0,
    /// Officer with invite and moderation rights.
    Officer = 1,
    /// Co-leader with administrative rights.
    CoLeader = 2,
    /// Supreme clan founder / leader.
    Leader = 3,
}

/// Type alias for compatibility.
pub type ClanMemberRole = ClanRole;

/// A member of a clan roster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanMember {
    pub user_id: String,
    pub player_name: String,
    pub role: ClanRole,
    pub ap_contribution: u32,
    pub joined_at: u64,
}

/// A clan or club organization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clan {
    pub clan_id: String,
    pub name: String,
    pub tag: String,
    pub description: String,
    pub emblem_id: u32,
    pub level: u32,
    pub total_ap: u32,
    pub max_members: usize,
    pub members: HashMap<String, ClanMember>,
}

impl Clan {
    /// Creates a new clan with founder as Leader.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        clan_id: String,
        name: String,
        tag: String,
        description: String,
        emblem_id: u32,
        founder_id: String,
        founder_name: String,
    ) -> Self {
        let mut members = HashMap::new();
        members.insert(
            founder_id.clone(),
            ClanMember {
                user_id: founder_id,
                player_name: founder_name,
                role: ClanRole::Leader,
                ap_contribution: 0,
                joined_at: 0,
            },
        );

        Self {
            clan_id,
            name,
            tag,
            description,
            emblem_id,
            level: 1,
            total_ap: 0,
            max_members: 30,
            members,
        }
    }

    /// Adds a member to the clan roster.
    pub fn add_member(&mut self, user_id: String, player_name: String) -> bool {
        if self.members.len() >= self.max_members || self.members.contains_key(&user_id) {
            return false;
        }
        self.members.insert(
            user_id.clone(),
            ClanMember {
                user_id,
                player_name,
                role: ClanRole::Member,
                ap_contribution: 0,
                joined_at: 0,
            },
        );
        true
    }

    /// Removes a member from the clan. Leader cannot be removed directly.
    pub fn remove_member(&mut self, user_id: &str) -> bool {
        if let Some(member) = self.members.get(user_id) {
            if member.role == ClanRole::Leader {
                return false;
            }
            self.members.remove(user_id).is_some()
        } else {
            false
        }
    }

    /// Adds AP contribution from a member and updates clan level.
    pub fn contribute_ap(&mut self, user_id: &str, ap: u32) {
        if let Some(m) = self.members.get_mut(user_id) {
            m.ap_contribution = m.ap_contribution.saturating_add(ap);
            self.total_ap = self.total_ap.saturating_add(ap);
            // Level up every 10,000 AP
            self.level = 1 + (self.total_ap / 10_000);
        }
    }
}

/// Global registry of active clans and player memberships.
#[derive(Debug, Default)]
pub struct ClanRegistry {
    pub clans: HashMap<String, Clan>,
    pub user_memberships: HashMap<String, String>,
}

impl ClanRegistry {
    /// Creates a new clan registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a new clan.
    #[allow(clippy::too_many_arguments)]
    pub fn create_clan(
        &mut self,
        clan_id: String,
        name: String,
        tag: String,
        description: String,
        emblem_id: u32,
        founder_id: String,
        founder_name: String,
    ) -> Result<&Clan, &'static str> {
        if self.user_memberships.contains_key(&founder_id) {
            return Err("Player is already a member of a clan");
        }
        if self.clans.values().any(|c| c.tag == tag) {
            return Err("Clan tag already taken");
        }

        let clan = Clan::new(
            clan_id.clone(),
            name,
            tag,
            description,
            emblem_id,
            founder_id.clone(),
            founder_name,
        );

        self.user_memberships.insert(founder_id, clan_id.clone());
        self.clans.insert(clan_id.clone(), clan);
        Ok(self.clans.get(&clan_id).unwrap())
    }

    /// Adds a player to an existing clan.
    pub fn join_clan(
        &mut self,
        clan_id: &str,
        user_id: String,
        player_name: String,
    ) -> Result<(), &'static str> {
        if self.user_memberships.contains_key(&user_id) {
            return Err("Player is already in a clan");
        }
        let Some(clan) = self.clans.get_mut(clan_id) else {
            return Err("Clan not found");
        };
        if !clan.add_member(user_id.clone(), player_name) {
            return Err("Failed to add member to clan (full or already in)");
        }
        self.user_memberships.insert(user_id, clan_id.to_string());
        Ok(())
    }

    /// Removes a player from their clan.
    pub fn leave_clan(&mut self, user_id: &str) -> Result<(), &'static str> {
        let Some(clan_id) = self.user_memberships.get(user_id).cloned() else {
            return Err("Player not in a clan");
        };
        let Some(clan) = self.clans.get_mut(&clan_id) else {
            return Err("Clan not found");
        };
        if !clan.remove_member(user_id) {
            return Err("Cannot leave clan (leader or invalid)");
        }
        self.user_memberships.remove(user_id);
        Ok(())
    }

    /// Returns the top clans sorted by total AP.
    #[must_use]
    pub fn top_clans(&self, limit: usize) -> Vec<&Clan> {
        let mut list: Vec<&Clan> = self.clans.values().collect();
        list.sort_by(|a, b| {
            b.total_ap
                .cmp(&a.total_ap)
                .then_with(|| b.members.len().cmp(&a.members.len()))
        });
        list.truncate(limit);
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clan_lifecycle_and_contributions() {
        let mut registry = ClanRegistry::new();

        let clan = registry
            .create_clan(
                "clan_raimon".into(),
                "Raimon Eleven".into(),
                "RAI".into(),
                "Inazuma Japan Champions".into(),
                101,
                "user_mark".into(),
                "Mark Evans".into(),
            )
            .unwrap();

        assert_eq!(clan.members.len(), 1);
        assert_eq!(clan.level, 1);

        assert!(
            registry
                .join_clan("clan_raimon", "user_axel".into(), "Axel Blaze".into())
                .is_ok()
        );

        let clan_mut = registry.clans.get_mut("clan_raimon").unwrap();
        assert_eq!(clan_mut.members.len(), 2);

        clan_mut.contribute_ap("user_axel", 15_000);
        assert_eq!(clan_mut.total_ap, 15_000);
        assert_eq!(clan_mut.level, 2); // 1 + 15000/10000 = 2

        let top = registry.top_clans(5);
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].tag, "RAI");
    }
}
