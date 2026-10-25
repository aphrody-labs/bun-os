// SPDX-License-Identifier: Apache-2.0
//! Material 3 components with state, keyboard handling, accessibility and visuals.
//!
//! Every size, colour role, opacity, shape and elevation comes from the Google-qualified
//! `aphrody_m3_tokens::component` tables (checked against material-web v2.5.0 by
//! `crates/aphrody-m3-tokens/tests/google_components.rs`). The few geometric constants that are not
//! tokens (radio ring, check glyph, label insets) are named and documented where they are used.

mod buttons;
mod card;
mod chip;
mod navigation;
mod overlay;
mod progress;
mod selection;
mod slider;

pub use buttons::{
    ButtonGroup, ButtonGroupKind, Fab, FabSize, GroupButton, IconButton, IconButtonKind, IconShape,
    SplitButton,
};
pub use card::{Card, CardKind};
pub use chip::{Chip, ChipKind};
pub use navigation::{NavigationBar, NavigationItem, Tab, Tabs};
pub use overlay::{Dialog, Menu, MenuItem};
pub use progress::LoadingIndicator;
pub use selection::{CheckState, Checkbox, RadioGroup, RadioOption, Switch};
pub use slider::Slider;

use crate::a11y::Accessible;
use crate::interaction::Interaction;
use crate::keyboard::Key;
use crate::visual::{Part, Rect};

/// Outcome of a key press on a component.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    /// A checkbox changed state.
    Checked(CheckState),
    /// A two-state control (switch, toggle, filter chip) changed.
    Toggled(bool),
    /// Item `index` of a single-select composite became selected.
    Selected(usize),
    /// Roving focus moved to item `index` without selecting it.
    Focused(usize),
    /// A button-like control was activated.
    Activated,
    /// Item `index` of a menu or dialog action row was activated.
    Action(usize),
    /// A slider value changed.
    ValueChanged(f32),
    /// An input chip asked to be removed.
    Removed,
    /// A popup (menu) opened.
    Opened,
    /// A dialog or menu was dismissed.
    Dismissed,
}

/// A Material 3 component.
pub trait Control {
    /// Accessibility node (with children for composites).
    fn accessible(&self) -> Accessible;
    /// Apply a key press; `None` when the key is not handled.
    fn handle_key(&mut self, key: Key) -> Option<Event>;
    /// Visual size in dp (container, not touch target).
    fn size(&self) -> (f32, f32);
    /// Minimum pointer target in dp (at least [`crate::accessibility::MIN_TARGET_DP`] where M3 asks).
    fn target(&self) -> (f32, f32) {
        let min = crate::accessibility::MIN_TARGET_DP as f32;
        let (w, h) = self.size();
        (w.max(min), h.max(min))
    }
    /// Paint parts for the component laid out in `rect`.
    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part>;
}

#[cfg(test)]
mod tests;
