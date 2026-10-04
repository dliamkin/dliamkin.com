## ADDED Requirements

### Requirement: No document text in public artifacts
Public artifacts (repo files under `public/tos-watch/` and the built site) SHALL contain only generated summaries and quoted excerpts of at most 25 words, each attributed with a link to the official document. Full document text SHALL exist only in the private snapshot repo, retained solely to enable diffing.

#### Scenario: Public artifacts pass the excerpt audit
- **GIVEN** a populated changelog after several detected changes
- **WHEN** `public/tos-watch/*.json` and `dist/` are audited
- **THEN** no quoted excerpt exceeds 25 words and no full document text is present anywhere

### Requirement: Private snapshot storage
The system SHALL store, per document in the private snapshot repo, the latest normalized text plus a rolling history of the last ~10 dated snapshots, committed and pushed from CI via the fine-grained PAT secret `TOS_SNAPSHOT_PAT`.

#### Scenario: Snapshot rotation on change
- **GIVEN** a document with 10 stored snapshots that changes tonight
- **WHEN** persistence runs
- **THEN** the new snapshot is written with a dated filename, the oldest is removed, and the latest pointer is updated

#### Scenario: Snapshot push failure aborts publication for that document
- **GIVEN** the push to the private repo fails
- **WHEN** persistence for that document errors
- **THEN** no changelog entry is committed for it this run (state stays consistent; the change re-detects next run)

### Requirement: Public state and changelog files
The system SHALL maintain `public/tos-watch/state.json` (per document: last-checked, last-changed, current hash, consecutive-failure count, status) and `public/tos-watch/changelog.json` (append-only, newest first, capped at ~500 entries with the oldest overflowed to an archive file). Entries SHALL use `detected_at` dating - "change detected on", never a claim of when the change occurred.

#### Scenario: Changelog cap overflows to archive
- **GIVEN** a changelog at the 500-entry cap
- **WHEN** a new entry is prepended
- **THEN** the oldest entry moves to the archive file and the main file stays at the cap

### Requirement: RSS feed as first-class deliverable
The system SHALL regenerate `public/tos-watch/feed.xml` (RSS/Atom) whenever a changelog entry is added. The feed SHALL validate against the format spec and render in feed readers.

#### Scenario: Feed regenerates on change
- **GIVEN** a new substantive changelog entry
- **WHEN** persistence completes
- **THEN** `feed.xml` contains the new entry's summary with its detected date and a link to the page

### Requirement: Commit convention
Public artifacts SHALL be committed with `[skip ci]` following the site-health convention, and the nightly workflow SHALL NOT trigger itself or other workflows via its commits.

#### Scenario: Nightly commit does not self-trigger
- **GIVEN** the workflow commits updated public files
- **WHEN** the push lands
- **THEN** no deploy or workflow run is triggered by that commit
