Downloaded dev-panel trace exports can be dropped here for local validation, but
raw JSON traces are ignored by Git because they are too large for source review.

Recommended capture flow:

1. Enable the dev panel.
2. Paste one target phrase per line, press `Start`, sign the active phrase, press
   `Next` between phrases, then press `Finish`.
3. Press `Trace` and save the downloaded JSON locally.

Before committing a regression case, reduce the raw trace to a compact fixture
with only `recordings[].frames[].features`, then put that compact file under
`apps/inference/tests/fixtures/traces/`.
