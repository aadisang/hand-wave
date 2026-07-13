@preconcurrency import AVFoundation
import Foundation

@MainActor
final class SpeechCoordinator: NSObject, AVSpeechSynthesizerDelegate {
  private static let partialDelay: Duration = .milliseconds(700)
  private static let partialConfidence = 0.6

  private let synthesizer = AVSpeechSynthesizer()
  private var currentUtterance: AVSpeechUtterance?
  private var pendingTask: Task<Void, Never>?
  private var pendingText: String?
  private var spokenText: String?

  var onSpeakingChanged: ((Bool) -> Void)?
  var onPartialSpoken: (() -> Void)?

  override init() {
    super.init()
    synthesizer.usesApplicationAudioSession = false
    synthesizer.delegate = self
  }

  func handle(_ event: RecognitionEvent, current: @escaping () -> Prediction?) {
    switch event {
    case .clear:
      cancelPending()
      spokenText = nil
    case .partial(let prediction):
      schedule(prediction, current: current)
    case .finalized(let prediction):
      cancelPending()
      speak(prediction.text)
    }
  }

  func reset() {
    cancelPending()
    spokenText = nil
    currentUtterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    onSpeakingChanged?(false)
  }

  private func schedule(_ prediction: Prediction, current: @escaping () -> Prediction?) {
    let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }
    guard prediction.confidence >= Self.partialConfidence else {
      cancelPending()
      return
    }
    pendingText = text
    guard pendingTask == nil else { return }

    pendingTask = Task { [weak self] in
      try? await Task.sleep(for: Self.partialDelay)
      guard !Task.isCancelled, let self else { return }
      guard let prediction = current(), prediction.confidence >= Self.partialConfidence else {
        self.cancelPending()
        return
      }
      let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty, self.pendingText == text else {
        self.cancelPending()
        return
      }
      self.pendingTask = nil
      self.pendingText = nil
      self.speak(text)
      self.onPartialSpoken?()
    }
  }

  private func speak(_ rawText: String) {
    let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }

    let utteranceText: String
    if synthesizer.isSpeaking,
      let spokenText,
      text.hasPrefix(spokenText + " ")
    {
      utteranceText = String(text.dropFirst(spokenText.count + 1))
    } else {
      utteranceText = text
    }

    spokenText = text
    let utterance = AVSpeechUtterance(string: utteranceText)
    currentUtterance = utterance
    synthesizer.speak(utterance)
    AppLog.speech.info("Speaking recognition result")
  }

  private func cancelPending() {
    pendingTask?.cancel()
    pendingTask = nil
    pendingText = nil
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    willSpeakRangeOfSpeechString characterRange: NSRange,
    utterance: AVSpeechUtterance
  ) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard self?.currentUtterance.map(ObjectIdentifier.init) == id else { return }
      self?.onSpeakingChanged?(true)
    }
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finish(ObjectIdentifier(utterance), cancelled: false)
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finish(ObjectIdentifier(utterance), cancelled: true)
  }

  nonisolated private func finish(_ id: ObjectIdentifier, cancelled: Bool) {
    Task { @MainActor [weak self] in
      guard self?.currentUtterance.map(ObjectIdentifier.init) == id else { return }
      self?.currentUtterance = nil
      if cancelled {
        self?.spokenText = nil
      }
      self?.onSpeakingChanged?(false)
    }
  }
}
