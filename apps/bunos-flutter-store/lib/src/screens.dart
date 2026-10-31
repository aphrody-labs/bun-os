// Screens of the Bun OS Store: Discover (featured apps and sources), Apps (search and filter the whole catalog),
// System (WebOS server health and inventory) and Theme (Bun OS tokens, wallpaper colours or a Rust-computed seed).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../main.dart';
import 'api.dart';
import 'rust_theme.dart';

class StoreHome extends StatefulWidget {
  const StoreHome({super.key, required this.api, required this.settings, required this.wallpaperAvailable});
  final BunOsApi api;
  final ThemeSettings settings;
  final bool wallpaperAvailable;

  @override
  State<StoreHome> createState() => _StoreHomeState();
}

class _StoreHomeState extends State<StoreHome> {
  int index = 0;
  late Future<StoreCatalog> catalog = widget.api.catalog();
  late Future<ServerHealth> health = widget.api.health();

  void refresh() => setState(() {
        catalog = widget.api.catalog();
        health = widget.api.health();
      });

  static const destinations = [
    (Icons.explore_outlined, Icons.explore, 'Discover'),
    (Icons.apps_outlined, Icons.apps, 'Apps'),
    (Icons.dns_outlined, Icons.dns, 'System'),
    (Icons.palette_outlined, Icons.palette, 'Theme'),
  ];

  @override
  Widget build(BuildContext context) {
    final body = switch (index) {
      0 => DiscoverScreen(catalog: catalog, onRetry: refresh),
      1 => AppsScreen(catalog: catalog, onRetry: refresh),
      2 => SystemScreen(health: health, origin: widget.api.origin, onRetry: refresh),
      _ => ThemeScreen(settings: widget.settings, wallpaperAvailable: widget.wallpaperAvailable),
    };
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final medium = MediaQuery.sizeOf(context).width >= 600;
    final appBar = AppBar(
      title: Text(destinations[index].$3 == 'Discover' ? 'Bun OS Store' : destinations[index].$3),
      actions: [IconButton(onPressed: refresh, tooltip: 'Refresh', icon: const Icon(Icons.refresh))],
    );
    if (!medium) {
      return Scaffold(
        appBar: appBar,
        body: body,
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) => setState(() => index = i),
          destinations: [
            for (final d in destinations) NavigationDestination(icon: Icon(d.$1), selectedIcon: Icon(d.$2), label: d.$3),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: appBar,
      body: Row(
        children: [
          NavigationRail(
            extended: wide,
            selectedIndex: index,
            labelType: wide ? NavigationRailLabelType.none : NavigationRailLabelType.all,
            onDestinationSelected: (i) => setState(() => index = i),
            destinations: [
              for (final d in destinations)
                NavigationRailDestination(icon: Icon(d.$1), selectedIcon: Icon(d.$2), label: Text(d.$3)),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ],
      ),
    );
  }
}

class _Loading<T> extends StatelessWidget {
  const _Loading({required this.future, required this.builder, required this.onRetry});
  final Future<T> future;
  final Widget Function(BuildContext, T) builder;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
        future: future,
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.cloud_off, size: 48, color: Theme.of(context).colorScheme.error),
                  const SizedBox(height: 12),
                  Text('${snap.error}', textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton.tonal(onPressed: onRetry, child: const Text('Retry')),
                ]),
              ),
            );
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          return builder(context, snap.data as T);
        },
      );
}

String _size(int? bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  var value = bytes.toDouble();
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return '${value.toStringAsFixed(unit == 0 ? 0 : 1)} ${units[unit]}';
}

class AppAvatar extends StatelessWidget {
  const AppAvatar(this.app, {super.key});
  final StoreApp app;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final label = (app.icon != null && app.icon!.length <= 4 ? app.icon! : app.name).characters.take(3).toString();
    return CircleAvatar(
      backgroundColor: scheme.primaryContainer,
      foregroundColor: scheme.onPrimaryContainer,
      child: Text(label, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: scheme.onPrimaryContainer)),
    );
  }
}

void showAppDetails(BuildContext context, StoreApp app) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      final text = Theme.of(context).textTheme;
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          children: [
            ListTile(contentPadding: EdgeInsets.zero, leading: AppAvatar(app), title: Text(app.name, style: text.headlineSmall), subtitle: Text('${app.source} · ${app.version}')),
            Text(app.summary, style: text.bodyLarge),
            const SizedBox(height: 16),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (app.category.isNotEmpty) Chip(label: Text(app.category)),
              if (app.license != null) Chip(label: Text(app.license!)),
              if (app.size != null) Chip(label: Text(_size(app.size))),
            ]),
            if (app.permissions.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Permissions', style: text.titleMedium),
              for (final p in app.permissions) ListTile(dense: true, leading: const Icon(Icons.shield_outlined), title: Text(p)),
            ],
            if (app.installHints.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('Install', style: text.titleMedium),
              for (final hint in app.installHints)
                Card.outlined(
                  child: ListTile(
                    title: SelectableText(hint, style: text.bodyMedium?.copyWith(fontFamily: 'monospace')),
                    trailing: IconButton(
                      tooltip: 'Copy',
                      icon: const Icon(Icons.copy),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: hint));
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
                      },
                    ),
                  ),
                ),
            ],
          ],
        ),
      );
    },
  );
}

