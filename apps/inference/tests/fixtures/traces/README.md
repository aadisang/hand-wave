Keep compact replay fixtures here to run recorded MediaPipe features through the
real inference runtime. The test requires the expected text to remain in the
deployed decoder's beam or greedy path, where the stream policy can recover it.
It does not require the first full-recording beam to win because these fixtures
drop most live frames and cannot reproduce stream timing or candidate counts.

Use one target phrase per recording. The recording `label` is treated as the
expected decoded text unless the fixture later adds an explicit `expectedText`
field or `expectedTexts` array.

Do not commit raw dev-panel downloads. They include full frame/debug payloads and
are ignored by Git. Reduce them to the smallest `recordings[].frames[].features`
fixture that still catches the regression.
