//! Competitive ELO rating, progressive tier progression, and ranked ladder system.
//!
//! Reconstructed and ported from a previous competitive core
//! (`apps/achillea-bot/src/services/EloService.ts` and `@achillea/core/elo`):
//! - 11 official competitive rank tiers (Fer to Légendaire)
//! - Progressive directional AP / ELO delta calculation (winK / lossK)
//! - Calibration curve guaranteeing fair progression at lower tiers and strict parity at higher tiers
//! - Player competitive career profiles and seasonal ladders

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Default K-factor when season does not override.
pub const DEFAULT_K_FACTOR: u32 = 32;

/// Default starting rating (ladder starts at 0 AP).
pub const DEFAULT_BASE_RATING: u32 = 0;

/// The 11 official competitive rank tiers in the Inazuma Eleven VR / Achillea circuit.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
pub enum RankTier {
    /// 0 - Fer (Iron): 0 - 199 AP.
    #[default]
    Fer = 0,
    /// 1 - Bronze: 200 - 399 AP.
    Bronze = 1,
    /// 2 - Argent (Silver): 400 - 599 AP.
    Argent = 2,
    /// 3 - Or (Gold): 600 - 799 AP.
    Or = 3,
    /// 4 - Platine (Platinum): 800 - 999 AP.
    Platine = 4,
    /// 5 - Diamant (Diamond): 1000 - 1199 AP.
    Diamant = 5,
    /// 6 - Émeraude (Emerald): 1200 - 1399 AP.
    Emeraude = 6,
    /// 7 - Rubis (Ruby): 1400 - 1599 AP.
    Rubis = 7,
    /// 8 - Divin (Divine): 1600 - 1799 AP.
    Divin = 8,
    /// 9 - Supernova: 1800 - 1999 AP.
    Supernova = 9,
    /// 10 - Légendaire (Legendary): 2000+ AP.
    Legendaire = 10,
}

impl RankTier {
    /// Number of distinct rank tiers.
    pub const COUNT: usize = 11;

    /// Resolves tier from 0-based index. Clamped to [0, 10].
    #[must_use]
    pub fn from_index(index: usize) -> Self {
        match index {
            0 => Self::Fer,
            1 => Self::Bronze,
            2 => Self::Argent,
            3 => Self::Or,
            4 => Self::Platine,
            5 => Self::Diamant,
            6 => Self::Emeraude,
            7 => Self::Rubis,
            8 => Self::Divin,
            9 => Self::Supernova,
            _ => Self::Legendaire,
        }
    }

    /// Resolves tier from current AP points.
    #[must_use]
    pub fn from_ap(ap: u32) -> Self {
        match ap {
            0..=199 => Self::Fer,
            200..=399 => Self::Bronze,
            400..=599 => Self::Argent,
            600..=799 => Self::Or,
            800..=999 => Self::Platine,
            1000..=1199 => Self::Diamant,
            1200..=1399 => Self::Emeraude,
            1400..=1599 => Self::Rubis,
            1600..=1799 => Self::Divin,
            1800..=1999 => Self::Supernova,
            _ => Self::Legendaire,
        }
    }

    /// Minimum AP threshold required to enter this tier.
    #[must_use]
    pub fn min_ap(&self) -> u32 {
        match self {
            Self::Fer => 0,
            Self::Bronze => 200,
            Self::Argent => 400,
            Self::Or => 600,
            Self::Platine => 800,
            Self::Diamant => 1000,
            Self::Emeraude => 1200,
            Self::Rubis => 1400,
            Self::Divin => 1600,
            Self::Supernova => 1800,
            Self::Legendaire => 2000,
        }
    }

