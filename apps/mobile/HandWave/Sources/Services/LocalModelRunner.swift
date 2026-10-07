import CoreML
import Foundation

actor LocalModelRunner {
  private static let featureCount = 162
  private static let missingLandmark: Float = -8192
  private static let vocabSize = 60
  private var model: SendableModel?

  func prepare() async throws {
    _ = try await loadModel()
  }

  func infer(_ frames: [LandmarkFrame]) async throws -> InferenceEmission {
    let input = try landmarkValues(frames)
    let model = try await loadModel()
    let array = try MLMultiArray(
      shape: [1, NSNumber(value: frames.count), NSNumber(value: Self.featureCount)],
      dataType: .float32
    )
    input.withUnsafeBytes { source in
      array.dataPointer.copyMemory(from: source.baseAddress!, byteCount: source.count)
    }
    let provider = try MLDictionaryFeatureProvider(dictionary: [
      "landmarks": MLFeatureValue(multiArray: array)
    ])
    let result = try await model.value.prediction(from: provider)
    guard let output = result.featureValue(for: "log_probs")?.multiArrayValue else {
      throw InferenceFailure.unexpected("Local model returned no output.")
    }
    return try Self.emission(from: output)
  }

  private func loadModel() async throws -> SendableModel {
    if let model { return model }
    guard let url = Bundle.main.url(forResource: "HandWaveLocal", withExtension: "mlmodelc") else {
      throw InferenceFailure.unexpected("Local model is missing from this build.")
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    configuration.allowLowPrecisionAccumulationOnGPU = true
    let loaded = SendableModel(
      try MLModel(contentsOf: url, configuration: configuration)
    )
    model = loaded
    return loaded
  }

  private func landmarkValues(_ frames: [LandmarkFrame]) throws -> [Float] {
    guard (18...192).contains(frames.count) else {
      throw InferenceFailure.unexpected("The phone model needs 18 to 192 frames.")
    }
    var values = [Float]()
    values.reserveCapacity(frames.count * Self.featureCount)
    for frame in frames {
      let features = frame.inferenceFeatures
      guard features.count == Self.featureCount else {
        throw InferenceFailure.unexpected("Local inference received invalid landmarks.")
      }
      values.append(
        contentsOf: features.lazy.map { value in
          value.isFinite ? Float(value) : Self.missingLandmark
        })
    }
    return values
  }

  static func emission(from output: MLMultiArray) throws -> InferenceEmission {
    guard output.shape.count == 3 else {
      throw InferenceFailure.unexpected("Local model returned an invalid shape.")
    }
    let rows = output.shape[1].intValue
    let columns = output.shape[2].intValue
    guard (1...96).contains(rows), columns == Self.vocabSize,
      output.shape[0].intValue == 1, output.count == rows * columns
    else {
      throw InferenceFailure.unexpected("Local model returned an invalid shape.")
    }

    var values = [[Double]]()
    values.reserveCapacity(rows)
    var confidence = 0.0
    for row in 0..<rows {
      let scores = (0..<columns).map { column in
        output[[0, NSNumber(value: row), NSNumber(value: column)]].doubleValue
      }
      guard scores.allSatisfy(\.isFinite) else {
        throw InferenceFailure.unexpected("The phone model returned invalid scores.")
      }
      values.append(scores)
      confidence += exp(scores.max() ?? -.infinity)
    }
    return InferenceEmission(
      values: values,
      frameConfidence: min(1, max(0, confidence / Double(rows)))
    )
  }

}

private final class SendableModel: @unchecked Sendable {
  let value: MLModel

  init(_ value: MLModel) {
    self.value = value
  }
}
