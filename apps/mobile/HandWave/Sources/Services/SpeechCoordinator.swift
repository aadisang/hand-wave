@preconcurrency import AVFoundation
import Foundation

@MainActor
final class SpeechCoordinator {
  private static let partialDelay: Duration = .milliseconds(450)
  private static let partialConfidence = 0.6

  private var pendingTask: Task<Void, Never>?
  private var pendingText: String?
  private var spokenText: String?
  private lazy var engine = SpeechEngine { [weak self] text in
    Task { @MainActor [weak self] in
      self?.onSpeakingTextChanged?(text)
    }
  }

  var onSpeakingTextChanged: ((String?) -> Void)?

  init() {
    engine.prewarm()
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
      let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if text != spokenText, !(spokenText.map { text.hasPrefix($0 + " ") } ?? false) {
        speak(text)
      }
    }
  }

  func reset() {
    cancelPending()
    spokenText = nil
    engine.reset()
    onSpeakingTextChanged?(nil)
  }

  private func schedule(_ prediction: Prediction, current: @escaping () -> Prediction?) {
    let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }
    guard prediction.confidence >= Self.partialConfidence else {
      cancelPending()
      return
    }
    if pendingText != text {
      cancelPending()
      pendingText = text
    }
    guard pendingTask == nil else { return }

    pendingTask = Task { [weak self] in
      try? await Task.sleep(for: Self.partialDelay)
      guard !Task.isCancelled, let self else { return }
      guard let prediction = current(), prediction.confidence >= Self.partialConfidence else {
        cancelPending()
        return
      }
      let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty, pendingText == text else {
        cancelPending()
        return
      }
      pendingTask = nil
      pendingText = nil
      speak(text)
    }
  }

  private func speak(_ rawText: String) {
    let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }
    spokenText = text
    engine.speak(text)
  }

  private func cancelPending() {
    pendingTask?.cancel()
    pendingTask = nil
    pendingText = nil
  }
}

private final class SpeechEngine: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
  private let queue = DispatchQueue(label: "sh.handwave.speech", qos: .userInitiated)
  private let onSpeakingTextChanged: @Sendable (String?) -> Void
  private var utteranceText: [ObjectIdentifier: String] = [:]
  private var activeUtteranceID: ObjectIdentifier?
  private lazy var synthesizer: AVSpeechSynthesizer = {
    let synthesizer = AVSpeechSynthesizer()
    synthesizer.usesApplicationAudioSession = false
    synthesizer.delegate = self
    return synthesizer
  }()

  init(onSpeakingTextChanged: @escaping @Sendable (String?) -> Void) {
    self.onSpeakingTextChanged = onSpeakingTextChanged
    super.init()
  }

  func prewarm() {
    queue.async { [self] in
      let utterance = AVSpeechUtterance(string: "ready")
      utterance.volume = 0.001
      synthesizer.speak(utterance)
    }
  }

  func speak(_ text: String) {
    queue.async { [self] in
      let utterance = AVSpeechUtterance(string: text)
      utterance.volume = 0.9
      utteranceText[ObjectIdentifier(utterance)] = text
      synthesizer.speak(utterance)
      AppLog.speech.info("Speaking recognition result")
    }
  }

  func reset() {
    queue.async { [self] in
      utteranceText.removeAll()
      activeUtteranceID = nil
      synthesizer.stopSpeaking(at: .immediate)
      onSpeakingTextChanged(nil)
    }
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    willSpeakRangeOfSpeechString characterRange: NSRange,
    utterance: AVSpeechUtterance
  ) {
    let id = ObjectIdentifier(utterance)
    queue.async { [self] in
      guard let text = utteranceText[id] else { return }
      activeUtteranceID = id
      onSpeakingTextChanged(text)
    }
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finish(ObjectIdentifier(utterance), cancelled: false)
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finish(ObjectIdentifier(utterance), cancelled: true)
  }

  private func finish(_ id: ObjectIdentifier, cancelled: Bool) {
    queue.async { [self] in
      guard utteranceText.removeValue(forKey: id) != nil else { return }
      if activeUtteranceID == id {
        activeUtteranceID = nil
        onSpeakingTextChanged(nil)
      }
    }
  }
}
