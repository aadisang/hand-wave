Keep compact replay fixtures here to run recorded MediaPipe features through the
real inference runtime.

Use one target phrase per recording. The recording `label` is treated as the
expected decoded text unless the fixture later adds an explicit `expectedText`
field or `expectedTexts` array.

Do not commit raw dev-panel downloads. They include full frame/debug payloads and
are ignored by Git. Reduce them to the smallest `recordings[].frames[].features`
fixture that still catches the regression.
