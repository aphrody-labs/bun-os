# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `coord` module: `.coord` envelope (ai.json v1), fleet `message/send` params, peer roster
  (codex/agycli/claude/ocr/rag), `/a2a` and `/.well-known/agent-card.json` paths, and JSON
  Schemas (envelope, JSON-RPC request/response, agent card) with serde roundtrip tests. Decision:
  aphrody-a2a is the single protocol-contract owner; siblings consume it instead of redefining.

### Fixed

- `A2AError::extended_card_not_configured()` (`-32007`, reason `EXTENDED_AGENT_CARD_NOT_CONFIGURED`) and
  HTTP 400 for `ExtendedAgentCardNotConfiguredError` and `ExtensionSupportRequiredError`, as in section
  5.4 of the A2A 1.0 specification.
- README: crate names, install lines and imports use the `aphrody-a2a*` names published on
  crates.io instead of the upstream `a2a-*-lf` ones.
- README doctest imported the old `a2a` crate name.

## [0.3.0](https://github.com/a2aproject/a2a-rs/compare/a2a-lf-v0.2.4...a2a-lf-v0.3.0) - 2026-05-11

### Fixed

- use TaskPushNotificationConfig v1.0.0 ([#66](https://github.com/a2aproject/a2a-rs/pull/66))
- align error code mappings with upstream spec fix (A2A#1627) ([#58](https://github.com/a2aproject/a2a-rs/pull/58))

## [0.2.4](https://github.com/a2aproject/a2a-rs/compare/agntcy-a2a-v0.2.3...agntcy-a2a-v0.2.4) - 2026-04-05

### Fixed

- normalize gRPC agent card URLs

## [0.2.3](https://github.com/a2aproject/a2a-rs/compare/agntcy-a2a-v0.2.2...agntcy-a2a-v0.2.3) - 2026-04-04

### Added

- add SLIMRPC transport binding

### Fixed

- drop dotted jsonrpc aliases
- align jsonrpc and agent-card interop

## [0.2.2](https://github.com/a2aproject/a2a-rs/compare/agntcy-a2a-v0.2.1...agntcy-a2a-v0.2.2) - 2026-04-03

### Other

- add crate rustdoc for agntcy-a2a

## [0.2.1](https://github.com/a2aproject/a2a-rs/compare/agntcy-a2a-v0.2.0...agntcy-a2a-v0.2.1) - 2026-04-03

### Other

- add crate readmes for crates.io

## [0.2.0](https://github.com/a2aproject/a2a-rs/compare/a2a-v0.1.0...a2a-v0.2.0) - 2026-04-03

### Added

- initialize a2a-rs Rust SDK