class DiscoverScreen extends StatelessWidget {
  const DiscoverScreen({super.key, required this.catalog, required this.onRetry});
  final Future<StoreCatalog> catalog;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => _Loading<StoreCatalog>(
        future: catalog,
        onRetry: onRetry,
        builder: (context, c) {
          final text = Theme.of(context).textTheme;
          final featured = [for (final id in c.featured) ...c.apps.where((a) => a.id == id)];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Featured', style: text.titleLarge),
              const SizedBox(height: 8),
              SizedBox(
                height: 168,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: featured.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (context, i) {
                    final app = featured[i];
                    return SizedBox(
                      width: 260,
                      child: Card.filled(
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => showAppDetails(context, app),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(children: [AppAvatar(app), const SizedBox(width: 12), Expanded(child: Text(app.name, style: text.titleMedium, overflow: TextOverflow.ellipsis))]),
                              const SizedBox(height: 12),
                              Expanded(child: Text(app.summary, maxLines: 3, overflow: TextOverflow.ellipsis, style: text.bodyMedium)),
                            ]),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 24),
              Text('Sources', style: text.titleLarge),
              for (final s in c.sources)
                Card.outlined(
                  child: ListTile(
                    leading: const Icon(Icons.inventory_2_outlined),
                    title: Text(s.label),
                    subtitle: Text(s.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: Badge.count(count: s.count, backgroundColor: Theme.of(context).colorScheme.secondary, textColor: Theme.of(context).colorScheme.onSecondary),
                  ),
                ),
              const SizedBox(height: 24),
              Text('Categories', style: text.titleLarge),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [for (final cat in c.categories) Chip(label: Text('${cat.label} · ${cat.count}'))]),
              const SizedBox(height: 16),
              Text('${c.apps.length} entries · catalog of ${c.generated?.toLocal() ?? 'unknown date'} · ${c.origin}', style: text.bodySmall),
            ],
          );
        },
      );
}

class AppsScreen extends StatefulWidget {
  const AppsScreen({super.key, required this.catalog, required this.onRetry});
  final Future<StoreCatalog> catalog;
  final VoidCallback onRetry;

  @override
  State<AppsScreen> createState() => _AppsScreenState();
}

class _AppsScreenState extends State<AppsScreen> {
  String query = '';
  String? source;

  @override
  Widget build(BuildContext context) => _Loading<StoreCatalog>(
        future: widget.catalog,
        onRetry: widget.onRetry,
        builder: (context, c) {
          final q = query.toLowerCase();
          final apps = c.apps
              .where((a) => source == null || a.source == source)
              .where((a) => q.isEmpty || a.name.toLowerCase().contains(q) || a.summary.toLowerCase().contains(q))
              .toList();
          return Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: SearchBar(
                hintText: 'Search ${c.apps.length} apps and packages',
                leading: const Icon(Icons.search),
                onChanged: (v) => setState(() => query = v),
              ),
            ),
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                children: [
                  FilterChip(label: const Text('All'), selected: source == null, onSelected: (_) => setState(() => source = null)),
                  for (final s in c.sources)
                    Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: FilterChip(label: Text(s.label), selected: source == s.id, onSelected: (on) => setState(() => source = on ? s.id : null)),
                    ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: apps.length,
                itemBuilder: (context, i) {
                  final app = apps[i];
                  return ListTile(
                    leading: AppAvatar(app),
                    title: Text(app.name),
                    subtitle: Text(app.summary, maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: Text(_size(app.size), style: Theme.of(context).textTheme.labelSmall),
                    onTap: () => showAppDetails(context, app),
                  );
                },
              ),
            ),
          ]);
        },
      );
}

class SystemScreen extends StatelessWidget {
  const SystemScreen({super.key, required this.health, required this.origin, required this.onRetry});
  final Future<ServerHealth> health;
  final String origin;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => _Loading<ServerHealth>(
        future: health,
        onRetry: onRetry,
        builder: (context, h) {
          final scheme = Theme.of(context).colorScheme;
          final text = Theme.of(context).textTheme;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Card.filled(
              color: h.ok ? scheme.primaryContainer : scheme.errorContainer,
              child: ListTile(
                leading: Icon(h.ok ? Icons.check_circle : Icons.error, color: h.ok ? scheme.onPrimaryContainer : scheme.onErrorContainer),
                title: Text(h.ok ? '${h.service} is healthy' : '${h.service} reports a problem'),
                subtitle: Text('$origin · up ${Duration(seconds: h.uptimeSeconds).inMinutes} min · ${h.sourceCommit.length >= 10 ? h.sourceCommit.substring(0, 10) : h.sourceCommit}'),
              ),
            ),
            const SizedBox(height: 16),
            Text('Checks', style: text.titleLarge),
            for (final e in h.checks.entries)
              ListTile(leading: Icon(e.value ? Icons.check : Icons.close, color: e.value ? scheme.primary : scheme.error), title: Text(e.key)),
            const SizedBox(height: 16),
            Text('Inventory', style: text.titleLarge),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in h.inventory.entries) Chip(avatar: CircleAvatar(child: Text('${e.value}'.characters.take(3).toString())), label: Text('${e.key} · ${e.value}')),
            ]),
            const SizedBox(height: 16),
            ListTile(leading: const Icon(Icons.memory), title: const Text('Rust core'), subtitle: Text(rustCoreVersion())),
          ]);
        },
      );
}

