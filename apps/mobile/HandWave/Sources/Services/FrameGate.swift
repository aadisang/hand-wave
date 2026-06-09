import Foundation

actor FrameGate {
  struct Decision: Sendable {
    let preview: Bool
    let recognition: Bool

    var hasWork: Bool {
      preview || recognition
    }
  }

  private let previewInterval: TimeInterval
  private let recognitionInterval: TimeInterval
  private var previewBusy = false
  private var recognitionBusy = false
  private var lastPreviewAt = 0.0
  private var lastRecognitionAt = 0.0

  init(previewFPS: Double, recognitionFPS: Double) {
    self.previewInterval = 1.0 / previewFPS
    self.recognitionInterval = 1.0 / recognitionFPS
  }

  func accept(now: TimeInterval = Date().timeIntervalSinceReferenceDate) -> Decision {
    var preview = false
    var recognition = false

    if !previewBusy, now - lastPreviewAt >= previewInterval {
      previewBusy = true
      lastPreviewAt = now
      preview = true
    }

    if !recognitionBusy, now - lastRecognitionAt >= recognitionInterval {
      recognitionBusy = true
      lastRecognitionAt = now
      recognition = true
    }

    return Decision(preview: preview, recognition: recognition)
  }

  func finishPreview() {
    previewBusy = false
  }

  func finishRecognition() {
    recognitionBusy = false
  }

  func reset() {
    previewBusy = false
    recognitionBusy = false
    lastPreviewAt = 0
    lastRecognitionAt = 0
  }
}
