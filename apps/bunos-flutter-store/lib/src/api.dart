// Bun OS WebOS APIs: the Store catalog (/api/store/catalog, apps/webos/store) and the WebOS server health and
// inventory (/api/health). Read-only JSON over HTTPS; the origin defaults to https://aphrody.com and is overridden
// with --dart-define=BUNOS_ORIGIN=https://host.
import 'dart:convert';

import 'package:http/http.dart' as http;

const String defaultOrigin = String.fromEnvironment('BUNOS_ORIGIN', defaultValue: 'https://aphrody.com');

class StoreSource {
  StoreSource(this.id, this.label, this.description, this.count, this.setup);
  final String id;
  final String label;
  final String description;
  final int count;
  final String? setup;

  factory StoreSource.fromJson(Map<String, dynamic> j) => StoreSource(
        j['id'] as String,
        j['label'] as String? ?? j['id'] as String,
        j['desc'] as String? ?? '',
        (j['count'] as num?)?.toInt() ?? 0,
        j['setup'] as String?,
      );
}

class StoreCategory {
  StoreCategory(this.id, this.label, this.count);
  final String id;
  final String label;
  final int count;

  factory StoreCategory.fromJson(Map<String, dynamic> j) =>
      StoreCategory(j['id'] as String, j['label'] as String? ?? j['id'] as String, (j['count'] as num?)?.toInt() ?? 0);
}

class StoreApp {
  StoreApp({
    required this.id,
    required this.name,
    required this.source,
    required this.category,
    required this.summary,
    required this.version,
    required this.size,
    required this.license,
    required this.icon,
    required this.homepage,
    required this.permissions,
    required this.install,
    required this.featured,
  });

  final String id;
  final String name;
  final String source;
  final String category;
  final String summary;
  final String version;
  final int? size;
  final String? license;
  final String? icon;
  final String? homepage;
  final List<String> permissions;
  final Map<String, dynamic> install;
  final bool featured;

  factory StoreApp.fromJson(Map<String, dynamic> j) => StoreApp(
        id: j['id'] as String,
        name: j['name'] as String? ?? j['pkg'] as String? ?? j['id'] as String,
        source: j['source'] as String? ?? '',
        category: j['category'] as String? ?? '',
        summary: j['summary'] as String? ?? '',
        version: j['version'] as String? ?? '',
        size: (j['size'] as num?)?.toInt(),
        license: j['license'] as String?,
        icon: j['icon'] as String?,
        homepage: j['homepage'] as String?,
        permissions: [for (final p in (j['permissions'] as List?) ?? const []) p.toString()],
        install: (j['install'] as Map?)?.cast<String, dynamic>() ?? const {},
        featured: j['featured'] == true,
      );

  /// One install hint per install kind the Store publishes (pwa, pacman, apk, flatpak, npm, cargo, android...).
  List<String> get installHints => [for (final e in install.entries) '${e.key}: ${e.value}'];
}

class StoreCatalog {
  StoreCatalog(this.generated, this.origin, this.sources, this.categories, this.apps, this.featured);
  final DateTime? generated;
  final String origin;
  final List<StoreSource> sources;
  final List<StoreCategory> categories;
  final List<StoreApp> apps;
  final List<String> featured;

  factory StoreCatalog.fromJson(Map<String, dynamic> j) => StoreCatalog(
        DateTime.tryParse(j['generated'] as String? ?? ''),
        j['origin'] as String? ?? defaultOrigin,
        [for (final s in (j['sources'] as List? ?? const [])) StoreSource.fromJson(s as Map<String, dynamic>)],
        [for (final c in (j['categories'] as List? ?? const [])) StoreCategory.fromJson(c as Map<String, dynamic>)],
        [for (final a in (j['apps'] as List? ?? const [])) StoreApp.fromJson(a as Map<String, dynamic>)],
        [for (final f in (j['featured'] as List? ?? const [])) f.toString()],
      );
}

class ServerHealth {
  ServerHealth(this.ok, this.service, this.sourceCommit, this.uptimeSeconds, this.inventory, this.checks);
  final bool ok;
  final String service;
  final String sourceCommit;
  final int uptimeSeconds;
  final Map<String, int> inventory;
  final Map<String, bool> checks;

  factory ServerHealth.fromJson(Map<String, dynamic> j) => ServerHealth(
        j['ok'] == true,
        j['service'] as String? ?? '',
        j['sourceCommit'] as String? ?? '',
        (j['uptimeSeconds'] as num?)?.toInt() ?? 0,
        {
          for (final e in (((j['inventory'] as Map?)?['counts'] as Map?) ?? const {}).entries)
            e.key.toString(): (e.value as num).toInt(),
        },
        {
          for (final e in ((j['checks'] as Map?) ?? const {}).entries)
            e.key.toString(): (e.value as Map?)?['ok'] == true,
        },
      );
}

class BunOsApi {
  BunOsApi({this.origin = defaultOrigin, http.Client? client}) : _client = client ?? http.Client();
  final String origin;
  final http.Client _client;

  Future<Map<String, dynamic>> _json(String path) async {
    final response = await _client
        .get(Uri.parse('$origin$path'), headers: const {'accept': 'application/json', 'user-agent': 'bunos-flutter-store/1.0'})
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) throw http.ClientException('HTTP ${response.statusCode} for $path');
    return jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
  }

  Future<StoreCatalog> catalog() async => StoreCatalog.fromJson(await _json('/api/store/catalog'));
  Future<ServerHealth> health() async => ServerHealth.fromJson(await _json('/api/health'));
}
