// M3 schemes computed by the Bun OS Rust core (crates/bunos-flutter-bridge -> crates/aphrody-m3-tokens) through
// flutter_rust_bridge. Same engine as the generated bunos_tokens.g.dart, but for any seed at run time.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'rust/api/theme.dart' as rust;
import 'rust/frb_generated.dart';

bool _ready = false;
String? rustError;

/// Load the Rust core (libbunos_flutter_bridge). Web builds keep the generated Dart scheme.
Future<bool> initRustCore() async {
  if (kIsWeb) {
    rustError = 'Rust core not linked on the web build';
    return false;
  }
  try {
    await RustLib.init();
    _ready = true;
  } catch (error) {
    rustError = '$error';
  }
  return _ready;
}

bool get rustReady => _ready;

String rustCoreVersion() => _ready ? rust.coreVersion() : (rustError ?? 'not loaded');

const List<String> schemeVariants = ['tonalSpot', 'vibrant', 'expressive', 'content', 'fidelity', 'neutral', 'monochrome'];

/// ColorScheme for `seed` (#rrggbb) from the Rust engine, or null if the core is unavailable.
ColorScheme? rustScheme(String seed, String variant, Brightness brightness, {double contrast = 0}) {
  if (!_ready) return null;
  final roles = {
    for (final r in rust.schemeFromSeed(seed: seed, variant: variant, dark: brightness == Brightness.dark, contrast: contrast))
      r.name: Color(r.argb),
  };
  Color c(String name) => roles[name] ?? (throw StateError('Rust scheme lacks $name'));
  return ColorScheme(
    brightness: brightness,
    primary: c('primary'),
    onPrimary: c('onPrimary'),
    primaryContainer: c('primaryContainer'),
    onPrimaryContainer: c('onPrimaryContainer'),
    primaryFixed: c('primaryFixed'),
    primaryFixedDim: c('primaryFixedDim'),
    onPrimaryFixed: c('onPrimaryFixed'),
    onPrimaryFixedVariant: c('onPrimaryFixedVariant'),
    secondary: c('secondary'),
    onSecondary: c('onSecondary'),
    secondaryContainer: c('secondaryContainer'),
    onSecondaryContainer: c('onSecondaryContainer'),
    secondaryFixed: c('secondaryFixed'),
    secondaryFixedDim: c('secondaryFixedDim'),
    onSecondaryFixed: c('onSecondaryFixed'),
    onSecondaryFixedVariant: c('onSecondaryFixedVariant'),
    tertiary: c('tertiary'),
    onTertiary: c('onTertiary'),
    tertiaryContainer: c('tertiaryContainer'),
    onTertiaryContainer: c('onTertiaryContainer'),
    tertiaryFixed: c('tertiaryFixed'),
    tertiaryFixedDim: c('tertiaryFixedDim'),
    onTertiaryFixed: c('onTertiaryFixed'),
    onTertiaryFixedVariant: c('onTertiaryFixedVariant'),
    error: c('error'),
    onError: c('onError'),
    errorContainer: c('errorContainer'),
    onErrorContainer: c('onErrorContainer'),
    surface: c('surface'),
    onSurface: c('onSurface'),
    surfaceDim: c('surfaceDim'),
    surfaceBright: c('surfaceBright'),
    surfaceContainerLowest: c('surfaceContainerLowest'),
    surfaceContainerLow: c('surfaceContainerLow'),
    surfaceContainer: c('surfaceContainer'),
    surfaceContainerHigh: c('surfaceContainerHigh'),
    surfaceContainerHighest: c('surfaceContainerHighest'),
    onSurfaceVariant: c('onSurfaceVariant'),
    outline: c('outline'),
    outlineVariant: c('outlineVariant'),
    shadow: c('shadow'),
    scrim: c('scrim'),
    inverseSurface: c('inverseSurface'),
    onInverseSurface: c('inverseOnSurface'),
    inversePrimary: c('inversePrimary'),
    surfaceTint: c('surfaceTint'),
  );
}
