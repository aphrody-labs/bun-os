// SPDX-License-Identifier: Apache-2.0
//! Bevy UI renderer for libm3: the Material 3 widget kit of the Bun OS console shell and any other
//! `bevy_ui` host (Bun Engine runtime menus).
//!
//! Like [`crate::cosmic`], this module only translates: colours, shapes, state layers and type come
//! from [`Component::style_with`](crate::Component::style_with), the theme from
//! [`Theme::from_seed`](crate::Theme::from_seed) (the native M3 dynamic-colour engine), sizes from
//! the mirrored `md.comp.*` tables of `aphrody-m3-tokens`, and the re-tint transition from the
//! M3 motion tokens. Input behaviour stays with the host: the kit reads the standard Bevy
//! interaction markers (`Hovered`, `Pressed`, `InteractionDisabled`, `Checked`/`Selected`,
//! `InputFocus`) and never activates anything itself, so it composes with `bevy_ui_widgets`
//! buttons, with automatic directional navigation and with the shell's own action dispatcher.
//!
//! ```ignore
//! app.add_plugins(libm3::bevy::M3Plugin::new(M3Theme::new(ThemeMode::Dark, seed, Variant::TonalSpot, 0.0)?.with_scale(1.25)));
//! // in a spawning system:
//! let kit = Kit::new(&theme, &fonts);
//! commands.spawn(kit.button(libm3::Component::FilledButton, label, Some("play_arrow")));
//! ```

use std::{string::String, vec::Vec};

use ::bevy::a11y::AccessibilityNode;
use ::bevy::input_focus::{InputFocus, InputFocusVisible};
use ::bevy::picking::hover::Hovered;
use ::bevy::prelude::*;
use ::bevy::text::{FontSize, FontWeight};
use ::bevy::ui::{Checked, InteractionDisabled, Pressed, Selected};

use crate::containers::Containers;
use crate::tokens::{ShapeRole, TypeRole, easing_curve};
use crate::{
    Color as M3Color, ColorScheme, Component as Kind, Density, Interaction as M3Interaction, Role,
    Theme, ThemeMode,
};
use m3_tokens::component as comp;
use m3_tokens::scheme::Variant;

/// `md.comp.linear-progress-indicator.track-height` (not mirrored in `aphrody-m3-tokens` yet).
const PROGRESS_TRACK_HEIGHT_DP: f32 = 4.0;
/// `md.comp.badge.large.size` and its horizontal padding (not mirrored yet).
const BADGE_LARGE_SIZE_DP: f32 = 16.0;
const BADGE_LARGE_PADDING_DP: f32 = 4.0;

/// libm3 ARGB to a Bevy sRGB colour.
pub fn to_bevy(color: M3Color) -> ::bevy::prelude::Color {
    let [r, g, b, a] = color.rgba();
    ::bevy::prelude::Color::srgba_u8(r, g, b, a)
}

/// One semantic role of a libm3 theme as a Bevy colour.
pub fn color(theme: &Theme, role: Role) -> ::bevy::prelude::Color {
    to_bevy(theme.colors.get(role))
}

/// The live theme: the current M3 theme (possibly mid re-tint), its seed request and the display
/// scale (1.0 desktop, 1.25 for 10-foot viewing). Hosts re-seed it from art ([`M3Theme::retint`])
/// or replace the scheme resolved by the platform layer ([`M3Theme::set_hex_roles`]).
#[derive(Resource, Clone, Debug)]
pub struct M3Theme {
    pub theme: Theme,
    pub seed: u32,
    pub variant: Variant,
    pub contrast: f64,
    pub scale: f32,
    from: ColorScheme,
    to: ColorScheme,
    t: f32,
}

impl M3Theme {
    pub fn new(
        mode: ThemeMode,
        seed: u32,
        variant: Variant,
        contrast: f64,
    ) -> Result<Self, String> {
        let theme = Theme::from_seed(mode, seed, variant, contrast)?;
        Ok(Self {
            theme,
            seed,
            variant,
            contrast,
            scale: 1.0,
            from: theme.colors,
            to: theme.colors,
            t: 1.0,
        })
    }

    pub fn with_scale(mut self, scale: f32) -> Self {
        self.scale = scale;
        self
    }

    pub fn with_density(mut self, density: Density) -> Self {
        self.theme.density = density;
        self
    }

    pub fn reduced_motion(&self) -> bool {
        self.theme.motion == crate::tokens::Motion::Reduced
    }

