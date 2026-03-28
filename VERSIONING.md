# Versioning Strategy

## Project SemVer
- MAJOR: breaking API/config/schema changes
- MINOR: new features backward-compatible
- PATCH: bug fixes only

## API Versioning
KawaiiGPT is currently local desktop-first. If a local API server is added:
- Prefix routes with `/v1/`, `/v2/`
- Never introduce breaking changes to an existing version

## Prompt Versioning
System prompts should be versioned:
- `system_prompt_v1`
- `system_prompt_v2`

Breaking prompt behavior changes require a new version.

## Schema/Data Versioning
Persisted stores use versioned migrations:
- Zustand persist `version` field increments on shape changes
- Add migration function before release when shape changes

## Releases
- Tag stable releases: `v0.1.0`, `v0.2.0`, etc.
- Update CHANGELOG.md for every release
