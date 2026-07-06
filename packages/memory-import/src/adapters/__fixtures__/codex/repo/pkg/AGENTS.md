# Package-Specific Instructions

This nested AGENTS.md applies only to the `pkg` subtree and refines the
repository-wide guidance. Codex concatenates this file after the root file so
that its guidance takes precedence for anything under this directory. The body
is padded so the single overview section clears the fragment-folding threshold
and is emitted as one addressable fact with a `level:nested` tag.

## Local Conventions

Within this package, favour the local helpers defined here over the generic
utilities. This section is long enough on its own to become a separate chunk
when the adapter parses the file in split chunk mode, keeping section anchors
stable across re-imports of the nested instruction file.