    pub fn set_reduced_motion(&mut self, reduced: bool) {
        self.theme.motion = if reduced {
            crate::tokens::Motion::Reduced
        } else {
            crate::tokens::Motion::Standard
        };
    }

    pub fn color(&self, role: Role) -> ::bevy::prelude::Color {
        to_bevy(self.theme.colors.get(role))
    }

    pub fn containers(&self) -> Containers {
        Containers::from_theme(self.theme)
    }

    /// Re-seed the scheme (dynamic color from the focused game's art); animated.
    pub fn retint(&mut self, seed: u32) {
        if seed == self.seed {
            return;
        }
        if let Ok(next) = Theme::from_seed(self.theme.mode, seed, self.variant, self.contrast) {
            self.seed = seed;
            self.transition_to(next.colors);
        }
    }

    pub fn set_mode(&mut self, mode: ThemeMode) {
        if mode == self.theme.mode {
            return;
        }
        if let Ok(next) = Theme::from_seed(mode, self.seed, self.variant, self.contrast) {
            self.theme.mode = mode;
            self.transition_to(next.colors);
        }
    }

    /// Adopt a scheme resolved elsewhere (platform theme files: `bun-os-theme/1` `color` map of
    /// kebab-case roles to `#rrggbb`). Returns false, keeping the current scheme, when a role is
    /// missing or invalid.
    pub fn set_hex_roles<'a>(
        &mut self,
        roles: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> bool {
        match ColorScheme::from_hex_roles(roles) {
            Ok(colors) => {
                self.transition_to(colors);
                true
            }
            Err(_) => false,
        }
    }

    fn transition_to(&mut self, colors: ColorScheme) {
        self.from = self.theme.colors;
        self.to = colors;
        if self.reduced_motion() {
            self.theme.colors = colors;
            self.t = 1.0;
        } else {
            self.t = 0.0;
        }
    }

    /// Advance the re-tint (`md.sys.motion.duration.medium2` on the emphasized easing); returns
    /// true while it runs.
    pub fn step(&mut self, dt: f32) -> bool {
        if self.t >= 1.0 {
            return false;
        }
        let seconds = f32::from(m3_tokens::motion::DURATION_MEDIUM2.ms) / 1000.0;
        self.t = (self.t + dt / seconds).min(1.0);
        let eased =
            easing_curve(m3_tokens::motion::EASING_EMPHASIZED).map_or(self.t, |c| c.eval(self.t));
        self.theme.colors = self.from.mix(self.to, eased);
        true
    }

    /// Progress of the current re-tint (0..1), for hosts that cross-fade art with it.
    pub fn progress(&self) -> f32 {
        self.t
    }

    /// A length in dp at the display scale.
    pub fn dp(&self, dp: f32) -> f32 {
        dp * self.scale
    }

    pub fn radius(&self, shape: ShapeRole) -> f32 {
        f32::from(self.theme.shapes.get(shape)) * self.scale
    }

    /// Size (px) and weight of a type role at the display scale.
    pub fn type_style(&self, role: TypeRole) -> (f32, u16) {
        let style = self.theme.typography.get(role);
        (style.size * self.scale, style.weight)
    }
}

/// Fonts the host loaded (the kit never discovers fonts): the text family of the type scale and
/// the Material Symbols font whose ligatures draw icons.
#[derive(Resource, Clone, Debug)]
pub struct M3Fonts {
    pub text: Handle<Font>,
    pub symbols: Handle<Font>,
}

/// An interactive M3 component; its container, border, shape and content colours follow
/// [`M3State`] and the live [`M3Theme`].
#[derive(Component, Clone, Copy, Debug)]
#[require(Node, BackgroundColor, BorderColor, M3State, Hovered)]
pub struct M3Widget(pub Kind);

/// A non-interactive M3 surface (dialog, sheet, menu, card, rail, snackbar): rest style only.
#[derive(Component, Clone, Copy, Debug)]
#[require(Node, BackgroundColor, BorderColor)]
pub struct M3Surface(pub Kind);

/// Resolved interaction of a widget (written by the kit from the Bevy interaction markers).
#[derive(Component, Clone, Copy, Debug, Default, PartialEq)]
pub struct M3State {
    pub interaction: M3Interaction,
    pub selected: bool,
}

/// Text or icon painted with the foreground of its nearest [`M3Widget`] / [`M3Surface`] ancestor.
#[derive(Component, Clone, Copy, Debug, Default)]
pub struct M3OnColor;

