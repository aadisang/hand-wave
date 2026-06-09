import AVFoundation
import Foundation

@MainActor
final class Speech {
  private let synth = AVSpeechSynthesizer()
  private var last = ""

  init() {
    synth.usesApplicationAudioSession = true
  }

  func prepareForStreaming() {
    configureAudioRoute()
  }

  func speak(_ text: String) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean != last else { return }
    last = clean

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

  private func configureAudioRoute() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(
        .playAndRecord,
        mode: .default,
        options: [.allowBluetoothHFP, .duckOthers]
      )
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      if let input = session.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) {
        try session.setPreferredInput(input)
      }
    } catch {
      return
    }
  }
}
