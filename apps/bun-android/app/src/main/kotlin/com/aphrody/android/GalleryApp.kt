package com.aphrody.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryApp(
    state: GalleryState,
    nativeAnswer: Int,
    update: ((GalleryState) -> GalleryState) -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showDialog by rememberSaveable { mutableStateOf(false) }
    NavigationSuiteScaffold(
        navigationSuiteItems = {
            Destination.entries.forEach { destination ->
                item(
                    icon = { Text(destination.symbol) },
                    label = { Text(destination.label) },
                    selected = state.destination == destination,
                    onClick = { update { it.copy(destination = destination) } },
                    modifier = Modifier.testTag("nav-${destination.name}"),
                )
            }
        },
    ) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("Aphrody · ${state.destination.label}") }) },
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                if (state.destination == Destination.COMPONENTS) {
                    FloatingActionButton(onClick = { showDialog = true }, modifier = Modifier.testTag("show-dialog")) {
                        Text("+", modifier = Modifier.size(24.dp))
                    }
                }
            },
        ) { padding ->
            when (state.destination) {
                Destination.COMPONENTS -> ComponentGallery(
                    state, nativeAnswer, update,
                    onMessage = { scope.launch { snackbar.showSnackbar("Bonjour ${state.name}") } },
                    modifier = Modifier.padding(padding),
                )
                Destination.BUN -> BunContent(Modifier.padding(padding).fillMaxSize())
                Destination.SETTINGS -> SettingsGallery(state, update, Modifier.padding(padding))
            }
        }
    }
    if (showDialog) {
        AlertDialog(
            onDismissRequest = { showDialog = false },
            title = { Text("Votre espace Android") },
            text = { Text("Kotlin, Compose, Bun et Rust sont réunis dans cette application.") },
            confirmButton = { TextButton(onClick = { showDialog = false }) { Text("Fermer") } },
        )
    }
}

@Composable
private fun ComponentGallery(
    state: GalleryState,
    nativeAnswer: Int,
    update: ((GalleryState) -> GalleryState) -> Unit,
    onMessage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Créer avec Material 3", style = MaterialTheme.typography.headlineMedium)
        Text("Des composants natifs, un thème dynamique et une navigation qui s'adapte à la fenêtre.")
        Card(Modifier.fillMaxWidth()) {
            ListItem(
                headlineContent = { Text("Java + Rust JNI : 20 + 22 = $nativeAnswer", Modifier.testTag("native-result")) },
                supportingContent = { Text("Bibliothèque native chargée sur Android") },
            )
        }
        val core = remember { runCatching { com.aphrody.android.core.coreInfo() } }
        Card(Modifier.fillMaxWidth()) {
            ListItem(
                headlineContent = {
                    Text(
                        core.fold(
                            { "Rust core ${it.version} · ${it.arch}/${it.os} · ${it.pointerBits}-bit" },
                            { "Rust core indisponible : ${it.message}" },
                        ),
                        Modifier.testTag("uniffi-result"),
                    )
                },
                supportingContent = { Text("Liaisons Kotlin générées par uniffi") },
            )
        }
        OutlinedTextField(
            value = state.name,
            onValueChange = { value -> update { it.copy(name = value) } },
            label = { Text("Votre nom") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("name-field"),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilterChip(
                selected = state.selectedChip,
                onClick = { update { it.copy(selectedChip = !it.selectedChip) } },
                label = { Text("Compose") },
            )
            AssistChip(onClick = { update { it.copy(destination = Destination.BUN) } }, label = { Text("Ouvrir Bun") })
        }
        ListItem(
            headlineContent = { Text("Notifications") },
            trailingContent = {
                Checkbox(
                    checked = state.notifications,
                    onCheckedChange = { enabled -> update { it.copy(notifications = enabled) } },
                    modifier = Modifier.testTag("notifications").semantics { contentDescription = "Notifications" },
                )
            },
        )
        Text("Intensité : ${(state.intensity * 100).toInt()} %")
        Slider(
            value = state.intensity,
            onValueChange = { value -> update { it.copy(intensity = value) } },
            modifier = Modifier.semantics { contentDescription = "Intensité" },
        )
        LinearProgressIndicator(progress = { state.intensity }, modifier = Modifier.fillMaxWidth())
        Button(onClick = onMessage, modifier = Modifier.testTag("greet-button")) { Text("Dire bonjour") }
    }
}

@Composable
private fun SettingsGallery(
    state: GalleryState,
    update: ((GalleryState) -> GalleryState) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Apparence", style = MaterialTheme.typography.headlineMedium)
        ThemeMode.entries.forEach { mode ->
            val label = when (mode) {
                ThemeMode.SYSTEM -> "Thème système"
                ThemeMode.LIGHT -> "Thème clair"
                ThemeMode.DARK -> "Thème sombre"
            }
            ListItem(
                headlineContent = { Text(label) },
                trailingContent = {
                    RadioButton(
                        selected = state.themeMode == mode,
                        onClick = { update { it.copy(themeMode = mode) } },
                        modifier = Modifier.testTag("theme-${mode.name}").semantics { contentDescription = label },
                    )
                },
            )
        }
        ListItem(
            headlineContent = { Text("Couleurs dynamiques") },
            supportingContent = { Text("Utilise les couleurs du fond d'écran à partir d'Android 12") },
            trailingContent = {
                Switch(
                    checked = state.dynamicColor,
                    onCheckedChange = { enabled -> update { it.copy(dynamicColor = enabled) } },
                    modifier = Modifier.testTag("dynamic-color").semantics { contentDescription = "Couleurs dynamiques" },
                )
            },
        )
    }
}

@Preview(showBackground = true, widthDp = 400)
@Composable
private fun CompactPreview() {
    AphrodyTheme(dynamic = false) { GalleryApp(GalleryState(), 42) {} }
}

@Preview(showBackground = true, widthDp = 1000, heightDp = 700)
@Composable
private fun ExpandedDarkPreview() {
    AphrodyTheme(ThemeMode.DARK, false) { GalleryApp(GalleryState(), 42) {} }
}
