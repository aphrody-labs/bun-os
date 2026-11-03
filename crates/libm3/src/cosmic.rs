// SPDX-License-Identifier: Apache-2.0
//! COSMIC widgets with Material semantic roles. GUI state and the event loop stay with the host.
use crate::{
    Color, Component, ComponentStyle, Interaction, Role, Theme, ThemeMode,
    layout::{ApplicationLayout, Navigation, Panes},
    tokens::{ShapeRole, TypeRole},
};
use ::cosmic::{
    Element,
    iced::{self, Background, Border, Length, Shadow, Vector},
    widget,
};
use std::{boxed::Box, string::String, sync::Arc, vec::Vec};

pub use ::cosmic as toolkit;

/// Apply one native theme scope to content and overlays without copying widget algorithms.
pub fn themed<'a, Message: 'a>(
    material: Theme,
    content: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    let content: Element<'a, Message> = content.into();
    iced::widget::themer(Some(self::theme(material)), content).into()
}

/// The Bun OS product theme in the mode and contrast of the COSMIC system preference
/// (`cosmic-config` theme mode and the high-contrast accessibility setting).
pub fn system_theme() -> Theme {
    let system = ::cosmic::theme::system_preference();
    let native = system.cosmic();
    Theme::aphrody(
        native.is_dark,
        crate::Contrast::from_high_contrast(native.is_high_contrast),
    )
}

pub fn color(color: Color) -> iced::Color {
    let [r, g, b, a] = color.rgba();
    iced::Color::from_rgba8(r, g, b, f32::from(a) / 255.0)
}

fn palette_color(color: Color) -> ::cosmic::cosmic_theme::palette::Srgba {
    let [r, g, b, a] = color.rgba();
    ::cosmic::cosmic_theme::palette::Srgba::new(
        f32::from(r) / 255.0,
        f32::from(g) / 255.0,
        f32::from(b) / 255.0,
        f32::from(a) / 255.0,
    )
}

fn native_component(theme: Theme, component: Component) -> ::cosmic::theme::CosmicComponent {
    let rest = component.style(theme, Interaction::Rest);
    let disabled = component.style(theme, Interaction::Disabled);
    let selected = component.style(theme, Interaction::Selected);
    ::cosmic::theme::CosmicComponent {
        base: palette_color(rest.background),
        on: palette_color(rest.foreground),
        hover: palette_color(component.style(theme, Interaction::Hovered).background),
        pressed: palette_color(component.style(theme, Interaction::Pressed).background),
        focus: palette_color(theme.colors.get(Role::Primary)),
        selected: palette_color(selected.background),
        selected_text: palette_color(selected.foreground),
        disabled: palette_color(disabled.background),
        on_disabled: palette_color(disabled.foreground),
        divider: palette_color(theme.colors.get(Role::OutlineVariant)),
        border: palette_color(rest.border),
        disabled_border: palette_color(disabled.border),
    }
}

/// Translate roles into a custom theme without reading system configuration or changing it.
/// COSMIC derives its private surface containers; libm3 surface widgets use exact M3 colours.
pub fn theme(theme: Theme) -> ::cosmic::Theme {
    use ::cosmic::cosmic_theme::ThemeBuilder;
    let mut builder = match theme.mode {
        ThemeMode::Light => ThemeBuilder::light(),
        ThemeMode::Dark => ThemeBuilder::dark(),
    };
    builder.accent = Some(palette_color(theme.colors.get(Role::Primary)).color);
    builder.bg_color = Some(palette_color(theme.colors.get(Role::Surface)));
    builder.primary_container_bg = Some(palette_color(theme.colors.get(Role::SurfaceContainer)));
    builder.secondary_container_bg =
        Some(palette_color(theme.colors.get(Role::SurfaceContainerHigh)));
    builder.destructive = Some(palette_color(theme.colors.get(Role::Error)).color);
    builder.corner_radii = ::cosmic::cosmic_theme::CornerRadii {
        radius_0: [f32::from(theme.shapes.get(ShapeRole::None)); 4],
        radius_xs: [f32::from(theme.shapes.get(ShapeRole::ExtraSmall)); 4],
        radius_s: [f32::from(theme.shapes.get(ShapeRole::Small)); 4],
        radius_m: [f32::from(theme.shapes.get(ShapeRole::Medium)); 4],
        radius_l: [f32::from(theme.shapes.get(ShapeRole::Large)); 4],
        radius_xl: [f32::from(theme.shapes.get(ShapeRole::ExtraLarge)); 4],
    };
    let mut native = builder.build();
    native.name = String::from("Bun OS Material 3");
    native.button = native_component(theme, Component::TonalButton);
    native.accent = native_component(theme, Component::FilledButton);
    native.accent_button = native_component(theme, Component::FilledButton);
    native.destructive = native_component(theme, Component::DestructiveButton);
    native.destructive_button = native_component(theme, Component::DestructiveButton);
    native.text_button = native_component(theme, Component::TextButton);
    native.list_button = native_component(theme, Component::ListItem);
    ::cosmic::Theme::custom(Arc::new(native))
}

