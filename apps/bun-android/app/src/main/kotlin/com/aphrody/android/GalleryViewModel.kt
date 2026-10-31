package com.aphrody.android

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class Destination(val label: String, val symbol: String) {
    COMPONENTS("Composants", "◈"), BUN("Bun", "◇"), SETTINGS("Réglages", "⚙")
}

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class GalleryState(
    val destination: Destination = Destination.COMPONENTS,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    // Bun OS tokens by default; Material You wallpaper colours are opt-in (Réglages).
    val dynamicColor: Boolean = false,
    val name: String = "Aphrody",
    val notifications: Boolean = true,
    val intensity: Float = 0.6f,
    val selectedChip: Boolean = true,
)

class GalleryViewModel(private val savedState: SavedStateHandle) : ViewModel() {
    private val mutableState = MutableStateFlow(
        GalleryState(
            destination = Destination.valueOf(savedState["destination"] ?: Destination.COMPONENTS.name),
            themeMode = ThemeMode.valueOf(savedState["theme"] ?: ThemeMode.SYSTEM.name),
            dynamicColor = savedState["dynamic"] ?: false,
            name = savedState["name"] ?: "Aphrody",
            notifications = savedState["notifications"] ?: true,
            intensity = savedState["intensity"] ?: 0.6f,
            selectedChip = savedState["chip"] ?: true,
        ),
    )
    val state = mutableState.asStateFlow()

    fun update(transform: (GalleryState) -> GalleryState) {
        mutableState.update { current ->
            transform(current).also {
                savedState["destination"] = it.destination.name
                savedState["theme"] = it.themeMode.name
                savedState["dynamic"] = it.dynamicColor
                savedState["name"] = it.name
                savedState["notifications"] = it.notifications
                savedState["intensity"] = it.intensity
                savedState["chip"] = it.selectedChip
            }
        }
    }
}
