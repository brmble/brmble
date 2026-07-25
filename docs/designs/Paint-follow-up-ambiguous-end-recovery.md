# Collaborative Paint Follow-up: Ambiguous Session End

## Problem

After the final image has been successfully posted, `paintApi.end()` can time out even when the server has already ended the paint session. A retry currently sends another end request; the server may reject that request as already ended, leaving the editor open despite a successful save.

## Required behavior

When the image post is already confirmed, treat a terminal session state (`ended`, and any equivalent confirmed terminal response) as a successful completion. Close the editor and return to chat without uploading or posting the image again.

## Suggested implementation

Keep the existing post-confirmed state. If ending fails ambiguously, fetch the paint snapshot and close successfully when it reports a terminal status. Preserve the current visible, retryable error for genuine non-terminal end failures.

## Regression coverage

Add a save-flow test where the first end response is lost after the server ends the session, the snapshot reports `ended`, and the UI closes without a second upload or Matrix message.