pub fn text<'a, Message: 'a>(
    theme: Theme,
    content: &'a str,
    role: TypeRole,
) -> Element<'a, Message> {
    let style = theme.typography.get(role);
    let weight = match style.weight {
        0..=149 => iced::font::Weight::Thin,
        150..=249 => iced::font::Weight::ExtraLight,
        250..=349 => iced::font::Weight::Light,
        350..=449 => iced::font::Weight::Normal,
        450..=549 => iced::font::Weight::Medium,
        550..=649 => iced::font::Weight::Semibold,
        650..=749 => iced::font::Weight::Bold,
        750..=849 => iced::font::Weight::ExtraBold,
        _ => iced::font::Weight::Black,
    };
    widget::text(content)
        .size(style.size)
        .line_height(iced::widget::text::LineHeight::Absolute(
            style.line_height.into(),
        ))
        .font(iced::Font {
            family: iced::font::Family::Name(style.family),
            weight,
            ..iced::Font::DEFAULT
        })
        .class(::cosmic::theme::Text::Default)
        .into()
}

fn button_style(style: ComponentStyle, focused: bool, theme: Theme) -> widget::button::Style {
    widget::button::Style {
        background: Some(Background::Color(color(style.background))),
        overlay: None,
        shadow_offset: Vector::new(0.0, f32::from(style.elevation_dp)),
        border_radius: f32::from(style.corner_radius).into(),
        border_width: if style.border == Color::TRANSPARENT {
            0.0
        } else {
            1.0
        },
        border_color: color(style.border),
        outline_width: if focused {
            m3_tokens::component::focus_indicator::THICKNESS
        } else {
            0.0
        },
        outline_color: color(theme.colors.get(Role::Primary)),
        text_color: Some(color(style.foreground)),
        icon_color: Some(color(style.foreground)),
    }
}

/// on_press=None produces a disabled button; focus, press and hover use M3 state layers.
pub fn button<'a, Message: Clone + 'static>(
    theme: Theme,
    component: Component,
    label: &'a str,
    on_press: Option<Message>,
) -> Element<'a, Message> {
    let type_style = theme.typography.get(TypeRole::LabelLarge);
    widget::button::standard(label)
        .on_press_maybe(on_press)
        .height(f32::from(theme.density.target_height()))
        .font_size(type_style.size as u16)
        .line_height(type_style.line_height as u16)
        .class(::cosmic::theme::Button::Custom {
            active: Box::new(move |focused, _| {
                button_style(
                    component.style(
                        theme,
                        if focused {
                            Interaction::Focused
                        } else {
                            Interaction::Rest
                        },
                    ),
                    focused,
                    theme,
                )
            }),
            hovered: Box::new(move |focused, _| {
                button_style(component.style(theme, Interaction::Hovered), focused, theme)
            }),
            pressed: Box::new(move |focused, _| {
                button_style(component.style(theme, Interaction::Pressed), focused, theme)
            }),
            disabled: Box::new(move |_| {
                button_style(component.style(theme, Interaction::Disabled), false, theme)
            }),
        })
        .into()
}

/// Cards, sheets, menus, dialogs and app bars retain exact semantic foreground/background roles.
pub fn surface<'a, Message: 'a>(
    theme: Theme,
    component: Component,
    content: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    let style = component.style(theme, Interaction::Rest);
    // The ambient elevation layer on the shadow role (`md.sys.elevation` ambient alpha).
    let shadow = color(
        theme
            .colors
            .get(Role::Shadow)
            .with_opacity(m3_tokens::elevation::AMBIENT_ALPHA),
    );
    widget::container(content)
        .padding(f32::from(theme.density.gap()))
        .class(::cosmic::theme::Container::Custom(Box::new(move |_| {
            iced::widget::container::Style {
                background: Some(Background::Color(color(style.background))),
                text_color: Some(color(style.foreground)),
                icon_color: Some(color(style.foreground)),
                border: Border {
                    color: color(style.border),
                    width: if style.border == Color::TRANSPARENT {
                        0.0
                    } else {
                        1.0
                    },
                    radius: f32::from(style.corner_radius).into(),
                },
                shadow: Shadow {
                    color: shadow,
                    offset: Vector::new(0.0, f32::from(style.elevation_dp)),
                    blur_radius: f32::from(style.elevation_dp) * 2.0,
                },
                ..Default::default()
            }
        })))
        .into()
}

