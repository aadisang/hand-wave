import Testing

@testable import HandWave

struct FrameGateTests {
  @Test
  func throttlesPreviewAndRecognitionSeparately() async {
    let gate = FrameGate(previewFPS: 10, recognitionFPS: 5)

    let first = await gate.accept(now: 1)
    #expect(first.preview)
    #expect(first.recognition)

    let busy = await gate.accept(now: 1.5)
    #expect(!busy.preview)
    #expect(!busy.recognition)

    await gate.finishPreview()
    let previewOnly = await gate.accept(now: 1.11)
    #expect(previewOnly.preview)
    #expect(!previewOnly.recognition)

    await gate.finishRecognition()
    let recognitionReady = await gate.accept(now: 1.21)
    #expect(!recognitionReady.preview)
    #expect(recognitionReady.recognition)
  }

  @Test
  func updatesFrameRate() async {
    let gate = FrameGate(previewFPS: 10, recognitionFPS: 10)

    await gate.setFrameRate(20)

    let first = await gate.accept(now: 1)
    #expect(first.preview)
    #expect(first.recognition)
    await gate.finishPreview()
    await gate.finishRecognition()

    let tooSoon = await gate.accept(now: 1.04)
    #expect(!tooSoon.preview)
    #expect(!tooSoon.recognition)

    let ready = await gate.accept(now: 1.05)
    #expect(ready.preview)
    #expect(ready.recognition)
  }
}
