## ADDED Requirements

### Requirement: Page anatomy and disclaimers
The `/projects/tos-watch` page SHALL follow the house page anatomy: header with project name, one-paragraph explanation, visible (not buried) standing disclaimers (automated analysis may contain errors; not legal advice; not affiliated with or endorsed by any listed service; verify against linked official documents), an RSS subscribe link, and "monitoring N documents across M services · last check {relative time}". Impact and severity labels SHALL be presented as automated assessments. No logos or brand assets - text names only.

#### Scenario: Disclaimers visible without interaction
- **WHEN** the page loads
- **THEN** the standing disclaimers are visible in the header region without expanding anything

### Requirement: Service grid
The page SHALL render a Card per service showing document labels with last-checked and last-changed dates, a status Tag (monitored = success, changed recently = info with date, unreachable = warn), and each document name linking to the official URL.

#### Scenario: Unreachable document is flagged
- **GIVEN** a document with status `unreachable` in state.json
- **WHEN** the grid renders
- **THEN** that document shows a warn Tag while the rest of the service renders normally

### Requirement: Changelog feed with filtering
The page SHALL render reverse-chronological changelog entries - service name, document, "detected {date}", summary, and severity/impact Tags using the lease-demo color language - with expansion revealing each change's explanation, practical effect, and quoted excerpts styled as short quotations with a link to the official document beside them. Cosmetic entries SHALL render as a single muted line. PrimeVue filter controls SHALL filter by service, category, impact, and severity.

#### Scenario: Filtering by category
- **GIVEN** a changelog containing entries in multiple categories
- **WHEN** the user filters by `privacy_and_data`
- **THEN** only entries containing a change in that category are shown

#### Scenario: Excerpts are attributed
- **WHEN** an entry is expanded
- **THEN** each quoted excerpt is visually styled as a quotation with a link to the official document beside it

### Requirement: Honest empty and loading states
Before the first detected change, the feed SHALL show "No changes detected yet - monitoring began {date}" with the service grid live - no fabricated activity. While state/changelog JSON is being fetched, the page SHALL show a loading state rather than an empty flash.

#### Scenario: Empty state before first change
- **GIVEN** a state.json with all documents monitored and an empty changelog
- **WHEN** the page renders
- **THEN** the grid shows live statuses and the feed shows the monitoring-began message

#### Scenario: Loading state while data fetches
- **GIVEN** the JSON files have not yet resolved
- **WHEN** the page renders
- **THEN** skeleton/loading UI is shown instead of the empty state

### Requirement: Standard accordion and integrations
The page SHALL include the standard collapsed accordion with the raw latest JSON and the architecture write-up (economics, editorial engineering, assembly story, limitations), the eval badge per house convention, and a homepage teaser card ("ToS Watchdog · N documents monitored · last change detected {date}") linking to the page.

#### Scenario: Homepage teaser links through
- **WHEN** the homepage renders
- **THEN** the teaser card shows the monitored-document count and links to `/projects/tos-watch`
