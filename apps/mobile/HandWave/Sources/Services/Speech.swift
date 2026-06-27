import AVFoundation
import Foundation

@MainActor
final class Speech: NSObject, AVSpeechSynthesizerDelegate {
  private let synth = AVSpeechSynthesizer()
  private lazy var voice = Self.preferredVoice()
  private var speaking = false

  var onSpeakingChanged: ((Bool) -> Void)?

  override init() {
    super.init()
    synth.delegate = self
    synth.usesApplicationAudioSession = true
  }

  func prepare() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
    try? session.setActive(true)
  }

  func speak(_ text: String) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else { return }

    if synth.isSpeaking {
      synth.stopSpeaking(at: .immediate)
    }

    let utterance = AVSpeechUtterance(string: clean)
    utterance.voice = voice
    utterance.rate = 0.48
    utterance.pitchMultiplier = 0.98
    utterance.volume = 1
    synth.speak(utterance)
    setSpeaking(true)
  }

  func reset() {
    synth.stopSpeaking(at: .immediate)
    setSpeaking(false)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func setSpeaking(_ speaking: Bool) {
    guard self.speaking != speaking else { return }
    self.speaking = speaking
    onSpeakingChanged?(speaking)
  }

  private static func preferredVoice() -> AVSpeechSynthesisVoice? {
    AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language == "en-US" }
      .max { voiceScore($0) < voiceScore($1) }
      ?? AVSpeechSynthesisVoice(language: "en-US")
  }

  private static func voiceScore(_ voice: AVSpeechSynthesisVoice) -> Int {
    switch voice.quality {
    case .premium:
      3
    case .enhanced:
      2
    case .default:
      1
    @unknown default:
      preconditionFailure("Unhandled speech voice quality: \(voice.quality)")
    }
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
