// SPDX-License-Identifier: Apache-2.0
//! Windows keyboard input to Linux evdev codes, and Windows keyboard layouts to XKB layout names.
//! The presenter sends physical keys (scan codes) and the host's XKB keymap interprets them with the same layout the
//! Windows user has selected, so AZERTY, QWERTZ, dead keys and AltGr behave as in Win32 apps.

/// PS/2 set-1 scan code (`lParam` bits 16..23 of WM_KEYDOWN) plus the extended bit (bit 24) to an evdev key code.
/// Non-extended set-1 codes 0x01..=0x58 equal evdev codes (KEY_ESC = 1 .. KEY_F12 = 88).
pub fn scancode_to_evdev(scancode: u32, extended: bool) -> Option<u32> {
    if !extended {
        return match scancode {
            0x01..=0x58 => Some(scancode),
            0x64..=0x6e => Some(scancode - 0x64 + 183), // F13..F23
            0x70 => Some(93),                           // KEY_KATAKANAHIRAGANA
            0x73 => Some(89),                           // KEY_RO
            0x76 => Some(194),                          // F24
            0x79 => Some(92),                           // KEY_HENKAN
            0x7b => Some(94),                           // KEY_MUHENKAN
            0x7d => Some(124),                          // KEY_YEN
            0x7e => Some(121),                          // KEY_KPCOMMA
            _ => None,
        };
    }
    Some(match scancode {
        0x1c => 96,  // KEY_KPENTER
        0x1d => 97,  // KEY_RIGHTCTRL
        0x35 => 98,  // KEY_KPSLASH
        0x37 => 99,  // KEY_SYSRQ (Print Screen)
        0x38 => 100, // KEY_RIGHTALT (AltGr)
        0x45 => 69,  // KEY_NUMLOCK (sent extended by Windows)
        0x46 => 119, // KEY_PAUSE (Ctrl+Break)
        0x47 => 102, // KEY_HOME
        0x48 => 103, // KEY_UP
        0x49 => 104, // KEY_PAGEUP
        0x4b => 105, // KEY_LEFT
        0x4d => 106, // KEY_RIGHT
        0x4f => 107, // KEY_END
        0x50 => 108, // KEY_DOWN
        0x51 => 109, // KEY_PAGEDOWN
        0x52 => 110, // KEY_INSERT
        0x53 => 111, // KEY_DELETE
        0x5b => 125, // KEY_LEFTMETA
        0x5c => 126, // KEY_RIGHTMETA
        0x5d => 127, // KEY_COMPOSE (menu)
        0x5e => 116, // KEY_POWER
        0x5f => 142, // KEY_SLEEP
        0x10 => 165, // KEY_PREVIOUSSONG
        0x19 => 163, // KEY_NEXTSONG
        0x20 => 113, // KEY_MUTE
        0x22 => 164, // KEY_PLAYPAUSE
        0x24 => 166, // KEY_STOPCD
        0x2e => 114, // KEY_VOLUMEDOWN
        0x30 => 115, // KEY_VOLUMEUP
        _ => return None,
    })
}

/// Windows primary language / sublanguage (the low word of an HKL) to (XKB layout, variant).
pub fn langid_to_xkb(langid: u16) -> (&'static str, &'static str) {
    match langid {
        0x040c => ("fr", ""),          // French (France), AZERTY
        0x080c => ("be", ""),          // French (Belgium)
        0x0c0c => ("ca", "fr"),        // French (Canada)
        0x100c => ("ch", "fr"),        // French (Switzerland)
        0x140c => ("fr", ""),          // French (Luxembourg)
        0x0407 => ("de", ""),          // German
        0x0807 => ("ch", ""),          // German (Switzerland)
        0x0c07 => ("at", ""),          // German (Austria)
        0x0409 => ("us", ""),          // English (US)
        0x0809 => ("gb", ""),          // English (UK)
        0x1009 => ("ca", ""),          // English (Canada)
        0x0410 => ("it", ""),          // Italian
        0x040a | 0x0c0a => ("es", ""), // Spanish
        0x080a => ("latam", ""),       // Spanish (Mexico)
        0x0816 => ("pt", ""),          // Portuguese
        0x0416 => ("br", ""),          // Portuguese (Brazil)
        0x0413 => ("nl", ""),          // Dutch
        0x0419 => ("ru", ""),          // Russian
        0x0411 => ("jp", ""),          // Japanese
        0x0412 => ("kr", ""),          // Korean
        0x0415 => ("pl", ""),          // Polish
        0x041d => ("se", ""),          // Swedish
        0x0414 => ("no", ""),          // Norwegian
        0x0406 => ("dk", ""),          // Danish
        0x040b => ("fi", ""),          // Finnish
        0x0405 => ("cz", ""),          // Czech
        0x041f => ("tr", ""),          // Turkish
        _ => ("us", ""),
    }
}

/// Win32 mouse buttons to evdev BTN_* codes.
pub const BTN_LEFT: u32 = 0x110;
pub const BTN_RIGHT: u32 = 0x111;
pub const BTN_MIDDLE: u32 = 0x112;
pub const BTN_SIDE: u32 = 0x113;
pub const BTN_EXTRA: u32 = 0x114;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_and_navigation() {
        assert_eq!(scancode_to_evdev(0x10, false), Some(16)); // KEY_Q (A on AZERTY)
        assert_eq!(scancode_to_evdev(0x1c, false), Some(28)); // KEY_ENTER
        assert_eq!(scancode_to_evdev(0x1c, true), Some(96)); // KEY_KPENTER
        assert_eq!(scancode_to_evdev(0x38, true), Some(100)); // AltGr
        assert_eq!(scancode_to_evdev(0x4b, true), Some(105)); // Left
        assert_eq!(scancode_to_evdev(0x5b, true), Some(125)); // Win
        assert_eq!(scancode_to_evdev(0x56, false), Some(86)); // ISO <>
    }

    #[test]
    fn layouts() {
        assert_eq!(langid_to_xkb(0x040c), ("fr", ""));
        assert_eq!(langid_to_xkb(0x100c), ("ch", "fr"));
        assert_eq!(langid_to_xkb(0x1234), ("us", ""));
    }
}
