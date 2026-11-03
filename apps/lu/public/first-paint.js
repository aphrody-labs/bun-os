// The first frame on a phone, in the theme the phone shell is going to use.
//
// index.html paints dark, because the desktop starts dark. The phone shell
// follows the system by default (src/mobile/platform/theme.ts), so on a phone
// in light mode the start was: dark loading screen, then the light app. Seen
// as a short black screen at every cold start (acceptance on the small
// iPhone, round 5, N8).
//
// This runs before the body is parsed and before the app is loaded. It reads
// what theme.ts will read (the preference under "lu-mobile-theme", else the
// system) and marks <html>; public/first-paint.css, generated from the M3
// sheet, paints the surface role for that mark, so the loading screen has the
// ground colour of the phone shell from its first frame, light or dark. This
// file holds no colour of its own. The native side shows
// the same two colours before this page exists (start screen, window, empty
// web view; mobile-docs/r5/start.md). On a desktop it does nothing at all.
//
// A file of its own and no inline script: the content security policy of the
// app allows scripts from the app only.
;(function () {
  try {
    var host = window.__LU_HOST__
    var nav = window.navigator || {}
    var ua = nav.userAgent || ''
    var platform = nav.platform || ''
    var query = new URLSearchParams(window.location.search)
    var phone
    if (host === 'ios' || host === 'android') phone = true
    else if (host === 'macos' || host === 'windows' || host === 'linux') phone = false
    else {
      phone =
        query.get('mobile') === '1' ||
        /Android/.test(ua) ||
        /iPhone|iPad|iPod/.test(platform) ||
        /iPhone|iPad|iPod/.test(ua) ||
        (/Mac/.test(platform) && (nav.maxTouchPoints || 0) > 1)
    }
    if (!phone) return
    var pref = null
    try {
      pref = window.localStorage.getItem('lu-mobile-theme')
    } catch (e) {
      pref = null
    }
    var pinned = query.get('theme')
    var systemDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
    var dark = pinned === 'dark' || pinned === 'light' ? pinned === 'dark' : pref === 'dark' ? true : pref === 'light' ? false : systemDark
    var root = document.documentElement
    // The inline background index.html starts with is dropped: the mark is
    // what first-paint.css paints, the same surface the native window has.
    root.style.removeProperty('background')
    if (dark) {
      root.classList.add('lu-first-dark')
      return
    }
    root.classList.remove('dark')
    root.classList.add('light', 'lu-first-light')
  } catch (e) {
    // The dark loading screen stays. The app sets the theme a moment later either way.
  }
})()
