// Bun OS Store (Flutter): browse the Bun OS Store catalog, check the WebOS server, and theme the app with the Bun OS
// Material 3 tokens or any seed computed by the Rust core. Android, Linux desktop and web from one code base.
import 'package:dynamic_color/dynamic_color.dart';
import 'package:flutter/material.dart';

import 'src/api.dart';
import 'src/rust_theme.dart';
import 'src/screens.dart';
import 'theme/bunos_tokens.g.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initRustCore();
  runApp(const BunOsStoreApp());
}

/// Theme choice shared by every screen.
class ThemeSettings extends ChangeNotifier {
  ThemeMode mode = ThemeMode.system;

  /// Bun OS generated tokens (default), wallpaper colours, or a Rust-computed scheme for [seed].
  ThemeSource source = ThemeSource.bunos;
  String seed = '#6750a4';
  String variant = 'tonalSpot';
  double contrast = 0;

  void update(void Function(ThemeSettings s) change) {
    change(this);
    notifyListeners();
  }
}

enum ThemeSource { bunos, wallpaper, seed }

class BunOsStoreApp extends StatefulWidget {
  const BunOsStoreApp({super.key});

  @override
  State<BunOsStoreApp> createState() => _BunOsStoreAppState();
}

class _BunOsStoreAppState extends State<BunOsStoreApp> {
  final settings = ThemeSettings();
  final api = BunOsApi();

  ThemeData _theme(Brightness brightness, ColorScheme? wallpaper) {
    final ColorScheme? scheme = switch (settings.source) {
      ThemeSource.bunos => null,
      ThemeSource.wallpaper => wallpaper,
      ThemeSource.seed => rustScheme(settings.seed, settings.variant, brightness, contrast: settings.contrast),
    };
    return bunOsTheme(brightness, dynamic: scheme);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: settings,
      builder: (context, _) => DynamicColorBuilder(
        builder: (light, dark) => MaterialApp(
          title: 'Bun OS Store',
          debugShowCheckedModeBanner: false,
          themeMode: settings.mode,
          theme: _theme(Brightness.light, light),
          darkTheme: _theme(Brightness.dark, dark),
          home: StoreHome(api: api, settings: settings, wallpaperAvailable: light != null),
        ),
      ),
    );
  }
}