class ThemeScreen extends StatelessWidget {
  const ThemeScreen({super.key, required this.settings, required this.wallpaperAvailable});
  final ThemeSettings settings;
  final bool wallpaperAvailable;

  static const seeds = ['#6750a4', '#0b57d0', '#146c2e', '#b3261e', '#8e4a00', '#006a6a', '#7d5260'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('Colours', style: text.titleLarge),
      const SizedBox(height: 8),
      SegmentedButton<ThemeSource>(
        segments: [
          const ButtonSegment(value: ThemeSource.bunos, label: Text('Bun OS'), icon: Icon(Icons.auto_awesome)),
          ButtonSegment(value: ThemeSource.wallpaper, label: const Text('Wallpaper'), icon: const Icon(Icons.wallpaper), enabled: wallpaperAvailable),
          ButtonSegment(value: ThemeSource.seed, label: const Text('Seed'), icon: const Icon(Icons.colorize), enabled: rustReady),
        ],
        selected: {settings.source},
        onSelectionChanged: (s) => settings.update((t) => t.source = s.first),
      ),
      const SizedBox(height: 16),
      if (settings.source == ThemeSource.seed) ...[
        Wrap(spacing: 12, runSpacing: 12, children: [
          for (final seed in seeds)
            InkWell(
              customBorder: const CircleBorder(),
              onTap: () => settings.update((t) => t.seed = seed),
              child: CircleAvatar(
                radius: 22,
                backgroundColor: Color(int.parse('ff${seed.substring(1)}', radix: 16)),
                child: settings.seed == seed ? const Icon(Icons.check, color: Colors.white) : null,
              ),
            ),
        ]),
        const SizedBox(height: 16),
        DropdownMenu<String>(
          label: const Text('Scheme variant'),
          initialSelection: settings.variant,
          dropdownMenuEntries: [for (final v in schemeVariants) DropdownMenuEntry(value: v, label: v)],
          onSelected: (v) => settings.update((t) => t.variant = v ?? 'tonalSpot'),
        ),
        const SizedBox(height: 8),
        Text('Contrast ${settings.contrast.toStringAsFixed(1)}'),
        Slider(value: settings.contrast, min: -1, max: 1, divisions: 4, onChanged: (v) => settings.update((t) => t.contrast = v)),
      ],
      const SizedBox(height: 8),
      Text('Mode', style: text.titleLarge),
      const SizedBox(height: 8),
      SegmentedButton<ThemeMode>(
        segments: const [
          ButtonSegment(value: ThemeMode.system, label: Text('System')),
          ButtonSegment(value: ThemeMode.light, label: Text('Light')),
          ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
        ],
        selected: {settings.mode},
        onSelectionChanged: (s) => settings.update((t) => t.mode = s.first),
      ),
      const SizedBox(height: 24),
      Text('Roles', style: text.titleLarge),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final (name, bg, fg) in [
          ('primary', scheme.primary, scheme.onPrimary),
          ('primaryContainer', scheme.primaryContainer, scheme.onPrimaryContainer),
          ('secondary', scheme.secondary, scheme.onSecondary),
          ('secondaryContainer', scheme.secondaryContainer, scheme.onSecondaryContainer),
          ('tertiary', scheme.tertiary, scheme.onTertiary),
          ('tertiaryContainer', scheme.tertiaryContainer, scheme.onTertiaryContainer),
          ('error', scheme.error, scheme.onError),
          ('surfaceContainerHigh', scheme.surfaceContainerHigh, scheme.onSurface),
          ('inverseSurface', scheme.inverseSurface, scheme.onInverseSurface),
        ])
          Container(
            width: 168,
            height: 64,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
            child: Text(name, style: text.labelLarge?.copyWith(color: fg)),
          ),
      ]),
      const SizedBox(height: 24),
      Wrap(spacing: 8, runSpacing: 8, children: [
        FilledButton(onPressed: () {}, child: const Text('Filled')),
        FilledButton.tonal(onPressed: () {}, child: const Text('Tonal')),
        OutlinedButton(onPressed: () {}, child: const Text('Outlined')),
        FloatingActionButton.small(onPressed: () {}, child: const Icon(Icons.add)),
      ]),
    ]);
  }
}
