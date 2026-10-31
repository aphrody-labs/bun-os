// SPDX-License-Identifier: Apache-2.0
//! Aphrody Chat: a native COSMIC application (our libcosmic/iced forks) talking to the Bun OS inference gateway
//! (`/api/chat/v1`, OpenAI-compatible chat completions with server-sent events, served by Vertex AI Gemini).
//! Answers stream token by token; backend errors are shown as they are, there is no canned reply.

use cosmic::app::{Core, Settings, Task};
use cosmic::iced::futures::{SinkExt, StreamExt};
use cosmic::iced::{Alignment, Length, Size};
use cosmic::widget::{self, scrollable};
use cosmic::{Element, executor};
use std::sync::LazyLock;

/// The input field takes the keyboard focus when the window opens.
static INPUT: LazyLock<widget::Id> = LazyLock::new(|| widget::Id::new("input"));
use serde::{Deserialize, Serialize};

const DEFAULT_ENDPOINT: &str = "https://aphrody.com/api/chat/v1";
const SYSTEM_PROMPT: &str = "You are Aphrody Chat, the assistant of Bun OS. Answer clearly and concisely.";

#[derive(Clone, Debug, Serialize)]
struct Turn {
    role: &'static str,
    content: String,
}

#[derive(Clone, Debug)]
enum Delta {
    Text(String),
    Done,
    Failed(String),
}

#[derive(Clone, Debug)]
enum Message {
    Draft(String),
    Send,
    Delta(Delta),
    Clear,
}

struct App {
    core: Core,
    endpoint: String,
    model: String,
    turns: Vec<Turn>,
    draft: String,
    busy: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Chunk {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    delta: Option<ChunkDelta>,
}
#[derive(Deserialize)]
struct ChunkDelta {
    content: Option<String>,
}

/// POST the conversation and turn the SSE body into deltas.
fn ask(endpoint: String, model: String, turns: Vec<Turn>) -> impl cosmic::iced::futures::Stream<Item = Delta> {
    cosmic::iced::stream::channel(64, move |mut out: cosmic::iced::futures::channel::mpsc::Sender<Delta>| async move {
        let mut messages = vec![Turn { role: "system", content: SYSTEM_PROMPT.into() }];
        messages.extend(turns);
        let body = serde_json::json!({ "model": model, "stream": true, "messages": messages });
        let client = reqwest::Client::new();
        let response = match client.post(format!("{endpoint}/chat/completions")).json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = out.send(Delta::Failed(format!("Cannot reach the model backend: {e}"))).await;
                return;
            }
        };
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
                .unwrap_or(text);
            let _ = out.send(Delta::Failed(format!("Model backend answered {status}: {message}"))).await;
            return;
        }
        let mut bytes = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(part) = bytes.next().await {
            let part = match part {
                Ok(p) => p,
                Err(e) => {
                    let _ = out.send(Delta::Failed(format!("Stream interrupted: {e}"))).await;
                    return;
                }
            };
            buffer.push_str(&String::from_utf8_lossy(&part));
            while let Some(end) = buffer.find("\n\n") {
                let event: String = buffer.drain(..end + 2).collect();
                for line in event.lines() {
                    let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
                    if data == "[DONE]" {
                        let _ = out.send(Delta::Done).await;
                        return;
                    }
                    if let Ok(chunk) = serde_json::from_str::<Chunk>(data) {
                        for choice in chunk.choices {
                            if let Some(text) = choice.delta.and_then(|d| d.content).filter(|t| !t.is_empty()) {
                                let _ = out.send(Delta::Text(text)).await;
                            }
                        }
                    }
                }
            }
        }
        let _ = out.send(Delta::Done).await;
    })
}

impl cosmic::Application for App {
    type Executor = executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "com.aphrody.Chat";

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(mut core: Core, _flags: ()) -> (Self, Task<Message>) {
        core.window.header_title = "Aphrody Chat".into();
        let app = App {
            core,
            endpoint: std::env::var("APHRODY_CHAT_URL").unwrap_or_else(|_| DEFAULT_ENDPOINT.into()),
            model: std::env::var("APHRODY_CHAT_MODEL").unwrap_or_else(|_| "google/gemini-2.5-flash".into()),
            turns: Vec::new(),
            draft: String::new(),
            busy: false,
            error: None,
        };
        (app, widget::text_input::focus(INPUT.clone()))
    }

    fn header_end(&self) -> Vec<Element<'_, Message>> {
        vec![widget::button::text("New chat").on_press(Message::Clear).into()]
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Draft(text) => self.draft = text,
            Message::Clear if !self.busy => {
                self.turns.clear();
                self.error = None;
            }
            Message::Clear => {}
            Message::Send => {
                let text = self.draft.trim().to_owned();
                if text.is_empty() || self.busy {
                    return Task::none();
                }
                self.draft.clear();
                self.error = None;
                self.turns.push(Turn { role: "user", content: text });
                let history = self.turns.clone();
                self.turns.push(Turn { role: "assistant", content: String::new() });
                self.busy = true;
                return Task::run(ask(self.endpoint.clone(), self.model.clone(), history), |d| {
                    cosmic::Action::App(Message::Delta(d))
                });
            }
            Message::Delta(Delta::Text(text)) => {
                if let Some(last) = self.turns.last_mut() {
                    last.content.push_str(&text);
                }
            }
            Message::Delta(Delta::Done) => {
                self.busy = false;
                if self.turns.last().is_some_and(|t| t.role == "assistant" && t.content.is_empty()) {
                    self.turns.pop();
                }
            }
            Message::Delta(Delta::Failed(error)) => {
                self.busy = false;
                if self.turns.last().is_some_and(|t| t.role == "assistant" && t.content.is_empty()) {
                    self.turns.pop();
                }
                self.error = Some(error);
            }
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        let mut log = widget::column::with_capacity(self.turns.len() + 1).spacing(12).padding(16);
        if self.turns.is_empty() {
            log = log.push(widget::text::title3("Ask Aphrody anything."));
        }
        for turn in &self.turns {
            let user = turn.role == "user";
            let content = if turn.content.is_empty() { "…".to_owned() } else { turn.content.clone() };
            let bubble = widget::container(widget::text::body(content))
                .padding(12)
                .max_width(640)
                .class(if user { cosmic::theme::Container::Primary } else { cosmic::theme::Container::Card });
            let row = widget::row::with_capacity(1).width(Length::Fill).push(bubble);
            log = log.push(
                widget::container(row)
                    .width(Length::Fill)
                    .align_x(if user { Alignment::End } else { Alignment::Start }),
            );
        }
        if let Some(error) = &self.error {
            log = log.push(widget::text::body(error.clone()).class(cosmic::theme::Text::Accent));
        }
        let input = widget::text_input("Message Aphrody Chat", &self.draft)
            .id(INPUT.clone())
            .on_input(Message::Draft)
            .on_submit(|_| Message::Send)
            .width(Length::Fill);
        let send = widget::button::suggested("Send").on_press_maybe((!self.busy).then_some(Message::Send));
        widget::column::with_capacity(2)
            .push(scrollable(log).height(Length::Fill).anchor_bottom())
            .push(widget::row::with_capacity(2).spacing(8).padding(12).align_y(Alignment::Center).push(input).push(send))
            .into()
    }
}

fn main() -> cosmic::iced::Result {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let settings = Settings::default().size(Size::new(720.0, 640.0));
    cosmic::app::run::<App>(settings, ())
}