/// Opt-in M3 focus indicator (`md.sys.state.focus-indicator`): an outline in `secondary` while
/// the widget holds visible focus. Hosts with their own focus feedback leave it off.
#[derive(Component, Clone, Copy, Debug, Default)]
#[require(Outline)]
pub struct M3FocusRing;

/// A node painted with a fixed role (text, background or border) and opacity.
#[derive(Component, Clone, Copy, Debug, PartialEq)]
pub enum M3Paint {
    Text(Role, f32),
    Background(Role, f32),
    Border(Role, f32),
}

/// Keeps a text node on its type role when the display scale changes.
#[derive(Component, Clone, Copy, Debug)]
pub struct M3Type(pub TypeRole);

/// Switch track (add `Checked` when on); its child carries [`M3SwitchHandle`].
#[derive(Component, Clone, Copy, Debug, Default)]
#[require(Node, BackgroundColor, BorderColor, M3State, Hovered)]
pub struct M3Switch;

#[derive(Component, Clone, Copy, Debug, Default)]
pub struct M3SwitchHandle;

/// Linear progress track with its value in 0..=1; its child carries [`M3ProgressIndicator`].
#[derive(Component, Clone, Copy, Debug, PartialEq)]
pub struct M3Progress(pub f32);

#[derive(Component, Clone, Copy, Debug, Default)]
pub struct M3ProgressIndicator;

/// Installs [`M3Theme`] and the styling systems.
pub struct M3Plugin {
    pub theme: M3Theme,
}

impl M3Plugin {
    pub fn new(theme: M3Theme) -> Self {
        Self { theme }
    }
}

/// Ordering handle for hosts (`.before(M3Systems)` to change state in the same frame).
#[derive(SystemSet, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct M3Systems;

impl Plugin for M3Plugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(self.theme.clone()).add_systems(
            Update,
            (
                step_theme,
                track_interaction,
                apply_widgets,
                apply_surfaces,
                apply_switches,
                apply_progress,
                apply_paints,
                apply_type,
            )
                .chain()
                .in_set(M3Systems),
        );
    }
}

fn step_theme(time: Res<Time>, mut theme: ResMut<M3Theme>) {
    if theme.t < 1.0 {
        theme.step(time.delta_secs());
    }
}

fn track_interaction(
    focus: Option<Res<InputFocus>>,
    visible: Option<Res<InputFocusVisible>>,
    mut widgets: Query<
        (
            Entity,
            &mut M3State,
            &Hovered,
            Has<Pressed>,
            Has<InteractionDisabled>,
            Has<Checked>,
            Has<Selected>,
        ),
        Or<(With<M3Widget>, With<M3Switch>)>,
    >,
) {
    let focused = focus.as_ref().and_then(|f| f.get());
    let ring = visible.as_ref().is_none_or(|v| v.0);
    for (entity, mut state, hovered, pressed, disabled, checked, selected) in &mut widgets {
        let interaction = if disabled {
            M3Interaction::Disabled
        } else if pressed {
            M3Interaction::Pressed
        } else if ring && focused == Some(entity) {
            M3Interaction::Focused
        } else if hovered.get() {
            M3Interaction::Hovered
        } else {
            M3Interaction::Rest
        };
        state.set_if_neq(M3State {
            interaction,
            selected: checked || selected,
        });
    }
}

type Nested = Or<(With<M3Widget>, With<M3Surface>, With<M3Switch>)>;

/// Paint every [`M3OnColor`] descendant of `root` (stopping at nested components).
fn paint_content(
    root: Entity,
    color: ::bevy::prelude::Color,
    children: &Query<&Children>,
    nested: &Query<(), Nested>,
    content: &mut Query<&mut TextColor, With<M3OnColor>>,
) {
    let mut stack: Vec<Entity> = children
        .get(root)
        .map(|c| c.iter().collect())
        .unwrap_or_default();
    while let Some(child) = stack.pop() {
        if nested.contains(child) {
            continue;
        }
        if let Ok(mut text) = content.get_mut(child) {
            text.set_if_neq(TextColor(color));
        }
        if let Ok(grand) = children.get(child) {
            stack.extend(grand.iter());
        }
    }
}

fn shape_node(node: &mut Mut<Node>, radius: f32, min_height: f32, added: bool) {
    let radius = BorderRadius::all(px(radius));
    if node.border_radius != radius {
        node.border_radius = radius;
    }
    if added && node.min_height == Val::Auto {
        node.min_height = px(min_height);
    }
}

