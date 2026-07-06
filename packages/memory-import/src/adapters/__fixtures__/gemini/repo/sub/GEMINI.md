# Submodule Notes

These instructions apply only inside this submodule and are appended after the repo-level
guidance whenever the agent works on files in this directory. They intentionally narrow the
general rules to the concerns of the data-access layer that this module owns end to end.

## Database Layer

This module owns the database access layer. Always use the repository pattern and never
issue raw SQL from controllers or handlers. Migrations live alongside the schema and must
be reviewed by a second engineer before they are applied to any shared environment, whether
that is staging or production, so that no destructive change reaches real data unreviewed.