    /// French display name.
    #[must_use]
    pub fn name_fr(&self) -> &'static str {
        match self {
            Self::Fer => "Fer",
            Self::Bronze => "Bronze",
            Self::Argent => "Argent",
            Self::Or => "Or",
            Self::Platine => "Platine",
            Self::Diamant => "Diamant",
            Self::Emeraude => "Émeraude",
            Self::Rubis => "Rubis",
            Self::Divin => "Divin",
            Self::Supernova => "Supernova",
            Self::Legendaire => "Légendaire",
        }
    }

    /// English display name.
    #[must_use]
    pub fn name_en(&self) -> &'static str {
        match self {
            Self::Fer => "Iron",
            Self::Bronze => "Bronze",
            Self::Argent => "Silver",
            Self::Or => "Gold",
            Self::Platine => "Platinum",
            Self::Diamant => "Diamond",
            Self::Emeraude => "Emerald",
            Self::Rubis => "Ruby",
            Self::Divin => "Divine",
            Self::Supernova => "Supernova",
            Self::Legendaire => "Legendary",
        }
    }
}

/// Directional K-factors (winK, lossK) per rank tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TierEloFactors {
    /// K-factor multiplier applied on victory.
    pub win_k: u32,
    /// K-factor multiplier applied on defeat.
    pub loss_k: u32,
}

/// Official calibration table for directional K-factors.
const TIER_FACTORS_TABLE: [TierEloFactors; 11] = [
    TierEloFactors {
        win_k: 40,
        loss_k: 10,
    }, // 0 Fer: +20 / -5 at equal skill
    TierEloFactors {
        win_k: 40,
        loss_k: 12,
    }, // 1 Bronze: +20 / -6
    TierEloFactors {
        win_k: 38,
        loss_k: 16,
    }, // 2 Argent: +19 / -8
    TierEloFactors {
        win_k: 38,
        loss_k: 18,
    }, // 3 Or: +19 / -9
    TierEloFactors {
        win_k: 36,
        loss_k: 20,
    }, // 4 Platine: +18 / -10
    TierEloFactors {
        win_k: 36,
        loss_k: 24,
    }, // 5 Diamant: +18 / -12
    TierEloFactors {
        win_k: 34,
        loss_k: 26,
    }, // 6 Émeraude: +17 / -13
    TierEloFactors {
        win_k: 34,
        loss_k: 28,
    }, // 7 Rubis: +17 / -14
    TierEloFactors {
        win_k: 32,
        loss_k: 32,
    }, // 8 Divin: +16 / -16 (strictly symmetric)
    TierEloFactors {
        win_k: 32,
        loss_k: 32,
    }, // 9 Supernova: +16 / -16
    TierEloFactors {
        win_k: 32,
        loss_k: 32,
    }, // 10 Légendaire: +16 / -16
];

/// Returns directional K-factors for a given rank tier index.
#[must_use]
pub fn tier_elo_factors(tier: RankTier) -> TierEloFactors {
    let idx = (tier as usize).min(TIER_FACTORS_TABLE.len() - 1);
    TIER_FACTORS_TABLE[idx]
}

/// Expected score of a player facing an opponent (win probability between 0.0 and 1.0).
#[must_use]
pub fn expected_score(player_elo: f64, opponent_elo: f64) -> f64 {
    1.0 / (1.0 + 10.0_f64.powf((opponent_elo - player_elo) / 400.0))
}

/// Computes progressive ELO delta for a match participant.
///
/// - `actual`: 1.0 for win, 0.5 for draw, 0.0 for loss.
/// - `season_k`: Season global scaling (32 is nominal).
#[must_use]
pub fn progressive_elo_delta(
    player_elo: u32,
    opponent_elo: u32,
    actual: f64,
    tier: RankTier,
    season_k: u32,
) -> i32 {
    let factors = tier_elo_factors(tier);
    let scale = season_k as f64 / DEFAULT_K_FACTOR as f64;
    let expected = expected_score(player_elo as f64, opponent_elo as f64);

    if actual >= 0.5 {
        // Victory or draw advantage: scale against win_k
        let k = factors.win_k as f64 * scale;
        let delta = (k * (actual - expected)).round() as i32;
        delta.max(1) // At least 1 AP on victory
    } else {
        // Defeat: scale against loss_k
        let k = factors.loss_k as f64 * scale;
        let delta = (k * (actual - expected)).round() as i32;
        delta.min(-1) // At least -1 AP on defeat
    }
}

