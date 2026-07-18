import Testing

@testable import HandWave

struct RecognitionTests {
  @Test(arguments: ["A", "z", " ", "\n"])
  func singleCharacterPredictionsAreNoise(_ text: String) {
    let prediction = Prediction(text: text, confidence: 1, processingTimeMs: 0)

    #expect(!prediction.isMeaningful)
  }

  @Test(arguments: ["hi", "ASL", "thank you"])
  func multiCharacterPredictionsAreMeaningful(_ text: String) {
    let prediction = Prediction(text: text, confidence: 1, processingTimeMs: 0)

    #expect(prediction.isMeaningful)
  }

  @Test
  func onlyFinalizedPredictionsProduceSpeechText() {
    let prediction = Prediction(text: "  thank you  ", confidence: 0.9, processingTimeMs: 4)

    #expect(RecognitionEvent.clear.finalizedSpeechText == nil)
    #expect(RecognitionEvent.partial(prediction).finalizedSpeechText == nil)
    #expect(RecognitionEvent.finalized(prediction).finalizedSpeechText == "thank you")
  }

  @Test
  func singleCharacterFinalizationDoesNotProduceSpeechText() {
    let prediction = Prediction(text: "I", confidence: 1, processingTimeMs: 1)

    #expect(RecognitionEvent.finalized(prediction).finalizedSpeechText == nil)
  }
}
