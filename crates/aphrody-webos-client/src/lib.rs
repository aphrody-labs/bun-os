// SPDX-License-Identifier: Apache-2.0
//! aphrody.com client (docs/webos/ARCHITECTURE.md, ADR-003): an iced application themed with our libcosmic fork,
//! compiled to wasm32 with the wgpu backend (WebGPU, WebGL2 fallback). It shows the one Bun OS desktop (ADR-003): it
//! checks `GET /api/session`, starts the session with `POST /api/sessions`, shows its stream full window and sends
//! keyboard, pointer, wheel, clipboard, resize and gamepad input back. Every message is a type of
//! `aphrody-webos-protocol`. The browser is used only as transport (`web.rs`: fetch, WebSocket, Gamepad API); all UI is iced/libcosmic.

mod input;
#[cfg(target_arch = "wasm32")]
mod web;

use aphrody_webos_protocol::{Input, ServerEvent, SessionAvailability, SessionInfo, StartSession};
use cosmic::app::{Core, Settings, Task};
use cosmic::iced::{
    Alignment, Length, Size, Subscription, futures::channel::mpsc::UnboundedSender,
};
use cosmic::widget::{self, image};
use cosmic::{Element, executor};

/// What the stream transport reports to the application.
#[derive(Clone, Debug)]
pub enum StreamEvent {
    /// The socket is open; input goes through this sender.
    Ready(UnboundedSender<Input>),
    /// A decoded frame (RGBA) ready for the image widget.
    Frame(image::Handle, u32, u32),
    Server(ServerEvent),
    Closed(String),
}

#[derive(Clone, Debug)]
pub enum Message {
    Availability(Result<SessionAvailability, String>),
    Start,
    Started(Result<SessionInfo, String>),
    Stream(StreamEvent),
    Input(Input),
    WindowResized(Size),
    Back,
}

enum Screen {
    Loading,
    Starting,
    Streaming(SessionInfo),
    Failed(String),
}

pub struct App {
    core: Core,
    screen: Screen,
    window: Size,
    frame: Option<(image::Handle, u32, u32)>,
    sender: Option<UnboundedSender<Input>>,
    pointer: input::Pointer,
}

impl App {
    fn send(&self, input: Input) {
        if let Some(sender) = &self.sender {
            let _ = sender.unbounded_send(input);
        }
    }

    fn message_screen(&self, text: String, back: bool) -> Element<'_, Message> {
        let mut column = widget::column::with_capacity(2)
            .spacing(16)
            .align_x(Alignment::Center)
            .push(widget::text::body(text));
        if back {
            column = column.push(widget::button::standard("Reconnect").on_press(Message::Back));
        }
        widget::container(column)
            .center_x(Length::Fill)
            .center_y(Length::Fill)
            .into()
    }
}

