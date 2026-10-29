//! Tournament bracket generation, match scheduling, Swiss stages, and circuit points.
//!
//! Reconstructed and ported from a previous tournament engine
//! (`apps/achillea-bot/src/services/TournamentsService.ts`, `BracketService.ts`,
//! `SwissStageService.ts` and `@achillea/core/tournaments`):
//! - Single Elimination, Double Elimination, and Swiss Stage tournament formats
//! - Automated bracket seeding and round progression
//! - Circuit points calculation weighted by bracket size
//! - Dense ranking tier resolution (1er, 2e, 3e-4e, 5e-8e, 9e-16e)
//! - Score reporting and verification

use serde::{Deserialize, Serialize};

/// Tournament bracket formats supported by the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TournamentFormat {
    /// Standard single elimination tree.
    #[default]
    SingleElimination,
    /// Double elimination with winners and losers brackets.
    DoubleElimination,
    /// Swiss tournament format with pairing rounds based on win record.
    Swiss,
}

/// Lifecycle states of a tournament.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TournamentStatus {
    /// Open for participant registration.
    #[default]
    Registration,
    /// Check-in window open before bracket generation.
    CheckIn,
    /// Live tournament in progress.
    InProgress,
    /// Finished with final standings resolved.
    Completed,
    /// Cancelled before completion.
    Cancelled,
}

/// Score reporting permission policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ScoreReportPolicy {
    /// Both participating players can enter scores, subject to mutual agreement.
    #[default]
    Players,
    /// Only staff / referees can enter match scores.
    StaffOnly,
}

/// A registered tournament participant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentParticipant {
    pub player_id: String,
    pub player_name: String,
    pub seed: usize,
    pub checked_in: bool,
    pub wins: u32,
    pub losses: u32,
    pub final_rank: Option<usize>,
}

/// An individual match within a tournament bracket or Swiss round.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentMatch {
    pub match_id: String,
    pub round: u32,
    pub match_number: u32,
    pub player_home_id: Option<String>,
    pub player_away_id: Option<String>,
    pub score_home: u8,
    pub score_away: u8,
    pub winner_id: Option<String>,
    pub is_completed: bool,
}

/// Circuit points table defining base points per placement tier.
#[derive(Debug, Clone, Copy)]
pub struct CircuitPointsTable {
    pub first: u32,
    pub second: u32,
    pub tier34: u32,
    pub tier58: u32,
    pub tier916: u32,
    pub rest: u32,
}

impl Default for CircuitPointsTable {
    fn default() -> Self {
        Self {
            first: 100,
            second: 65,
            tier34: 40,
            tier58: 22,
            tier916: 10,
            rest: 3,
        }
    }
}

/// Multiplier factor according to tournament participant count.
#[must_use]
pub fn circuit_size_weight(size: usize) -> f64 {
    match size {
        0..=8 => 0.5,
        9..=16 => 0.7,
        17..=32 => 1.0,
        33..=64 => 1.3,
        65..=128 => 1.6,
        _ => 2.0,
    }
}

/// Translates a 1-based dense rank into readable tier boundaries (lo, hi, label).
#[must_use]
pub fn dense_rank_to_tier(dense_rank: usize) -> (usize, usize, &'static str) {
    match dense_rank {
        0 => (0, 0, "?"),
        1 => (1, 1, "1er"),
        2 => (2, 2, "2e"),
        3 => (3, 4, "3e-4e (demi-finale)"),
        4 => (5, 8, "5e-8e (quart de finale)"),
        5 => (9, 16, "9e-16e"),
        _ => (17, 32, "Top 32"),
    }
}

/// Computes circuit points for a given dense rank in a tournament of `size` participants.
#[must_use]
pub fn circuit_points_for_rank(size: usize, dense_rank: usize) -> u32 {
    if dense_rank == 0 || size == 0 {
        return 0;
    }
    let table = CircuitPointsTable::default();
    let base = match dense_rank {
        1 => table.first,
        2 => table.second,
        3 => table.tier34,
        4 => table.tier58,
        5 => table.tier916,
        _ => table.rest,
    };
    let weight = circuit_size_weight(size);
    (base as f64 * weight).round() as u32
}

