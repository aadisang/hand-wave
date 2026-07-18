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
}