#[allow(clippy::type_complexity)]
fn apply_widgets(
    theme: Res<M3Theme>,
    mut widgets: Query<(
        Entity,
        Ref<M3State>,
        &M3Widget,
        &mut BackgroundColor,
        &mut BorderColor,
        &mut Node,
        Option<&mut Outline>,
        Has<M3FocusRing>,
    )>,
    children: Query<&Children>,
    nested: Query<(), Nested>,
    mut content: Query<&mut TextColor, With<M3OnColor>>,
) {
    let all = theme.is_changed();
    for (entity, state, widget, mut bg, mut border, mut node, outline, ring) in &mut widgets {
        if !(all || state.is_changed()) {
            continue;
        }
        let style = widget
            .0
            .style_with(theme.theme, state.selected, state.interaction);
        bg.set_if_neq(BackgroundColor(to_bevy(style.background)));
        border.set_if_neq(BorderColor::all(to_bevy(style.border)));
        if all || state.is_added() {
            shape_node(
                &mut node,
                f32::from(style.corner_radius) * theme.scale,
                f32::from(style.min_height) * theme.scale,
                state.is_added(),
            );
        }
        if ring && let Some(mut outline) = outline {
            let focused = state.interaction == M3Interaction::Focused;
            let next = Outline::new(
                px(theme.dp(comp::focus_indicator::THICKNESS)),
                px(theme.dp(comp::focus_indicator::OUTER_OFFSET)),
                if focused {
                    theme.color(Role::Secondary)
                } else {
                    ::bevy::prelude::Color::NONE
                },
            );
            outline.set_if_neq(next);
        }
        paint_content(
            entity,
            to_bevy(style.foreground),
            &children,
            &nested,
            &mut content,
        );
    }
}

fn apply_surfaces(
    theme: Res<M3Theme>,
    mut surfaces: Query<
        (
            Entity,
            Ref<M3Surface>,
            &mut BackgroundColor,
            &mut BorderColor,
            &mut Node,
        ),
        Without<M3Widget>,
    >,
    children: Query<&Children>,
    nested: Query<(), Nested>,
    mut content: Query<&mut TextColor, With<M3OnColor>>,
) {
    let all = theme.is_changed();
    for (entity, surface, mut bg, mut border, mut node) in &mut surfaces {
        if !(all || surface.is_changed()) {
            continue;
        }
        let style = surface.0.style(theme.theme, M3Interaction::Rest);
        bg.set_if_neq(BackgroundColor(to_bevy(style.background)));
        border.set_if_neq(BorderColor::all(to_bevy(style.border)));
        shape_node(
            &mut node,
            f32::from(style.corner_radius) * theme.scale,
            0.0,
            false,
        );
        paint_content(
            entity,
            to_bevy(style.foreground),
            &children,
            &nested,
            &mut content,
        );
    }
}

#[allow(clippy::type_complexity)]
fn apply_switches(
    theme: Res<M3Theme>,
    mut tracks: Query<
        (
            Ref<M3State>,
            &Children,
            &mut BackgroundColor,
            &mut BorderColor,
            &mut Node,
        ),
        (With<M3Switch>, Without<M3Widget>),
    >,
    mut handles: Query<
        (&mut Node, &mut BackgroundColor),
        (With<M3SwitchHandle>, Without<M3Switch>),
    >,
) {
    use comp::switch as t;
    let all = theme.is_changed();
    for (state, children, mut bg, mut border, mut node) in &mut tracks {
        if !(all || state.is_changed()) {
            continue;
        }
        let on = state.selected;
        let pressed = state.interaction == M3Interaction::Pressed;
        let disabled = state.interaction == M3Interaction::Disabled;
        let active = matches!(
            state.interaction,
            M3Interaction::Hovered | M3Interaction::Focused | M3Interaction::Pressed
        );
        let c = |role| theme.theme.colors.get(role);
        let fade = |color: M3Color, layer: m3_tokens::state::StateLayer| {
            if disabled {
                color.with_opacity(layer.opacity)
            } else {
                color
            }
        };
        let track = if on {
            c(Role::Primary)
        } else {
            c(Role::SurfaceContainerHighest)
        };
        let outline = if on {
            M3Color::TRANSPARENT
        } else {
            c(Role::Outline)
        };
        let handle = match (on, active) {
            (true, false) => c(Role::OnPrimary),
            (true, true) => c(Role::PrimaryContainer),
            (false, false) => c(Role::Outline),
            (false, true) => c(Role::OnSurfaceVariant),
        };
        bg.set_if_neq(BackgroundColor(to_bevy(fade(
            track,
            m3_tokens::state::DISABLED_CONTAINER,
        ))));
        border.set_if_neq(BorderColor::all(to_bevy(fade(
            outline,
            m3_tokens::state::DISABLED_CONTAINER,
        ))));
        let outline_width = if on { 0.0 } else { t::TRACK_OUTLINE_WIDTH };
        let size = if pressed {
            t::PRESSED_HANDLE_WIDTH
        } else if on {
            t::SELECTED_HANDLE_WIDTH
        } else {
            t::UNSELECTED_HANDLE_WIDTH
        };
        let inset = ((t::TRACK_HEIGHT - size) / 2.0 - outline_width).max(0.0);
        node.width = px(theme.dp(t::TRACK_WIDTH));
        node.height = px(theme.dp(t::TRACK_HEIGHT));
        node.border = UiRect::all(px(theme.dp(outline_width)));
        node.padding = UiRect::horizontal(px(theme.dp(inset)));
        node.align_items = AlignItems::Center;
        node.justify_content = if on {
            JustifyContent::FlexEnd
        } else {
            JustifyContent::FlexStart
        };
        node.border_radius = BorderRadius::all(px(theme.radius(ShapeRole::Full)));
        for child in children.iter() {
            if let Ok((mut handle_node, mut handle_bg)) = handles.get_mut(child) {
                handle_node.width = px(theme.dp(size));
                handle_node.height = px(theme.dp(size));
                handle_node.border_radius = BorderRadius::all(px(theme.radius(ShapeRole::Full)));
                handle_bg.set_if_neq(BackgroundColor(to_bevy(fade(
                    handle,
                    m3_tokens::state::DISABLED_CONTENT,
                ))));
            }
        }
    }
}

