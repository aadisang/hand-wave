import AVFoundation
import Foundation

@MainActor
final class Speech: NSObject, AVSpeechSynthesizerDelegate {
  private let synth = AVSpeechSynthesizer()
  private var last = ""

  override init() {
    super.init()
    synth.delegate = self
  }

  func speak(_ text: String) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean != last else { return }
    last = clean

    configAudio()
    if synth.isSpeaking {
      synth.stopSpeaking(at: .immediate)
    }

    let utterance = AVSpeechUtterance(string: clean)
    utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    synth.speak(utterance)
  }

  func reset() {
    last = ""
    synth.stopSpeaking(at: .immediate)
  }

  private func configAudio() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(
        .playback,
        mode: .spokenAudio,
        options: [.allowBluetoothHFP, .allowBluetoothA2DP, .duckOthers]
      )
      try session.setActive(true)
    } catch {
      // Speech still works on the default route if Bluetooth routing setup fails.
    }
  }
}