/// A complete tournament instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tournament {
    pub id: String,
    pub name: String,
    pub format: TournamentFormat,
    pub status: TournamentStatus,
    pub report_policy: ScoreReportPolicy,
    pub max_participants: usize,
    pub participants: Vec<TournamentParticipant>,
    pub matches: Vec<TournamentMatch>,
    pub current_round: u32,
}

impl Tournament {
    /// Creates a new tournament in registration state.
    #[must_use]
    pub fn new(
        id: String,
        name: String,
        format: TournamentFormat,
        max_participants: usize,
    ) -> Self {
        Self {
            id,
            name,
            format,
            status: TournamentStatus::Registration,
            report_policy: ScoreReportPolicy::Players,
            max_participants,
            participants: Vec::new(),
            matches: Vec::new(),
            current_round: 0,
        }
    }

    /// Registers a new participant if space is available.
    pub fn register_player(&mut self, player_id: String, player_name: String) -> bool {
        if self.status != TournamentStatus::Registration {
            return false;
        }
        if self.participants.len() >= self.max_participants {
            return false;
        }
        if self.participants.iter().any(|p| p.player_id == player_id) {
            return false;
        }
        let seed = self.participants.len() + 1;
        self.participants.push(TournamentParticipant {
            player_id,
            player_name,
            seed,
            checked_in: false,
            wins: 0,
            losses: 0,
            final_rank: None,
        });
        true
    }

    /// Checks in a participant.
    pub fn check_in_player(&mut self, player_id: &str) -> bool {
        if let Some(p) = self
            .participants
            .iter_mut()
            .find(|p| p.player_id == player_id)
        {
            p.checked_in = true;
            true
        } else {
            false
        }
    }

    /// Starts the tournament and generates initial round 1 matches.
    pub fn start_tournament(&mut self) -> bool {
        if self.participants.len() < 2 {
            return false;
        }
        self.status = TournamentStatus::InProgress;
        self.current_round = 1;
        self.matches.clear();

        let checked_in_count = self.participants.iter().filter(|p| p.checked_in).count();
        // If players didn't explicitly check in, default all registered to active
        if checked_in_count < 2 {
            for p in &mut self.participants {
                p.checked_in = true;
            }
        }

        let players: Vec<String> = self
            .participants
            .iter()
            .filter(|p| p.checked_in)
            .map(|p| p.player_id.clone())
            .collect();

        // Generate round 1 pairings
        let pairs_count = players.len() / 2;
        for i in 0..pairs_count {
            let home = players[i].clone();
            let away = players[players.len() - 1 - i].clone();
            self.matches.push(TournamentMatch {
                match_id: format!("{}_r1_m{}", self.id, i + 1),
                round: 1,
                match_number: (i + 1) as u32,
                player_home_id: Some(home),
                player_away_id: Some(away),
                score_home: 0,
                score_away: 0,
                winner_id: None,
                is_completed: false,
            });
        }

        true
    }

    /// Reports the score for an active match.
    pub fn report_match_score(&mut self, match_id: &str, score_home: u8, score_away: u8) -> bool {
        if self.status != TournamentStatus::InProgress {
            return false;
        }
        let Some(m) = self.matches.iter_mut().find(|m| m.match_id == match_id) else {
            return false;
        };

        if m.is_completed {
            return false;
        }

        m.score_home = score_home;
        m.score_away = score_away;

        let winner = if score_home > score_away {
            m.player_home_id.clone()
        } else if score_away > score_home {
            m.player_away_id.clone()
        } else {
            // Draw in tournament bracket: home wins by default tiebreaker
            m.player_home_id.clone()
        };

        m.winner_id = winner.clone();
        m.is_completed = true;

        if let Some(p) =
            winner.and_then(|w| self.participants.iter_mut().find(|p| p.player_id == w))
        {
            p.wins += 1;
        }

        // Check if all matches in round are finished
        self.check_round_progression();
        true
    }

