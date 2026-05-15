import AVFoundation
import Foundation

@MainActor
final class SpeechOutput: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var lastSpokenText = ""

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  func speak(_ text: String) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean != lastSpokenText else { return }
    lastSpokenText = clean

    configureAudioSession()
    if synthesizer.isSpeaking {
      synthesizer.stopSpeaking(at: .immediate)
    }

    let utterance = AVSpeechUtterance(string: clean)
    utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    synthesizer.speak(utterance)
  }

  func reset() {
    lastSpokenText = ""
    synthesizer.stopSpeaking(at: .immediate)
  }

  private func configureAudioSession() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(
        .playback,
        mode: .spokenAudio,
        options: [.allowBluetooth, .allowBluetoothA2DP, .duckOthers]
      )
      try session.setActive(true)
    } catch {
      // Speech still works on the default route if Bluetooth routing setup fails.
    }
  }
}
