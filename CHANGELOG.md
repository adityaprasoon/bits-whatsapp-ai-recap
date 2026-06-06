# Changelog

All notable changes to this project will be documented in this file.

## [v0.2.3] - 2026-06-06

### Fixed

- Fetch real group name from WhatsApp metadata instead of using JID as placeholder
- Fix existing groups with JID-as-name on reconnect
- Change summary schedule to 6AM with rolling 24-hour window

## [v0.2.2] - 2026-06-03

### Fixed

- Add disclaimer to messages sent by WhatsApp client

## [v0.2.1] - 2026-06-02

### Fixed

- Implement retry logic for sending messages when socket is not connected
- Clear stale device-list and app-state-sync cache on startup

## [v0.2.0] - 2026-06-02

### Added

- n8n sub-workflow pattern for approval forms

### Fixed

- Ensure WhatsApp socket is connected before sending messages

## [v0.1.1] - 2026-06-01

### Fixed

- Update default model in configuration
- Enhance summary prompt requirements

## [v0.1.0] - 2026-05-31

### Added

- Initialize WhatsApp AI recap service with core functionality
- Multi-stage Dockerfile build
- Project specs and documentation
