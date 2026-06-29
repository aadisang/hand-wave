import AVFoundation
import Foundation

@MainActor
final class Speech: NSObject, AVSpeechSynthesizerDelegate {
  private let synth = AVSpeechSynthesizer()
  private var speaking = false

  var onSpeakingChanged: ((Bool) -> Void)?

  override init() {
    super.init()
    synth.delegate = self
  }

  func speak(_ text: String) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return }

    if synth.isSpeaking {
      synth.stopSpeaking(at: .immediate)
    }

    synth.speak(AVSpeechUtterance(string: clean))
    setSpeaking(true)
  }

  func reset() {
    synth.stopSpeaking(at: .immediate)
    setSpeaking(false)
  }

  private func setSpeaking(_ speaking: Bool) {
    guard self.speaking != speaking else { return }
    self.speaking = speaking
    onSpeakingChanged?(speaking)
  }

}

extension Speech {
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didStart utterance: AVSpeechUtterance
  ) {
    Task { @MainActor [weak self] in
      self?.setSpeaking(true)
    }
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    Task { @MainActor [weak self] in
      self?.setSpeaking(false)
    }
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    Task { @MainActor [weak self] in
      self?.setSpeaking(false)
    }
  }
}
