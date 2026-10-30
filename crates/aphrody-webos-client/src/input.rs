// SPDX-License-Identifier: Apache-2.0
//! iced window events to protocol [`Input`]: keyboard (DOM-style `code` and `key`), pointer with the button mask,
//! wheel and window resize. Pointer positions are window coordinates here; [`Pointer::to_stream`] maps them into
//! stream pixels using the contain-fit of the frame.

use std::sync::atomic::{AtomicU8, Ordering};

use aphrody_webos_protocol::Input;
use cosmic::iced::{
    Event, Size, Subscription, event,
    keyboard::{self, key::Physical},
    mouse, window,
};

use crate::Message;

/// Mouse buttons held, in the DOM `buttons` bit layout (1 left, 2 right, 4 middle, 8 back, 16 forward).
static BUTTONS: AtomicU8 = AtomicU8::new(0);
/// Last cursor position in window coordinates (bits of two f32 packed into the message on each event).
static LAST: std::sync::Mutex<(f32, f32)> = std::sync::Mutex::new((0.0, 0.0));

fn bit(button: mouse::Button) -> u8 {
    match button {
        mouse::Button::Left => 1,
        mouse::Button::Right => 2,
        mouse::Button::Middle => 4,
        mouse::Button::Back => 8,
        mouse::Button::Forward => 16,
        mouse::Button::Other(_) => 0,
    }
}

fn pointer() -> Input {
    let (x, y) = *LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    Input::Pointer { x, y, buttons: BUTTONS.load(Ordering::Relaxed) }
}

fn map(event: Event, _status: event::Status, _window: window::Id) -> Option<Message> {
    match event {
        Event::Keyboard(keyboard::Event::KeyPressed { key, physical_key, .. }) => Some(Message::Input(Input::Key {
            code: code(&physical_key),
            key: logical(&key),
            down: true,
        })),
        Event::Keyboard(keyboard::Event::KeyReleased { key, physical_key, .. }) => Some(Message::Input(Input::Key {
            code: code(&physical_key),
            key: logical(&key),
            down: false,
        })),
        Event::Mouse(mouse::Event::CursorMoved { position }) => {
            *LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = (position.x, position.y);
            Some(Message::Input(pointer()))
        }
        Event::Mouse(mouse::Event::ButtonPressed(button)) => {
            BUTTONS.fetch_or(bit(button), Ordering::Relaxed);
            Some(Message::Input(pointer()))
        }
        Event::Mouse(mouse::Event::ButtonReleased(button)) => {
            BUTTONS.fetch_and(!bit(button), Ordering::Relaxed);
            Some(Message::Input(pointer()))
        }
        Event::Mouse(mouse::Event::WheelScrolled { delta }) => {
            let (dx, dy) = match delta {
                mouse::ScrollDelta::Lines { x, y } => (-x * 40.0, -y * 40.0),
                mouse::ScrollDelta::Pixels { x, y } => (-x, -y),
            };
            Some(Message::Input(Input::Wheel { dx, dy }))
        }
        Event::Window(window::Event::Resized(size)) => Some(Message::WindowResized(size)),
        _ => None,
    }
}

/// DOM `KeyboardEvent.code` names: winit's `KeyCode` variants use the same names (`KeyA`, `Enter`, `ArrowLeft`).
fn code(physical: &Physical) -> String {
    match physical {
        Physical::Code(code) => format!("{code:?}"),
        Physical::Unidentified(_) => "Unidentified".into(),
    }
}

/// DOM `KeyboardEvent.key`: the produced character, or the named key (`Enter`, `Shift`, `ArrowLeft`).
fn logical(key: &keyboard::Key) -> String {
    match key {
        keyboard::Key::Character(text) => text.to_string(),
        keyboard::Key::Named(named) => format!("{named:?}"),
        keyboard::Key::Unidentified => "Unidentified".into(),
    }
}

pub fn events() -> Subscription<Message> {
    event::listen_with(map)
}

#[derive(Default)]
pub struct Pointer;

impl Pointer {
    /// Window coordinates to stream pixels for a frame drawn with contain-fit and centered.
    pub fn to_stream(&self, x: f32, y: f32, window: Size, frame: Option<(u32, u32)>) -> (f32, f32) {
        let Some((fw, fh)) = frame else { return (x, y) };
        let (fw, fh) = (fw as f32, fh as f32);
        if fw <= 0.0 || fh <= 0.0 || window.width <= 0.0 || window.height <= 0.0 {
            return (x, y);
        }
        let scale = (window.width / fw).min(window.height / fh);
        let ox = (window.width - fw * scale) / 2.0;
        let oy = (window.height - fh * scale) / 2.0;
        (((x - ox) / scale).clamp(0.0, fw - 1.0), ((y - oy) / scale).clamp(0.0, fh - 1.0))
    }
}