fn apply_progress(
    tracks: Query<(Ref<M3Progress>, &Children)>,
    mut indicators: Query<&mut Node, With<M3ProgressIndicator>>,
) {
    for (progress, children) in &tracks {
        if !progress.is_changed() {
            continue;
        }
        let value = progress.0.clamp(0.0, 1.0) * 100.0;
        for child in children.iter() {
            if let Ok(mut node) = indicators.get_mut(child) {
                node.width = percent(value);
            }
        }
    }
}

fn apply_paints(
    theme: Res<M3Theme>,
    mut paints: Query<
        (
            Ref<M3Paint>,
            Option<&mut TextColor>,
            Option<&mut BackgroundColor>,
            Option<&mut BorderColor>,
        ),
        (
            Without<M3Widget>,
            Without<M3Surface>,
            Without<M3Switch>,
            Without<M3OnColor>,
        ),
    >,
) {
    let all = theme.is_changed();
    for (paint, text, bg, border) in &mut paints {
        if !(all || paint.is_changed()) {
            continue;
        }
        match *paint {
            M3Paint::Text(role, alpha) => {
                if let Some(mut c) = text {
                    c.set_if_neq(TextColor(theme.color(role).with_alpha(alpha)));
                }
            }
            M3Paint::Background(role, alpha) => {
                if let Some(mut c) = bg {
                    c.set_if_neq(BackgroundColor(theme.color(role).with_alpha(alpha)));
                }
            }
            M3Paint::Border(role, alpha) => {
                if let Some(mut c) = border {
                    c.set_if_neq(BorderColor::all(theme.color(role).with_alpha(alpha)));
                }
            }
        }
    }
}

fn apply_type(
    theme: Res<M3Theme>,
    mut last: Local<f32>,
    mut texts: Query<(Ref<M3Type>, &mut TextFont)>,
) {
    let rescaled = (*last - theme.scale).abs() > f32::EPSILON;
    *last = theme.scale;
    for (role, mut font) in &mut texts {
        if !(rescaled || role.is_changed()) {
            continue;
        }
        let (size, weight) = theme.type_style(role.0);
        font.font_size = FontSize::Px(size);
        font.weight = FontWeight(weight);
    }
}

/// An accessibility node named by its action (icon-only controls included).
pub fn a11y(role: accesskit::Role, label: &str) -> AccessibilityNode {
    let mut node = accesskit::Node::new(role);
    node.set_label(String::from(label));
    AccessibilityNode::from(node)
}

/// Bundle builders over the live theme and the host's fonts.
#[derive(Clone, Copy)]
pub struct Kit<'a> {
    pub theme: &'a M3Theme,
    pub fonts: &'a M3Fonts,
}

impl<'a> Kit<'a> {
    pub fn new(theme: &'a M3Theme, fonts: &'a M3Fonts) -> Self {
        Self { theme, fonts }
    }