impl cosmic::Application for App {
    type Executor = executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "com.aphrody.WebOS";

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(mut core: Core, _flags: ()) -> (Self, Task<Message>) {
        core.window.show_headerbar = false;
        let app = App {
            core,
            screen: Screen::Loading,
            window: Size::new(1280.0, 720.0),
            frame: None,
            sender: None,
            pointer: input::Pointer::default(),
        };
        #[cfg(target_arch = "wasm32")]
        let task = Task::perform(web::availability(), |r| {
            cosmic::Action::App(Message::Availability(r))
        });
        #[cfg(not(target_arch = "wasm32"))]
        let task = Task::none();
        (app, task)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Availability(Ok(availability)) if availability.available => {
                return cosmic::Application::update(self, Message::Start);
            }
            Message::Availability(Ok(availability)) => {
                self.screen = Screen::Failed(
                    availability
                        .reason
                        .unwrap_or_else(|| "The Bun OS desktop is not available.".into()),
                );
            }
            Message::Availability(Err(error)) => {
                self.screen = Screen::Failed(format!("aphrody.com is unreachable: {error}"));
            }
            Message::Start => {
                self.screen = Screen::Starting;
                let request = StartSession {
                    width: self.window.width as u32,
                    height: self.window.height as u32,
                };
                #[cfg(target_arch = "wasm32")]
                return Task::perform(web::start(request), |r| {
                    cosmic::Action::App(Message::Started(r))
                });
                #[cfg(not(target_arch = "wasm32"))]
                drop(request);
            }
            Message::Started(Ok(session)) => self.screen = Screen::Streaming(session),
            Message::Started(Err(error)) => {
                self.screen = Screen::Failed(format!("The session could not start: {error}"))
            }
            Message::Stream(StreamEvent::Ready(sender)) => {
                let _ = sender.unbounded_send(Input::Resize {
                    width: self.window.width as u32,
                    height: self.window.height as u32,
                });
                self.sender = Some(sender);
            }
            Message::Stream(StreamEvent::Frame(handle, width, height)) => {
                self.frame = Some((handle, width, height))
            }
            Message::Stream(StreamEvent::Server(ServerEvent::Error { message })) => {
                self.screen = Screen::Failed(format!("Session error: {message}"));
            }
            Message::Stream(StreamEvent::Server(ServerEvent::Clipboard { text })) => {
                #[cfg(target_arch = "wasm32")]
                web::write_clipboard(&text);
                #[cfg(not(target_arch = "wasm32"))]
                drop(text);
            }
            Message::Stream(StreamEvent::Server(_)) => {}
            Message::Stream(StreamEvent::Closed(reason)) => {
                self.sender = None;
                self.frame = None;
                self.screen = Screen::Failed(format!("The session stream closed: {reason}"));
            }
            Message::Input(input) => {
                let input = match input {
                    Input::Pointer { x, y, buttons } => {
                        let (x, y) = self.pointer.to_stream(
                            x,
                            y,
                            self.window,
                            self.frame.as_ref().map(|f| (f.1, f.2)),
                        );
                        Input::Pointer { x, y, buttons }
                    }
                    other => other,
                };
                if matches!(self.screen, Screen::Streaming(_)) {
                    self.send(input);
                }
            }
            Message::WindowResized(size) => {
                self.window = size;
                self.send(Input::Resize {
                    width: size.width as u32,
                    height: size.height as u32,
                });
            }
            Message::Back => {
                self.sender = None;
                self.frame = None;
                self.screen = Screen::Loading;
                #[cfg(target_arch = "wasm32")]
                return Task::perform(web::availability(), |r| {
                    cosmic::Action::App(Message::Availability(r))
                });
            }
        }
        Task::none()
    }

    fn subscription(&self) -> Subscription<Message> {
        let mut subscriptions = vec![input::events()];
        #[cfg(target_arch = "wasm32")]
        if let Screen::Streaming(session) = &self.screen {
            subscriptions.push(web::stream(session.clone()).map(Message::Stream));
            subscriptions.push(web::gamepads().map(Message::Input));
        }
        Subscription::batch(subscriptions)
    }

    fn view(&self) -> Element<'_, Message> {
        match &self.screen {
            Screen::Loading => self.message_screen("Loading Bun OS...".into(), false),
            Screen::Starting => {
                self.message_screen("Starting your Bun OS desktop...".into(), false)
            }
            Screen::Failed(text) => self.message_screen(text.clone(), true),
            Screen::Streaming(_) => match &self.frame {
                Some((handle, _, _)) => widget::container(
                    image(handle.clone())
                        .content_fit(cosmic::iced::ContentFit::Contain)
                        .width(Length::Fill)
                        .height(Length::Fill),
                )
                .center_x(Length::Fill)
                .center_y(Length::Fill)
                .into(),
                None => self.message_screen("Connecting to your Bun OS desktop...".into(), false),
            },
        }
    }
}

/// Runs the client (the wasm entry point and the native in-session build share it).
pub fn run() -> cosmic::iced::Result {
    let settings = Settings::default()
        .theme(cosmic::Theme::dark())
        .client_decorations(false)
        .size(Size::new(1280.0, 720.0));
    cosmic::app::run::<App>(settings, ())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    if let Err(error) = run() {
        web::log_error(&format!("aphrody.com client stopped: {error}"));
    }
}