/// Outcome of an ELO calculation between two competitors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EloMatchResult {
    pub new_winner_elo: u32,
    pub new_loser_elo: u32,
    pub winner_gain: u32,
    pub loser_loss: u32,
}

/// Computes match results and AP updates for winner and loser.
#[must_use]
pub fn compute_match_elo(winner_elo: u32, loser_elo: u32, season_k: u32) -> EloMatchResult {
    let winner_tier = RankTier::from_ap(winner_elo);
    let loser_tier = RankTier::from_ap(loser_elo);

    let winner_delta = progressive_elo_delta(winner_elo, loser_elo, 1.0, winner_tier, season_k);
    let loser_delta = progressive_elo_delta(loser_elo, winner_elo, 0.0, loser_tier, season_k);

    let gain = winner_delta.max(1) as u32;
    let loss = (-loser_delta).max(1) as u32;

    let new_winner = winner_elo.saturating_add(gain);
    let new_loser = loser_elo.saturating_sub(loss);

    EloMatchResult {
        new_winner_elo: new_winner,
        new_loser_elo: new_loser,
        winner_gain: gain,
        loser_loss: loss,
    }
}

/// A player's competitive career record and ranked stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerCompetitiveProfile {
    pub user_id: String,
    pub display_name: String,
    pub current_ap: u32,
    pub peak_ap: u32,
    pub tier: RankTier,
    pub matches_played: u32,
    pub wins: u32,
    pub losses: u32,
    pub current_streak: i32,
    pub clan_tag: Option<String>,
    pub favorite_character: Option<String>,
}

impl PlayerCompetitiveProfile {
    /// Creates a fresh competitive profile for a new player.
    #[must_use]
    pub fn new(user_id: String, display_name: String) -> Self {
        Self {
            user_id,
            display_name,
            current_ap: DEFAULT_BASE_RATING,
            peak_ap: DEFAULT_BASE_RATING,
            tier: RankTier::Fer,
            matches_played: 0,
            wins: 0,
            losses: 0,
            current_streak: 0,
            clan_tag: None,
            favorite_character: None,
        }
    }

    /// Computes win rate percentage (0.0 to 100.0).
    #[must_use]
    pub fn win_rate(&self) -> f64 {
        if self.matches_played == 0 {
            0.0
        } else {
            (self.wins as f64 / self.matches_played as f64) * 100.0
        }
    }

    /// Records the outcome of a finished match and recalculates tier.
    pub fn record_match(&mut self, won: bool, ap_delta: i32) {
        self.matches_played += 1;
        if won {
            self.wins += 1;
            self.current_streak = (self.current_streak.max(0)) + 1;
            self.current_ap = self.current_ap.saturating_add(ap_delta.max(0) as u32);
            if self.current_ap > self.peak_ap {
                self.peak_ap = self.current_ap;
            }
        } else {
            self.losses += 1;
            self.current_streak = (self.current_streak.min(0)) - 1;
            self.current_ap = self.current_ap.saturating_sub((-ap_delta).max(0) as u32);
        }
        self.tier = RankTier::from_ap(self.current_ap);
    }
}

/// In-memory ranked ladder and competitive matchmaking manager.
#[derive(Debug, Default)]
pub struct CompetitiveLadder {
    pub profiles: HashMap<String, PlayerCompetitiveProfile>,
    pub season_number: u32,
    pub season_k_factor: u32,
}

impl CompetitiveLadder {
    /// Creates a new competitive ladder.
    #[must_use]
    pub fn new(season_number: u32, season_k_factor: u32) -> Self {
        Self {
            profiles: HashMap::new(),
            season_number,
            season_k_factor,
        }
    }

    /// Gets or creates a player's competitive profile.
    pub fn get_or_create(
        &mut self,
        user_id: &str,
        display_name: &str,
    ) -> &mut PlayerCompetitiveProfile {
        self.profiles.entry(user_id.to_string()).or_insert_with(|| {
            PlayerCompetitiveProfile::new(user_id.to_string(), display_name.to_string())
        })
    }

