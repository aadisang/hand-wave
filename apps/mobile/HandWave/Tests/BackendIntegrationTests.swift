import Foundation
import Testing

@testable import HandWave

struct BackendIntegrationTests {
  private static var hasBackend: Bool {
    #if DEBUG
    guard let value = Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL") as? String,
      let url = URL(string: value)
    else { return false }
    return url.scheme == "https" && url.host() != nil
    #else
    // A release must fail verification if its backend was not configured.
    return true
    #endif
  }

  @Test(.enabled(if: hasBackend))
  func configuredBackendRecognizesFinalizesAndReconnects() async throws {
    let client = InferClient()
    try await client.warmConnection()
    let frames = (0..<24).map { index in
      LandmarkFrame(
        landmarks: (0..<54).map { _ in LandmarkPoint(x: 0.5, y: 0.5, z: 0) },
        timestampMs: index * 42
      )
    }
    let context = InferenceRecognitionContext(
      idleFrames: 0, missingFrames: 0, segmentFrames: 24, motion: 0.1
    )
    let response = try await client.recognize(
      frames: frames, state: nil, context: context, finalize: false
    )
    let endpoint = InferenceRecognitionContext(
      idleFrames: 18, missingFrames: 0, segmentFrames: 24, motion: 0, endpointReason: .idle
    )
    _ = try await client.recognize(
      frames: frames, state: response.state, context: endpoint, finalize: true
    )
    await client.resetStream()
    try await client.warmConnection()
    await client.resetStream()
  }
}
