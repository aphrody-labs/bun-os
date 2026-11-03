// SPDX-License-Identifier: Apache-2.0
//! The guided installer, archinstall-style: a ratatui screen to pick the target, level and modules, then preview
//! the plan and choose to apply. It never applies without an explicit confirmation, and delegates every change to
//! the WinClean engine through the shared runner.

#[cfg(windows)]
pub use imp::run;

#[cfg(not(windows))]
pub fn run() -> anyhow::Result<()> {
    anyhow::bail!("the guided installer runs on Windows; use --config for the non-interactive path")
}

#[cfg(windows)]
mod imp {
    use std::io;

    use anyhow::{Context, Result};
    use bun_windows_winclean::tweaks::{live::LiveBackend, runner, Catalog, Level, Profile, TargetKind};
    use crossterm::{
        event::{self, Event, KeyCode, KeyEventKind},
        execute,
        terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    };
    use ratatui::{
        prelude::*,
        widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    };

    use crate::desktop::Desktop;

    struct App {
        catalog: Catalog,
        level: Level,
        target: TargetKind,
        module_on: Vec<(String, bool)>,
        desktop: Option<Desktop>,
        cursor: usize,
        status: String,
    }

    impl App {
        fn new() -> Result<Self> {
            let catalog = Catalog::embedded().context("catalog")?;
            let module_on = catalog.modules.iter().map(|m| (m.id.clone(), true)).collect();
            Ok(Self {
                catalog,
                level: Level::Conservative,
                target: TargetKind::Live,
                module_on,
                desktop: None,
                cursor: 0,
                status: "space: toggle module  l: cycle level  d: cycle desktop  p: plan  q: quit".into(),
            })
        }

        fn profile(&self) -> Profile {
            Profile {
                target: self.target,
                level: self.level,
                modules: self.module_on.iter().filter(|(_, on)| *on).map(|(id, _)| id.clone()).collect(),
                include: Vec::new(),
                exclude: Vec::new(),
                desktop: self.desktop.map(|d| d.id().to_owned()),
                iso: None,
            }
        }

        fn plan_now(&mut self) {
            let profile = self.profile();
            let mut backend = LiveBackend;
            match runner::make_plan(&profile, &mut backend) {
                Ok((plan, path)) => {
                    self.status = format!(
                        "{} changes planned. Saved {}. Press a to apply (restore point + journal), q to quit.",
                        plan.changes(),
                        path.display()
                    );
                }
                Err(e) => self.status = format!("plan failed: {e}"),
            }
        }

        fn apply_now(&mut self) {
            let profile = self.profile();
            let mut backend = LiveBackend;
            match runner::make_plan(&profile, &mut backend).and_then(|(plan, _)| {
                runner::apply_live(&plan, "Bun OS Tweaks (guided)").map_err(Into::into)
            }) {
                Ok((journal, path)) => {
                    let applied = journal.entries.iter().filter(|e| e.result == "applied").count();
                    self.status = format!("applied {applied} changes. Undo: bunos-win11 undo. Journal {}", path.display());
                }
                Err(e) => self.status = format!("apply failed: {e}"),
            }
        }
    }

    pub fn run() -> Result<()> {
        let mut app = App::new()?;
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;
        let result = event_loop(&mut terminal, &mut app);
        disable_raw_mode()?;
        execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
        terminal.show_cursor()?;
        result
    }

    fn event_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
        loop {
            terminal.draw(|f| draw(f, app))?;
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                    KeyCode::Up => app.cursor = app.cursor.saturating_sub(1),
                    KeyCode::Down => app.cursor = (app.cursor + 1).min(app.module_on.len().saturating_sub(1)),
                    KeyCode::Char(' ') => {
                        if let Some(m) = app.module_on.get_mut(app.cursor) {
                            m.1 = !m.1;
                        }
                    }
                    KeyCode::Char('l') => {
                        app.level = match app.level {
                            Level::Conservative => Level::Standard,
                            Level::Standard => Level::Aggressive,
                            Level::Aggressive => Level::Conservative,
                        };
                    }
                    KeyCode::Char('t') => {
                        app.target = match app.target {
                            TargetKind::Live => TargetKind::Offline,
                            TargetKind::Offline => TargetKind::Live,
                        };
                    }
                    KeyCode::Char('d') => {
                        let idx = app.desktop.map_or(0, |d| Desktop::ALL.iter().position(|x| *x == d).unwrap_or(0) + 1);
                        app.desktop = Desktop::ALL.get(idx).copied();
                    }
                    KeyCode::Char('p') => app.plan_now(),
                    KeyCode::Char('a') => app.apply_now(),
                    _ => {}
                }
            }
        }
    }

    fn draw(f: &mut Frame, app: &App) {
        let areas = Layout::vertical([Constraint::Length(3), Constraint::Min(5), Constraint::Length(5)]).split(f.area());
        let header = format!(
            " Bun OS Windows 11 optimiser   target: {:?}   level: {:?}   desktop: {} ",
            app.target,
            app.level,
            app.desktop.map_or("(none)", Desktop::id),
        );
        f.render_widget(Paragraph::new(header).block(Block::default().borders(Borders::ALL).title("bunos-win11")), areas[0]);

        let items: Vec<ListItem> = app
            .module_on
            .iter()
            .map(|(id, on)| {
                let m = app.catalog.modules.iter().find(|m| &m.id == id);
                let title = m.map_or(id.as_str(), |m| m.title.as_str());
                ListItem::new(format!("[{}] {:<14} {}", if *on { "x" } else { " " }, id, title))
            })
            .collect();
        let mut state = ListState::default();
        state.select(Some(app.cursor));
        f.render_stateful_widget(
            List::new(items)
                .block(Block::default().borders(Borders::ALL).title("modules (space toggles)"))
                .highlight_symbol("> "),
            areas[1],
            &mut state,
        );

        f.render_widget(
            Paragraph::new(app.status.as_str())
                .wrap(Wrap { trim: true })
                .block(Block::default().borders(Borders::ALL).title("status")),
            areas[2],
        );
    }
}