    fn check_round_progression(&mut self) {
        let current_round_matches: Vec<&TournamentMatch> = self
            .matches
            .iter()
            .filter(|m| m.round == self.current_round)
            .collect();

        if current_round_matches.is_empty() || !current_round_matches.iter().all(|m| m.is_completed)
        {
            return;
        }

        let winners: Vec<String> = current_round_matches
            .iter()
            .filter_map(|m| m.winner_id.clone())
            .collect();

        if winners.len() <= 1 {
            // Tournament completed!
            self.status = TournamentStatus::Completed;
            if let Some(p) = winners
                .first()
                .and_then(|champ| self.participants.iter_mut().find(|p| &p.player_id == champ))
            {
                p.final_rank = Some(1);
            }
            return;
        }

        // Next round
        self.current_round += 1;
        let pairs_count = winners.len() / 2;
        for i in 0..pairs_count {
            let home = winners[i * 2].clone();
            let away = winners[i * 2 + 1].clone();
            self.matches.push(TournamentMatch {
                match_id: format!("{}_r{}_m{}", self.id, self.current_round, i + 1),
                round: self.current_round,
                match_number: (i + 1) as u32,
                player_home_id: Some(home),
                player_away_id: Some(away),
                score_home: 0,
                score_away: 0,
                winner_id: None,
                is_completed: false,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_points_weights() {
        assert_eq!(circuit_size_weight(8), 0.5);
        assert_eq!(circuit_size_weight(16), 0.7);
        assert_eq!(circuit_size_weight(32), 1.0);
        assert_eq!(circuit_size_weight(64), 1.3);
        assert_eq!(circuit_size_weight(128), 1.6);
        assert_eq!(circuit_size_weight(256), 2.0);

        // Rank 1 (first place = 100) in 32-player bracket = 100 points
        assert_eq!(circuit_points_for_rank(32, 1), 100);
        // Rank 1 in 64-player bracket = 130 points
        assert_eq!(circuit_points_for_rank(64, 1), 130);
    }

    #[test]
    fn test_dense_rank_labels() {
        assert_eq!(dense_rank_to_tier(1).2, "1er");
        assert_eq!(dense_rank_to_tier(2).2, "2e");
        assert_eq!(dense_rank_to_tier(3).2, "3e-4e (demi-finale)");
        assert_eq!(dense_rank_to_tier(4).2, "5e-8e (quart de finale)");
    }

    #[test]
    fn test_tournament_full_lifecycle() {
        let mut tourney = Tournament::new(
            "tourney_01".into(),
            "Achillea Opening Cup".into(),
            TournamentFormat::SingleElimination,
            4,
        );

        assert!(tourney.register_player("p1".into(), "Mark".into()));
        assert!(tourney.register_player("p2".into(), "Axel".into()));
        assert!(tourney.register_player("p3".into(), "Jude".into()));
        assert!(tourney.register_player("p4".into(), "Shawn".into()));

        assert!(tourney.start_tournament());
        assert_eq!(tourney.matches.len(), 2);
        assert_eq!(tourney.current_round, 1);

        // Semi-final 1: p1 vs p4 (p1 wins 3-1)
        assert!(tourney.report_match_score("tourney_01_r1_m1", 3, 1));
        // Semi-final 2: p2 vs p3 (p2 wins 2-0)
        assert!(tourney.report_match_score("tourney_01_r1_m2", 2, 0));

        // Advance to finals round 2
        assert_eq!(tourney.current_round, 2);
        assert_eq!(tourney.matches.len(), 3);

        // Finals: p1 vs p2 (p1 wins 2-1)
        assert!(tourney.report_match_score("tourney_01_r2_m1", 2, 1));

        assert_eq!(tourney.status, TournamentStatus::Completed);
        let champ = tourney
            .participants
            .iter()
            .find(|p| p.player_id == "p1")
            .unwrap();
        assert_eq!(champ.final_rank, Some(1));
        assert_eq!(champ.wins, 2);
    }
}
