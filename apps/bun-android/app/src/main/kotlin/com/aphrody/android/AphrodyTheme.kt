package com.aphrody.android

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import com.aphrody.android.theme.BunOsTheme

/**
 * App theme: the generated Bun OS Material 3 theme (theme/BunOsTokens.kt, written by
 * `bun packages/m3-os-themes/src/cli.ts apps` from the same tokens as the web, Flutter and COSMIC themes).
 */
@Composable
fun AphrodyTheme(
    mode: ThemeMode = ThemeMode.SYSTEM,
    dynamic: Boolean = true,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    BunOsTheme(dark = dark, dynamic = dynamic, content = content)
}