    /// Submits a match result between two players, updating both profiles.
    pub fn submit_match_result(
        &mut self,
        winner_id: &str,
        loser_id: &str,
    ) -> Option<EloMatchResult> {
        if winner_id == loser_id {
            return None;
        }

        let (winner_ap, loser_ap) = {
            let w = self.profiles.get(winner_id)?;
            let l = self.profiles.get(loser_id)?;
            (w.current_ap, l.current_ap)
        };

        let result = compute_match_elo(winner_ap, loser_ap, self.season_k_factor);

        if let Some(w) = self.profiles.get_mut(winner_id) {
            w.record_match(true, result.winner_gain as i32);
        }
        if let Some(l) = self.profiles.get_mut(loser_id) {
            l.record_match(false, -(result.loser_loss as i32));
        }

        Some(result)
    }

    /// Returns the top players sorted by AP.
    #[must_use]
    pub fn leaderboard(&self, limit: usize) -> Vec<&PlayerCompetitiveProfile> {
        let mut list: Vec<&PlayerCompetitiveProfile> = self.profiles.values().collect();
        list.sort_by(|a, b| {
            b.current_ap
                .cmp(&a.current_ap)
                .then_with(|| b.wins.cmp(&a.wins))
        });
        list.truncate(limit);
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rank_tier_resolution() {
        assert_eq!(RankTier::from_ap(0), RankTier::Fer);
        assert_eq!(RankTier::from_ap(150), RankTier::Fer);
        assert_eq!(RankTier::from_ap(200), RankTier::Bronze);
        assert_eq!(RankTier::from_ap(750), RankTier::Or);
        assert_eq!(RankTier::from_ap(1650), RankTier::Divin);
        assert_eq!(RankTier::from_ap(2500), RankTier::Legendaire);
    }

    #[test]
    fn test_tier_elo_factors_asymmetry() {
        // Fer: +20 win / -5 loss at parity
        let fer = tier_elo_factors(RankTier::Fer);
        assert_eq!(fer.win_k, 40);
        assert_eq!(fer.loss_k, 10);

        // Divin: strictly symmetric ±16 at parity
        let divin = tier_elo_factors(RankTier::Divin);
        assert_eq!(divin.win_k, 32);
        assert_eq!(divin.loss_k, 32);
    }

    #[test]
    fn test_progressive_elo_delta_equal_rating() {
        // At equal rating (50% expected score), winner gets win_k * 0.5, loser loses loss_k * 0.5
        let delta_win = progressive_elo_delta(100, 100, 1.0, RankTier::Fer, 32);
        let delta_loss = progressive_elo_delta(100, 100, 0.0, RankTier::Fer, 32);

        assert_eq!(delta_win, 20); // 40 * 0.5 = 20
        assert_eq!(delta_loss, -5); // 10 * -0.5 = -5
    }

    #[test]
    fn test_compute_match_elo_updates() {
        let result = compute_match_elo(500, 500, 32); // Argent tier
        assert_eq!(result.winner_gain, 19); // 38 * 0.5 = 19
        assert_eq!(result.loser_loss, 8); // 16 * 0.5 = 8
        assert_eq!(result.new_winner_elo, 519);
        assert_eq!(result.new_loser_elo, 492);
    }

    #[test]
    fn test_player_profile_and_ladder() {
        let mut ladder = CompetitiveLadder::new(1, 32);
        ladder.get_or_create("user_mark", "Mark Evans");
        ladder.get_or_create("user_axel", "Axel Blaze");

        let res = ladder
            .submit_match_result("user_mark", "user_axel")
            .unwrap();
        assert!(res.winner_gain > 0);

        let mark = ladder.profiles.get("user_mark").unwrap();
        assert_eq!(mark.wins, 1);
        assert_eq!(mark.losses, 0);
        assert_eq!(mark.matches_played, 1);
        assert_eq!(mark.win_rate(), 100.0);
        assert_eq!(mark.current_streak, 1);

        let axel = ladder.profiles.get("user_axel").unwrap();
        assert_eq!(axel.wins, 0);
        assert_eq!(axel.losses, 1);
        assert_eq!(axel.current_streak, -1);

        let top = ladder.leaderboard(10);
        assert_eq!(top[0].user_id, "user_mark");
    }
}
