import CoreML
import Foundation

actor LocalInferClient: InferAPI {
  private let model = LocalModelRunner()
  private let transport: any EmissionTransport

  init(transport: any EmissionTransport = InferClient(endpoint: .device)) {
    self.transport = transport
  }

  func warmConnection() async throws(InferenceFailure) {
    do {
      try await model.prepare()
    } catch is CancellationError {
      throw .cancelled
    } catch {
      throw .unexpected(error.localizedDescription)
    }
    try await transport.warmConnection()
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
