@preconcurrency import AVFoundation
import Foundation

@MainActor
final class SpeechCoordinator {
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

  func handle(_ event: RecognitionEvent) {
    if case .clear = event {
      spokenText = nil
      return
    }
    guard let text = event.finalizedSpeechText else { return }
    speak(text)
  }

  func reset() {
    spokenText = nil
    engine.reset()
    onSpeakingTextChanged?(nil)
  }

  private func speak(_ rawText: String) {
    let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }
    spokenText = text
    engine.speak(text)
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
