# Project Instructions

This repository is driven by the Gemini CLI, and the guidance below is concatenated into
every prompt the agent receives. Treat it as the authoritative description of how work in
this project should be carried out, from the first commit through release, so that behavior
stays consistent no matter which directory the agent happens to be operating in right now.

## Build and Test

Always run the full build before you commit anything. The automated test suite lives under
the tests directory and every case must pass locally before a change is opened for review.
Prefer small, focused commits and keep the working tree clean so that reviewers can follow
the intent of each change without wading through unrelated noise. See
[contributing guide](docs/contributing.md) for the complete workflow.

@shared/build-rules.md

## Coding Style

Use two-space indentation and descriptive, intention-revealing names throughout the code.
Keep functions short and free of side effects wherever that is practical, and document any
decision that is not obvious inline so that a future reader can reconstruct the reasoning
without spelunking through the entire git history to understand a single line of code.

@import ./shared/style-rules.md
