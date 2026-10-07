import CoreML
import Foundation

actor LocalInferClient: InferAPI {
  private let model = LocalModelRunner()
  private let transport = InferClient(endpoint: .device)

  func warmConnection() async throws(InferenceFailure) {
    async let modelResult = prepareModel()
    async let transportResult = prepareTransport()
    let results = await (modelResult, transportResult)
    for result in [results.0, results.1] {
      if case .failure(let failure) = result {
        throw failure
      }
    }
  }

  private func prepareModel() async -> Result<Void, InferenceFailure> {
    do {
      try await model.prepare()
      return .success(())
    } catch is CancellationError {
      return .failure(.cancelled)
    } catch {
      return .failure(.unexpected(error.localizedDescription))
    }
  }

  private func prepareTransport() async -> Result<Void, InferenceFailure> {
    do {
      try await transport.warmConnection()
      return .success(())
    } catch {
      return .failure(error)
    }
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    let emission: InferenceEmission
    do {
      emission = try await model.infer(frames)
    } catch is CancellationError {
      throw .cancelled
    } catch let failure as InferenceFailure {
      throw failure
    } catch {
      throw .unexpected(error.localizedDescription)
    }
    return try await transport.recognize(
      emission: emission,
      state: state,
      context: context,
      finalize: finalize
    )
  }

  func resetStream() async {
    await transport.resetStream()
  }
}

actor LocalModelRunner {
  private static let featureCount = 162
  private static let missingLandmark: Float = -8192
  private static let vocabSize = 60
  private var model: SendableModel?

  func prepare() async throws {
    _ = try await loadModel()
  }

  func infer(_ frames: [LandmarkFrame]) async throws -> InferenceEmission {
    let model = try await loadModel()
    let input = try landmarkValues(frames)
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
    return try emission(from: output)
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
    guard !frames.isEmpty else {
      throw InferenceFailure.unexpected("Local inference needs frames.")
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

  private func emission(from output: MLMultiArray) throws -> InferenceEmission {
    guard output.shape.count == 3 else {
      throw InferenceFailure.unexpected("Local model returned an invalid shape.")
    }
    let rows = output.shape[1].intValue
    let columns = output.shape[2].intValue
    guard columns == Self.vocabSize, output.count == rows * columns else {
      throw InferenceFailure.unexpected("Local model returned an invalid shape.")
    }

    let flat = outputFloats(output)
    var values = [[Double]]()
    values.reserveCapacity(rows)
    var confidence = 0.0
    for row in 0..<rows {
      let start = row * columns
      let slice = flat[start..<(start + columns)]
      values.append(slice.map(Double.init))
      confidence += exp(Double(slice.max() ?? -.infinity))
    }
    return InferenceEmission(
      values: values,
      frameConfidence: min(1, max(0, confidence / Double(rows)))
    )
  }

  private func outputFloats(_ output: MLMultiArray) -> [Float] {
    switch output.dataType {
    case .float16:
      let source = output.dataPointer.bindMemory(to: Float16.self, capacity: output.count)
      return (0..<output.count).map { Float(source[$0]) }
    case .float32:
      let source = output.dataPointer.bindMemory(to: Float.self, capacity: output.count)
      return Array(UnsafeBufferPointer(start: source, count: output.count))
    case .double:
      let source = output.dataPointer.bindMemory(to: Double.self, capacity: output.count)
      return (0..<output.count).map { Float(source[$0]) }
    default:
      return (0..<output.count).map { output[$0].floatValue }
    }
  }
}

private final class SendableModel: @unchecked Sendable {
  let value: MLModel

  init(_ value: MLModel) {
    self.value = value
  }
}