    fn font(&self, role: TypeRole) -> TextFont {
        let (size, weight) = self.theme.type_style(role);
        TextFont {
            font: self.fonts.text.clone().into(),
            font_size: FontSize::Px(size),
            weight: FontWeight(weight),
            ..default()
        }
    }

    /// Text in a fixed role (`on-surface`, `on-surface-variant`, ...).
    pub fn text(&self, value: impl Into<String>, role: TypeRole, color: Role) -> impl Bundle {
        (
            Text::new(value),
            self.font(role),
            TextColor(::bevy::prelude::Color::NONE),
            M3Paint::Text(color, 1.0),
            M3Type(role),
        )
    }

    /// Text painted with the enclosing component's content colour.
    pub fn label(&self, value: impl Into<String>, role: TypeRole) -> impl Bundle {
        (
            Text::new(value),
            self.font(role),
            TextColor(::bevy::prelude::Color::NONE),
            M3OnColor,
            M3Type(role),
        )
    }

    /// A Material Symbols glyph (ligature name) in the enclosing component's content colour.
    pub fn icon(&self, name: &str, size_dp: f32) -> impl Bundle {
        let size = self.theme.dp(size_dp);
        (
            Text::new(name),
            TextFont {
                font: self.fonts.symbols.clone().into(),
                font_size: FontSize::Px(size),
                ..default()
            },
            TextLayout::no_wrap(),
            TextColor(::bevy::prelude::Color::NONE),
            M3OnColor,
            Node {
                width: px(size),
                height: px(size),
                flex_shrink: 0.0,
                overflow: Overflow::clip(),
                ..default()
            },
        )
    }

    /// A Material Symbols glyph in a fixed role.
    pub fn icon_in(&self, name: &str, size_dp: f32, color: Role) -> impl Bundle {
        let size = self.theme.dp(size_dp);
        (
            Text::new(name),
            TextFont {
                font: self.fonts.symbols.clone().into(),
                font_size: FontSize::Px(size),
                ..default()
            },
            TextLayout::no_wrap(),
            TextColor(::bevy::prelude::Color::NONE),
            M3Paint::Text(color, 1.0),
            Node {
                width: px(size),
                height: px(size),
                flex_shrink: 0.0,
                overflow: Overflow::clip(),
                ..default()
            },
        )
    }

