## ADDED Requirements

### Requirement: Configured document set
The system SHALL read its monitored set from `watchdog/services.json`, where each service entry has `id`, `name`, an `enabled` flag, and one or more documents each with `label`, `url`, and an optional CSS `selector` for main-content extraction. The system SHALL never fetch any URL not present in this configuration.

#### Scenario: Disabled service is skipped without losing history
- **GIVEN** a service entry with `enabled: false`
- **WHEN** the nightly run executes
- **THEN** its documents are not fetched, and its existing state and changelog history remain untouched

### Requirement: Respectful fetching
The system SHALL fetch each enabled document at most once per run using an honest User-Agent identifying the project name and site URL, a modest timeout, and exactly one retry on failure. The system SHALL check robots.txt per host and SHALL skip any disallowed path, surfacing the skip as a configuration issue rather than working around it.

#### Scenario: robots.txt disallows a configured path
- **GIVEN** a host whose robots.txt disallows the configured document path
- **WHEN** the run reaches that document
- **THEN** the document is skipped, no fetch of the document URL occurs, and the skip is surfaced to the owner as a config issue

#### Scenario: Fetch failure does not raise a change
- **GIVEN** a document whose fetch fails after the retry
- **WHEN** the run processes the failure
- **THEN** the document's consecutive-failure count increments, its status becomes `unreachable`, no change entry is produced, and the run continues with the next document

#### Scenario: Three consecutive failures escalate once
- **GIVEN** a document that has now failed 3 consecutive nightly runs
- **WHEN** the third failure is recorded
- **THEN** a deduped ops issue (label `tos-watch`, fingerprint-based like site-health) is filed, and subsequent failures do not file duplicates

### Requirement: Extraction and normalization
The system SHALL extract main-content text via the configured CSS selector (falling back to a sensible article/main heuristic), strip navigation and boilerplate, collapse whitespace, and strip volatile fragments (copyright-year lines; "last updated" timestamps are captured separately, never hashed). Normalization rules SHALL live in one tested module.

#### Scenario: Date-bump-only revision hashes identically
- **GIVEN** two versions of a document differing only in a "last updated" date line
- **WHEN** both are normalized and hashed
- **THEN** the hashes are identical and no change is detected

### Requirement: Hash-compare change detection
The system SHALL compare the normalized text hash against the stored snapshot. When unchanged, it SHALL only update `last-checked` and invoke no model - this zero-AI-cost path is the common case. When changed, it SHALL invoke the explain pipeline.

#### Scenario: Unchanged document costs nothing
- **GIVEN** a document whose normalized hash matches the stored snapshot
- **WHEN** the comparison completes
- **THEN** `last-checked` is updated, no model call is made, and no changelog entry is produced

### Requirement: Per-document failure isolation
The nightly run SHALL complete even if individual documents fail, and SHALL emit a summary line with checked/changed/cosmetic/failed counts.

#### Scenario: One failure does not abort the run
- **GIVEN** a run where one document fetch throws
- **WHEN** the run continues
- **THEN** all remaining documents are still processed and the summary line reflects one failure

### Requirement: Local dry-run mode
The system SHALL provide a `tos-watch:run --dry` mode that executes the full pipeline against live URLs without committing, pushing, or filing issues, printing per-document outcomes.

#### Scenario: Dry run leaves no side effects
- **GIVEN** a dry-run invocation
- **WHEN** it completes
- **THEN** per-document outcomes are printed and no commits, pushes, or issues were created