pub fn checkbox<'a, Message: 'a>(
    theme: Theme,
    label: &'a str,
    checked: bool,
    on_toggle: impl Fn(bool) -> Message + 'a,
) -> Element<'a, Message> {
    themed(
        theme,
        widget::checkbox(checked).label(label).on_toggle(on_toggle),
    )
}

pub fn switch<'a, Message: 'static>(
    theme: Theme,
    label: &'a str,
    checked: bool,
    on_toggle: impl Fn(bool) -> Message + 'a,
) -> Element<'a, Message> {
    themed(
        theme,
        widget::toggler(checked)
            .label(Some(String::from(label)))
            .on_toggle(on_toggle),
    )
}

pub fn slider<'a, Message: Clone + 'a>(
    theme: Theme,
    range: core::ops::RangeInclusive<f32>,
    value: f32,
    on_change: impl Fn(f32) -> Message + 'a,
) -> Element<'a, Message> {
    themed(theme, widget::slider(range, value, on_change))
}

/// The host owns validation, persistence and focus; the widget emits every changed value.
pub fn text_field<'a, Message: Clone + 'static>(
    theme: Theme,
    placeholder: &'a str,
    value: &'a str,
    on_change: impl Fn(String) -> Message + 'a,
) -> Element<'a, Message> {
    themed(
        theme,
        widget::text_input(placeholder, value).on_input(on_change),
    )
}

pub struct NavigationItem<'a, Message> {
    pub label: &'a str,
    pub selected: bool,
    pub activate: Message,
}

pub struct ApplicationView<'a, Message> {
    pub title: &'a str,
    pub navigation: Vec<NavigationItem<'a, Message>>,
    pub toolbar: Option<Element<'a, Message>>,
    pub content: Element<'a, Message>,
    pub supporting: Option<Element<'a, Message>>,
}

/// Compose every application family using its adaptive navigation and pane rules.
/// A compact supporting pane belongs to the host's selected route, preserving user state.
pub fn application<'a, Message: Clone + 'static>(
    theme: Theme,
    layout: ApplicationLayout,
    view: ApplicationView<'a, Message>,
) -> Element<'a, Message> {
    let ApplicationView {
        title,
        navigation,
        toolbar,
        content,
        supporting,
    } = view;
    let gap = theme.density.gap();
    let nav: Vec<Element<'a, Message>> = navigation
        .into_iter()
        .map(|item| {
            button(
                theme,
                if item.selected {
                    Component::TonalButton
                } else {
                    Component::TextButton
                },
                item.label,
                Some(item.activate),
            )
        })
        .collect();
    let mut nav = Some(nav);
    let content = if layout.scroll_content {
        widget::scrollable(content).into()
    } else {
        content
    };
    let mut main = widget::column(Vec::<Element<'a, Message>>::new())
        .spacing(gap)
        .width(Length::Fill);
    if !layout.edge_to_edge {
        main = main.push(surface(
            theme,
            Component::TopAppBar,
            text(theme, title, TypeRole::TitleLarge),
        ));
    }
    if layout.toolbar {
        if let Some(toolbar) = toolbar {
            main = main.push(surface(theme, Component::Toolbar, toolbar));
        }
    }
    let mut panes = widget::row(Vec::<Element<'a, Message>>::new())
        .spacing(gap)
        .width(Length::Fill);
    if !matches!(layout.navigation, Navigation::None | Navigation::Bar) {
        let nav_width = if matches!(layout.navigation, Navigation::RailCollapsed) {
            96.0
        } else {
            240.0
        };
        let component = if matches!(
            layout.navigation,
            Navigation::RailCollapsed | Navigation::RailExpanded
        ) {
            Component::NavigationRail
        } else {
            Component::NavigationDrawer
        };
        panes = panes.push(
            widget::container(surface(
                theme,
                component,
                widget::column(nav.take().unwrap_or_default()).spacing(gap),
            ))
            .width(nav_width),
        );
    }
    panes = panes.push(
        widget::container(content)
            .width(Length::Fill)
            .height(Length::Fill),
    );
    if !matches!(layout.panes, Panes::Single) {
        if let Some(supporting) = supporting {
            panes = panes.push(
                widget::container(surface(theme, Component::SideSheet, supporting)).width(320.0),
            );
        }
    }
    main = main.push(panes.height(Length::Fill));
    if matches!(layout.navigation, Navigation::Bar) {
        main = main.push(surface(
            theme,
            Component::NavigationBar,
            widget::row(nav.take().unwrap_or_default()).spacing(gap),
        ));
    }
    if layout.edge_to_edge {
        themed(theme, main)
    } else {
        themed(theme, surface(theme, Component::NavigationDrawer, main))
    }
}