    /// Common buttons (`FilledButton`, `TonalButton`, `OutlinedButton`, `TextButton`,
    /// `DestructiveButton`) with an optional leading icon (`md.comp.button.small`).
    pub fn button(&self, kind: Kind, label: impl Into<String>, icon: Option<&str>) -> impl Bundle {
        use comp::button_small as t;
        let label: String = label.into();
        let access = a11y(accesskit::Role::Button, &label);
        let text = self.label(label, TypeRole::LabelLarge);
        let glyph = icon.map(|name| self.icon(name, t::ICON_SIZE));
        let outline = if kind == Kind::OutlinedButton {
            t::OUTLINED_OUTLINE_WIDTH
        } else {
            0.0
        };
        (
            M3Widget(kind),
            Node {
                height: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                padding: UiRect::new(
                    px(self.theme.dp(t::LEADING_SPACE)),
                    px(self.theme.dp(t::TRAILING_SPACE)),
                    px(0.0),
                    px(0.0),
                ),
                column_gap: px(self.theme.dp(t::ICON_LABEL_SPACE)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                border: UiRect::all(px(self.theme.dp(outline))),
                ..default()
            },
            access,
            Children::spawn(SpawnWith(move |p: &mut ChildSpawner| {
                if let Some(glyph) = glyph {
                    p.spawn(glyph);
                }
                p.spawn(text);
            })),
        )
    }

    /// Icon button (`md.comp.icon-button.standard`); `kind` picks the container (`TextButton`
    /// standard, `FilledButton`, `TonalButton`, `OutlinedButton`). `label` names the action.
    pub fn icon_button(&self, kind: Kind, icon: &str, label: &str) -> impl Bundle {
        use comp::icon_button_small as t;
        let outline = if kind == Kind::OutlinedButton {
            t::OUTLINED_OUTLINE_WIDTH
        } else {
            0.0
        };
        (
            M3Widget(kind),
            Node {
                width: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                height: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                border: UiRect::all(px(self.theme.dp(outline))),
                ..default()
            },
            a11y(accesskit::Role::Button, label),
            children![self.icon(icon, t::ICON_SIZE)],
        )
    }

    /// Floating action button (`md.comp.fab.primary-container`).
    pub fn fab(&self, icon: &str, label: &str) -> impl Bundle {
        use comp::fab as t;
        (
            M3Widget(Kind::FloatingActionButton),
            Node {
                width: px(self.theme.dp(t::CONTAINER_WIDTH)),
                height: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            a11y(accesskit::Role::Button, label),
            children![self.icon(icon, t::ICON_SIZE)],
        )
    }

    /// Filter chip (add `Checked` when selected) or suggestion chip (`md.comp.*-chip`).
    pub fn chip(&self, kind: Kind, label: impl Into<String>, icon: Option<&str>) -> impl Bundle {
        use comp::filter_chip as t;
        let label: String = label.into();
        let access = a11y(accesskit::Role::Button, &label);
        let text = self.label(label, TypeRole::LabelLarge);
        let glyph = icon.map(|name| self.icon(name, t::WITH_ICON_ICON_SIZE));
        let gap = self.theme.dp(comp::button_small::ICON_LABEL_SPACE);
        let outline = if kind == Kind::SuggestionChip {
            comp::suggestion_chip::FLAT_OUTLINE_WIDTH
        } else {
            0.0
        };
        (
            M3Widget(kind),
            Node {
                height: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                padding: UiRect::horizontal(px(self.theme.dp(comp::button_small::LEADING_SPACE))),
                column_gap: px(gap),
                align_items: AlignItems::Center,
                border: UiRect::all(px(self.theme.dp(outline))),
                ..default()
            },
            access,
            Children::spawn(SpawnWith(move |p: &mut ChildSpawner| {
                if let Some(glyph) = glyph {
                    p.spawn(glyph);
                }
                p.spawn(text);
            })),
        )
    }

    /// A container surface (cards, dialog, side/bottom sheet, menu, rail, snackbar, tooltip);
    /// children are the host's. Interactive cards use [`M3Widget`] through [`Kit::card_button`].
    pub fn surface(&self, kind: Kind) -> impl Bundle {
        let gap = self.theme.dp(f32::from(self.theme.theme.density.gap()));
        let border = if kind == Kind::OutlinedCard {
            comp::outlined_card::OUTLINE_WIDTH
        } else {
            0.0
        };
        (
            M3Surface(kind),
            Node {
                flex_direction: FlexDirection::Column,
                padding: UiRect::all(px(gap)),
                row_gap: px(gap),
                border: UiRect::all(px(self.theme.dp(border))),
                ..default()
            },
        )
    }

    /// A focusable card (game tiles, gallery items) with M3 state layers.
    pub fn card_button(&self, kind: Kind, label: &str) -> impl Bundle {
        let border = if kind == Kind::OutlinedCard {
            comp::outlined_card::OUTLINE_WIDTH
        } else {
            0.0
        };
        (
            M3Widget(kind),
            Node {
                flex_direction: FlexDirection::Column,
                overflow: Overflow::clip(),
                border: UiRect::all(px(self.theme.dp(border))),
                ..default()
            },
            a11y(accesskit::Role::Button, label),
        )
    }

    /// List row: optional leading icon, headline, optional supporting text and trailing text
    /// (`md.comp.menu.list-item` height, density gap as horizontal padding).
    pub fn list_item(
        &self,
        headline: impl Into<String>,
        supporting: Option<String>,
        leading_icon: Option<&str>,
        trailing: Option<String>,
    ) -> impl Bundle {
        let headline: String = headline.into();
        let access = a11y(accesskit::Role::ListItem, &headline);
        let gap = self.theme.dp(f32::from(self.theme.theme.density.gap()));
        let head = self.label(headline, TypeRole::BodyLarge);
        let support =
            supporting.map(|s| self.text(s, TypeRole::BodyMedium, Role::OnSurfaceVariant));
        let tail = trailing.map(|s| self.text(s, TypeRole::LabelSmall, Role::OnSurfaceVariant));
        let glyph =
            leading_icon.map(|name| self.icon(name, comp::menu::LIST_ITEM_LEADING_ICON_SIZE));
        (
            M3Widget(Kind::ListItem),
            Node {
                min_height: px(self.theme.dp(comp::menu::LIST_ITEM_CONTAINER_HEIGHT)),
                padding: UiRect::horizontal(px(gap)),
                column_gap: px(gap),
                align_items: AlignItems::Center,
                ..default()
            },
            access,
            Children::spawn(SpawnWith(move |p: &mut ChildSpawner| {
                if let Some(glyph) = glyph {
                    p.spawn(glyph);
                }
                p.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    flex_grow: 1.0,
                    ..default()
                })
                .with_children(|col| {
                    col.spawn(head);
                    if let Some(support) = support {
                        col.spawn(support);
                    }
                });
                if let Some(tail) = tail {
                    p.spawn(tail);
                }
            })),
        )
    }

