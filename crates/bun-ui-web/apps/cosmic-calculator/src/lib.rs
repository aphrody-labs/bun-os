// SPDX-License-Identifier: Apache-2.0
//! COSMIC calculator: a libcosmic application (header bar, COSMIC dark theme, suggested/standard buttons) that runs
//! in the browser through bun-ui and natively on the desktop.

use cosmic::app::{Core, Settings, Task};
use cosmic::iced::{Alignment, Length, Size};
use cosmic::widget;
use cosmic::{Element, executor};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
}

impl Op {
    fn apply(self, a: f64, b: f64) -> f64 {
        match self {
            Op::Add => a + b,
            Op::Sub => a - b,
            Op::Mul => a * b,
            Op::Div => a / b,
        }
    }

    fn symbol(self) -> &'static str {
        match self {
            Op::Add => "+",
            Op::Sub => "−",
            Op::Mul => "×",
            Op::Div => "÷",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Digit(char),
    Op(Op),
    Equals,
    Clear,
    Negate,
    Percent,
}

pub struct Calculator {
    core: Core,
    entry: String,
    acc: Option<f64>,
    pending: Option<Op>,
    history: String,
    fresh: bool,
}

impl Calculator {
    fn value(&self) -> f64 {
        self.entry.parse().unwrap_or(0.0)
    }

    fn show(value: f64) -> String {
        if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e15 {
            format!("{value:.0}")
        } else if value.is_finite() {
            let text = format!("{value:.10}");
            text.trim_end_matches('0').trim_end_matches('.').to_owned()
        } else {
            "Error".into()
        }
    }

    fn reduce(&mut self) {
        let current = self.value();
        let result = match (self.acc, self.pending) {
            (Some(acc), Some(op)) => op.apply(acc, current),
            _ => current,
        };
        self.acc = Some(result);
        self.entry = Self::show(result);
    }

    fn key<'a>(&self, label: &'a str, message: Message, suggested: bool) -> Element<'a, Message> {
        let button = if suggested {
            widget::button::suggested(label)
        } else {
            widget::button::standard(label)
        };
        button.on_press(message).width(Length::Fill).height(Length::Fixed(52.0)).into()
    }
}

impl cosmic::Application for Calculator {
    type Executor = executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "com.aphrody.BunUi.CosmicCalculator";

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(core: Core, _flags: ()) -> (Self, Task<Message>) {
        let app = Calculator {
            core,
            entry: "0".into(),
            acc: None,
            pending: None,
            history: String::new(),
            fresh: true,
        };
        (app, Task::none())
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Digit(d) => {
                if self.fresh || self.entry == "0" {
                    self.entry = if d == '.' { "0.".into() } else { d.to_string() };
                    self.fresh = false;
                } else if d != '.' || !self.entry.contains('.') {
                    self.entry.push(d);
                }
            }
            Message::Op(op) => {
                if !self.fresh || self.acc.is_none() {
                    self.reduce();
                }
                self.pending = Some(op);
                self.history = format!("{} {}", self.entry, op.symbol());
                self.fresh = true;
            }
            Message::Equals => {
                if let Some(op) = self.pending {
                    self.history = format!("{} {} {} =", Self::show(self.acc.unwrap_or(0.0)), op.symbol(), self.entry);
                    self.reduce();
                    self.pending = None;
                    self.acc = None;
                    self.fresh = true;
                }
            }
            Message::Clear => {
                self.entry = "0".into();
                self.acc = None;
                self.pending = None;
                self.history.clear();
                self.fresh = true;
            }
            Message::Negate => self.entry = Self::show(-self.value()),
            Message::Percent => self.entry = Self::show(self.value() / 100.0),
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        let display = widget::column::with_capacity(2)
            .align_x(Alignment::End)
            .width(Length::Fill)
            .push(widget::text::caption(self.history.clone()))
            .push(widget::text::title1(self.entry.clone()));
        let rows: [[(&str, Message, bool); 4]; 5] = [
            [
                ("C", Message::Clear, false),
                ("±", Message::Negate, false),
                ("%", Message::Percent, false),
                ("÷", Message::Op(Op::Div), false),
            ],
            [
                ("7", Message::Digit('7'), false),
                ("8", Message::Digit('8'), false),
                ("9", Message::Digit('9'), false),
                ("×", Message::Op(Op::Mul), false),
            ],
            [
                ("4", Message::Digit('4'), false),
                ("5", Message::Digit('5'), false),
                ("6", Message::Digit('6'), false),
                ("−", Message::Op(Op::Sub), false),
            ],
            [
                ("1", Message::Digit('1'), false),
                ("2", Message::Digit('2'), false),
                ("3", Message::Digit('3'), false),
                ("+", Message::Op(Op::Add), false),
            ],
            [
                ("0", Message::Digit('0'), false),
                ("00", Message::Digit('0'), false),
                (".", Message::Digit('.'), false),
                ("=", Message::Equals, true),
            ],
        ];
        let mut keypad = widget::column::with_capacity(rows.len()).spacing(8);
        for row in rows {
            let mut line = widget::row::with_capacity(4).spacing(8);
            for (label, message, suggested) in row {
                line = line.push(self.key(label, message, suggested));
            }
            keypad = keypad.push(line);
        }
        widget::container(
            widget::column::with_capacity(2)
                .spacing(16)
                .max_width(420)
                .push(widget::container(display).padding(16).class(cosmic::theme::Container::Card))
                .push(keypad),
        )
        .padding(16)
        .center_x(Length::Fill)
        .into()
    }
}

pub fn run() -> cosmic::iced::Result {
    let settings = Settings::default().theme(cosmic::Theme::dark()).size(Size::new(420.0, 560.0));
    cosmic::app::run::<Calculator>(settings, ())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    if let Err(error) = run() {
        wasm_bindgen::throw_str(&format!("cosmic calculator stopped: {error}"));
    }
}
