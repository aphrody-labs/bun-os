// SPDX-License-Identifier: Apache-2.0
//! Notifications: the cosmic-notifications model (freedesktop Desktop Notifications semantics:
//! `replaces_id`, urgency, actions, expiry, transient) for console toasts and a history list.
//!
//! The shell shows active notifications as M3 snackbars and the history in the quick menu; on
//! Windows the platform may mirror them to toasts, on Linux the cosmic notification service reaches the
//! COSMIC daemon. Do-not-disturb keeps everything except critical notifications out of the toasts.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Urgency {
    Low,
    #[default]
    Normal,
    Critical,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationAction {
    /// Action key returned to the sender (`default` is the body itself).
    pub key: String,
    /// Localized label.
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    #[serde(default)]
    pub id: u32,
    /// Sender (`bun-os`, plugin id, `steam`).
    pub app: String,
    /// Material Symbols name.
    pub icon: String,
    /// Localized text.
    pub summary: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub urgency: Urgency,
    #[serde(default)]
    pub actions: Vec<NotificationAction>,
    /// Seconds before the toast leaves (`None`: the center's default; critical never expires).
    #[serde(default)]
    pub timeout: Option<f32>,
    /// Not kept in the history once dismissed or expired.
    #[serde(default)]
    pub transient: bool,
    /// Update this notification in place instead of adding one.
    #[serde(default)]
    pub replaces_id: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
struct Active {
    notification: Notification,
    left: Option<f32>,
}

/// What the host must do after an interaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Send `action` back to `app` (platform event `notifications.action`).
    Invoked {
        id: u32,
        app: String,
        action: String,
    },
    Dismissed {
        id: u32,
    },
}

/// Active toasts and the history.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "bevy", derive(bevy_ecs::resource::Resource))]
pub struct NotificationCenter {
    next_id: u32,
    active: Vec<Active>,
    history: Vec<Notification>,
    pub do_not_disturb: bool,
    /// Default toast lifetime in seconds (the theme's toast timing).
    pub default_timeout: f32,
    /// History length kept.
    pub history_limit: usize,
    /// Toasts shown at once.
    pub visible_limit: usize,
}

impl NotificationCenter {
    pub fn new(default_timeout: f32) -> Self {
        Self {
            next_id: 1,
            active: Vec::new(),
            history: Vec::new(),
            do_not_disturb: false,
            default_timeout,
            history_limit: 100,
            visible_limit: 3,
        }
    }

    /// Post or replace a notification; returns its id.
    pub fn notify(&mut self, mut notification: Notification) -> u32 {
        let id = match notification.replaces_id.filter(|id| *id != 0) {
            Some(id) => id,
            None => {
                let id = self.next_id;
                self.next_id = self.next_id.wrapping_add(1).max(1);
                id
            }
        };
        notification.id = id;
        let left = if notification.urgency == Urgency::Critical {
            None
        } else {
            Some(notification.timeout.unwrap_or(self.default_timeout))
        };
        self.history.retain(|n| n.id != id);
        match self.active.iter_mut().find(|a| a.notification.id == id) {
            Some(slot) => *slot = Active { notification, left },
            None => self.active.push(Active { notification, left }),
        }
        id
    }

    fn retire(&mut self, index: usize) {
        let active = self.active.remove(index);
        if !active.notification.transient {
            self.history.insert(0, active.notification);
            self.history.truncate(self.history_limit);
        }
    }

    /// Advance expiry by `dt` seconds (only shown toasts count down).
    pub fn tick(&mut self, dt: f32) {
        let shown: Vec<u32> = self.toasts().iter().map(|n| n.id).collect();
        let mut i = 0;
        while i < self.active.len() {
            let a = &mut self.active[i];
            if shown.contains(&a.notification.id)
                && let Some(left) = a.left.as_mut()
            {
                *left -= dt;
                if *left <= 0.0 {
                    self.retire(i);
                    continue;
                }
            }
            i += 1;
        }
    }

    /// Toasts to show now, most urgent then newest first.
    pub fn toasts(&self) -> Vec<&Notification> {
        let mut out: Vec<&Notification> = self
            .active
            .iter()
            .map(|a| &a.notification)
            .filter(|n| !self.do_not_disturb || n.urgency == Urgency::Critical)
            .collect();
        out.sort_by(|a, b| b.urgency.cmp(&a.urgency).then_with(|| b.id.cmp(&a.id)));
        out.truncate(self.visible_limit);
        out
    }

    pub fn history(&self) -> &[Notification] {
        &self.history
    }

    /// Unseen count for the status badge (active plus history while do-not-disturb hid them).
    pub fn pending(&self) -> usize {
        self.active.len()
    }

    pub fn dismiss(&mut self, id: u32) -> Option<Outcome> {
        let index = self.active.iter().position(|a| a.notification.id == id)?;
        self.retire(index);
        Some(Outcome::Dismissed { id })
    }

    /// Accept on a toast or history entry: invoke `action` (or `default`) and retire it.
    pub fn invoke(&mut self, id: u32, action: Option<&str>) -> Option<Outcome> {
        let app = self
            .active
            .iter()
            .map(|a| &a.notification)
            .chain(self.history.iter())
            .find(|n| n.id == id)?
            .app
            .clone();
        if let Some(index) = self.active.iter().position(|a| a.notification.id == id) {
            self.retire(index);
        }
        Some(Outcome::Invoked {
            id,
            app,
            action: action.unwrap_or("default").to_string(),
        })
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
    }
}