    /// Switch (`md.comp.switch`): insert `Checked` on the returned entity when on.
    pub fn switch(&self, label: &str) -> impl Bundle {
        (
            M3Switch,
            a11y(accesskit::Role::Switch, label),
            children![(M3SwitchHandle, Node::default(), BackgroundColor::default())],
        )
    }

    /// Linear progress: `secondary-container` track, `primary` indicator.
    pub fn progress(&self, value: f32) -> impl Bundle {
        let height = self.theme.dp(PROGRESS_TRACK_HEIGHT_DP);
        let radius = BorderRadius::all(px(self.theme.radius(ShapeRole::Full)));
        (
            M3Progress(value),
            Node {
                height: px(height),
                width: percent(100.0),
                overflow: Overflow::clip(),
                border_radius: radius,
                ..default()
            },
            BackgroundColor::default(),
            M3Paint::Background(Role::SecondaryContainer, 1.0),
            a11y(accesskit::Role::ProgressIndicator, ""),
            children![(
                M3ProgressIndicator,
                Node {
                    height: percent(100.0),
                    width: percent(value.clamp(0.0, 1.0) * 100.0),
                    border_radius: radius,
                    ..default()
                },
                BackgroundColor::default(),
                M3Paint::Background(Role::Primary, 1.0),
            )],
        )
    }

    /// Full-width divider (`md.comp.divider`: 1dp `outline-variant`).
    pub fn divider(&self) -> impl Bundle {
        (
            Node {
                height: px(self.theme.dp(comp::menu::DIVIDER_HEIGHT)),
                width: percent(100.0),
                flex_shrink: 0.0,
                ..default()
            },
            BackgroundColor::default(),
            M3Paint::Background(Role::OutlineVariant, 1.0),
        )
    }

    /// Navigation tab / rail destination (`md.comp.primary-navigation-tab`); add `Selected`
    /// on the active one.
    pub fn tab(&self, label: impl Into<String>, icon: Option<&str>) -> impl Bundle {
        use comp::primary_navigation_tab as t;
        let label: String = label.into();
        let access = a11y(accesskit::Role::Tab, &label);
        let text = self.label(label, TypeRole::TitleSmall);
        let glyph = icon.map(|name| self.icon(name, t::WITH_ICON_ICON_SIZE));
        let gap = self
            .theme
            .dp(comp::nav_bar_item_vertical::ACTIVE_INDICATOR_ICON_LABEL_SPACE);
        (
            M3Widget(Kind::Tabs),
            Node {
                height: px(self.theme.dp(t::CONTAINER_HEIGHT)),
                padding: UiRect::horizontal(px(self.theme.dp(comp::button_small::LEADING_SPACE))),
                column_gap: px(gap),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            access,
            Children::spawn(SpawnWith(move |p: &mut ChildSpawner| {
                if let Some(glyph) = glyph {
                    p.spawn(glyph);
                }
                p.spawn(text);
            })),
        )
    }

    /// Snackbar / toast surface with its message (inverse surface).
    pub fn snackbar(&self, message: impl Into<String>) -> impl Bundle {
        let gap = self.theme.dp(f32::from(self.theme.theme.density.gap()));
        (
            M3Surface(Kind::Snackbar),
            Node {
                min_height: px(self.theme.dp(comp::menu::LIST_ITEM_CONTAINER_HEIGHT)),
                padding: UiRect::horizontal(px(gap)),
                align_items: AlignItems::Center,
                ..default()
            },
            children![self.label(message, TypeRole::BodyMedium)],
        )
    }

    /// Small badge (count or status) in `error` / `on-error`.
    pub fn badge(&self, value: impl Into<String>) -> impl Bundle {
        (
            M3Surface(Kind::Badge),
            Node {
                min_width: px(self.theme.dp(BADGE_LARGE_SIZE_DP)),
                height: px(self.theme.dp(BADGE_LARGE_SIZE_DP)),
                padding: UiRect::horizontal(px(self.theme.dp(BADGE_LARGE_PADDING_DP))),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            children![self.label(value, TypeRole::LabelSmall)],
        )
    }
}
