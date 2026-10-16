# Project rules

- Preserve existing local edits; no resets, dependency upgrades or refactors during baseline debugging.
- Never print or commit secrets or environment-file contents.
- Preserve get_table_names, live table validation and the configured read-only MySQL account.
- Change only demonstrated runtime blockers and verify actual output files, not model success claims.
