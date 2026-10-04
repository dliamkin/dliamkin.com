## ADDED Requirements

### Requirement: Mechanical diff before model
The pipeline SHALL compute a paragraph-level mechanical diff between the previous and current normalized text and send the model only the changed blocks with surrounding context and document metadata - never both full documents (token-cost control; ToS documents run tens of thousands of words).

#### Scenario: Model input is diff blocks, not full documents
- **GIVEN** a detected change in a 30,000-word document with three changed paragraphs
- **WHEN** the pipeline builds the model input
- **THEN** the input contains only the changed blocks with context and metadata, not the full documents

### Requirement: Model invocation
The pipeline SHALL use `claude-sonnet-4-6` by default with a `TOS_WATCH_MODEL` env override (Haiku as budget fallback), forced tool use, and `max_tokens` 4000, invoked only on change days. Output SHALL conform to the shared `TosChangeReport` schema, with `impact` values `favors_provider | favors_user | neutral | unclear` and `severity` `high | medium | low`.

#### Scenario: Model API failure surfaces as a run failure, not a false entry
- **GIVEN** the Anthropic API times out or errors on a change day
- **WHEN** the pipeline call fails after retry
- **THEN** the document is marked failed for this run, no changelog entry is published, and the snapshot is NOT rotated so the change is re-detected next run

### Requirement: Cosmetic gate
When every change is cosmetic (formatting, renumbering, typo fixes, date updates, wording shuffles with identical meaning), the report SHALL set `substantive: false`, and the system SHALL record a minimal "cosmetic change detected" entry with no excerpts and no severity.

#### Scenario: Renumbering-only change gates as cosmetic
- **GIVEN** a change consisting only of section renumbering and identically-meaning rewording
- **WHEN** the pipeline runs
- **THEN** the report has `substantive: false` and the published entry is a minimal cosmetic note with no excerpts

### Requirement: Neutral output contract
The system prompt SHALL require: neutral factual descriptions only; no motive attribution or loaded language; excerpts quoted from the NEW text at ≤ 25 words (optional old-text excerpt, same cap); no claims about when the change was made; unclear meaning marked `impact: unclear` rather than guessed; no advice about accepting terms or leaving services.

#### Scenario: Unclear change is marked unclear
- **GIVEN** a changed clause whose practical effect is genuinely ambiguous
- **WHEN** the model reports it
- **THEN** the change's `impact` is `unclear` and the explanation says the effect is unclear

### Requirement: Editorial post-processing
Before publish, code SHALL hard-truncate any excerpt exceeding 25 words (with ellipsis) and scan all output against a forbidden loaded-language list. A loaded-language violation SHALL block auto-publish: the entry is logged and an ops issue is filed for owner review instead.

#### Scenario: Overlong excerpt is truncated in code
- **GIVEN** model output containing a 40-word excerpt
- **WHEN** post-processing runs
- **THEN** the published excerpt is truncated to 25 words with an ellipsis

#### Scenario: Loaded language blocks publication
- **GIVEN** model output containing a forbidden word (e.g. "quietly")
- **WHEN** post-processing runs
- **THEN** the entry is not published, the output is logged, and a deduped ops issue is filed for review
