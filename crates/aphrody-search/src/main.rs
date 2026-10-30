// SPDX-License-Identifier: Apache-2.0
//! Aphrody Search: a native COSMIC application (our libcosmic/iced forks) over the Bun OS search index
//! (`/api/search`: apps, packages, crates, documentation, factory, engines and tools, ranked by the server).
//! Results open with the session's default handler (xdg-open: the session browser for web pages).

use cosmic::app::{Core, Settings, Task};
use cosmic::iced::{Alignment, Length, Size};
use cosmic::widget::{self, scrollable};
use cosmic::{Element, executor};
use std::sync::LazyLock;

/// The input field takes the keyboard focus when the window opens.
static INPUT: LazyLock<widget::Id> = LazyLock::new(|| widget::Id::new("input"));
use serde::Deserialize;

const DEFAULT_ENDPOINT: &str = "https://aphrody.com/api/search";

#[derive(Clone, Debug, Deserialize)]
struct Hit {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Clone, Debug, Deserialize)]
struct Answer {
    organic: Vec<Hit>,
    total: usize,
}

#[derive(Clone, Debug)]
enum Message {
    Query(String),
    Search,
    Results(u64, Result<Answer, String>),
    Open(String),
}

struct App {
    core: Core,
    endpoint: String,
    query: String,
    seq: u64,
    busy: bool,
    answer: Option<Answer>,
    error: Option<String>,
}

async fn search(endpoint: String, query: String) -> Result<Answer, String> {
    let response = reqwest::Client::new()
        .get(&endpoint)
        .query(&[("query", query.as_str()), ("num", "20")])
        .send()
        .await
        .map_err(|e| format!("Cannot reach the search index: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Search answered {}", response.status()));
    }
    response.json::<Answer>().await.map_err(|e| format!("Unreadable search answer: {e}"))
}

impl cosmic::Application for App {
    type Executor = executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "com.aphrody.Search";

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(mut core: Core, _flags: ()) -> (Self, Task<Message>) {
        core.window.header_title = "Aphrody Search".into();
        let app = App {
            core,
            endpoint: std::env::var("APHRODY_SEARCH_URL").unwrap_or_else(|_| DEFAULT_ENDPOINT.into()),
            query: std::env::args().nth(1).unwrap_or_default(),
            seq: 0,
            busy: false,
            answer: None,
            error: None,
        };
        let focus = widget::text_input::focus(INPUT.clone());
        let task = if app.query.is_empty() { focus } else { Task::batch([focus, Task::done(cosmic::Action::App(Message::Search))]) };
        (app, task)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Query(q) => self.query = q,
            Message::Search => {
                let query = self.query.trim().to_owned();
                if query.is_empty() {
                    return Task::none();
                }
                self.seq += 1;
                self.busy = true;
                let seq = self.seq;
                return Task::perform(search(self.endpoint.clone(), query), move |r| {
                    cosmic::Action::App(Message::Results(seq, r))
                });
            }
            Message::Results(seq, result) if seq == self.seq => {
                self.busy = false;
                match result {
                    Ok(answer) => {
                        self.answer = Some(answer);
                        self.error = None;
                    }
                    Err(e) => self.error = Some(e),
                }
            }
            Message::Results(..) => {}
            Message::Open(url) => {
                if let Err(e) = std::process::Command::new("xdg-open").arg(&url).spawn() {
                    self.error = Some(format!("Cannot open {url}: {e}"));
                }
            }
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        let field = widget::search_input("Search apps, packages, crates, docs and tools", &self.query)
            .id(INPUT.clone())
            .on_input(Message::Query)
            .on_submit(|_| Message::Search)
            .width(Length::Fill);
        let bar = widget::row::with_capacity(2)
            .spacing(8)
            .align_y(Alignment::Center)
            .push(field)
            .push(widget::button::suggested("Search").on_press(Message::Search));
        let mut list = widget::column::with_capacity(24).spacing(6);
        let status = if self.busy {
            "Searching…".to_owned()
        } else if let Some(error) = &self.error {
            error.clone()
        } else if let Some(answer) = &self.answer {
            format!("{} result{}", answer.total, if answer.total == 1 { "" } else { "s" })
        } else {
            "Search everything Bun OS serves.".to_owned()
        };
        if let Some(answer) = &self.answer {
            for hit in &answer.organic {
                let card = widget::column::with_capacity(3)
                    .spacing(2)
                    .push(widget::text::title4(hit.title.clone()))
                    .push(widget::text::caption(hit.url.clone()))
                    .push(widget::text::body(hit.snippet.clone()));
                list = list.push(
                    widget::button::custom(widget::container(card).padding(8).width(Length::Fill))
                        .class(cosmic::theme::Button::MenuItem)
                        .width(Length::Fill)
                        .on_press(Message::Open(hit.url.clone())),
                );
            }
        }
        widget::column::with_capacity(3)
            .spacing(12)
            .padding(16)
            .push(bar)
            .push(widget::text::caption(status))
            .push(scrollable(list).height(Length::Fill))
            .into()
    }
}

fn main() -> cosmic::iced::Result {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let settings = Settings::default().size(Size::new(760.0, 620.0));
    cosmic::app::run::<App>(settings, ())
}
