import Foundation
import XCTest

@testable import HandWave

/// Real client/service verification. Synthetic landmarks do not verify sign accuracy.
final class BackendIntegrationTests: XCTestCase {
  @MainActor
  func testConfiguredBackendPreservesStreamBoundaries() async throws {
    var evidence: [String: Any] = [
      "scope":
        "Real Swift client and backend; synthetic landmarks; no camera or sign accuracy claim",
      "started_at": ISO8601DateFormatter().string(from: Date()),
    ]
    var steps: [[String: Any]] = []
    defer {
      evidence["steps"] = steps
      if let data = try? JSONSerialization.data(
        withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
      {
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "client-service-evidence.json"
        attachment.lifetime = .keepAlways
        add(attachment)
      }
    }

    let configured = try XCTUnwrap(
      Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL") as? String)
    let url = try XCTUnwrap(URL(string: configured))
    XCTAssertNotNil(url.host, "Start pnpm dev:mobile or supply the explicit test endpoint.")
    evidence["endpoint"] = configured
    let (health, response) = try await URLSession.shared.data(
      from: url.appendingPathComponent("v1/health"))
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    let healthObject = try XCTUnwrap(JSONSerialization.jsonObject(with: health) as? [String: Any])
    evidence["health"] = healthObject
    XCTAssertEqual(healthObject["ok"] as? Bool, true)
    XCTAssertFalse(try XCTUnwrap(healthObject["deployment_id"] as? String).isEmpty)
    if let expected = Bundle(for: Self.self).object(
      forInfoDictionaryKey: "HandWaveExpectedDeploymentID") as? String, !expected.isEmpty
    {
      evidence["expected_deployment_id"] = expected
      XCTAssertEqual(
        healthObject["deployment_id"] as? String, expected,
        "The endpoint runs a different backend revision.")
    }

    let client = InferClient()
    addTeardownBlock { await client.resetStream() }
    try await client.warmConnection()
    steps.append(["step": "warmup", "result": "connected"])

    func recognize(
      _ range: Range<Int>, state: InferenceRecognitionState?, name: String, finalize: Bool = false
    ) async throws -> InferenceRecognizeOut {
      let frames = range.map { index in
        LandmarkFrame(
          landmarks: (0..<54).map { _ in LandmarkPoint(x: 0.5, y: 0.5, z: 0) },
          timestampMs: index * 42
        )
      }
      let context = InferenceRecognitionContext(
        idleFrames: finalize ? 18 : 0, missingFrames: 0, segmentFrames: range.count,
        motion: finalize ? 0 : 0.1, endpointReason: finalize ? .idle : nil
      )
      let result = try await client.recognize(
        frames: frames, state: state, context: context, finalize: finalize)
      steps.append([
        "step": name,
        "frames": frames.map {
          ["timestamp_ms": $0.timestampMs, "features": $0.inferenceFeatures] as [String: Any]
        },
        "context": try JSONSerialization.jsonObject(with: JSONEncoder().encode(context)),
        "response": try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)),
      ])
      return result
    }

    let first = try await recognize(0..<24, state: nil, name: "first_window")
    XCTAssertEqual(first.trace.decode?.bufferedFrames, 24)
    let overlap = try await recognize(
      12..<36, state: first.state, name: "overlap_sends_only_new_frames")
    XCTAssertEqual(overlap.trace.decode?.bufferedFrames, 36)
    let resync = try await recognize(
      48..<72, state: overlap.state, name: "lost_cursor_resets_buffer")
    XCTAssertEqual(resync.trace.decode?.bufferedFrames, 24)
    let final = try await recognize(48..<72, state: resync.state, name: "finalize", finalize: true)
    XCTAssertEqual(final.trace.finalize?.endpointReason, .idle)
    XCTAssertEqual(final.trace.finalize?.segmentFrames, 24)
    let next = try await recognize(72..<96, state: nil, name: "next_phrase_has_no_old_frames")
    XCTAssertEqual(next.trace.decode?.bufferedFrames, 24)
    await client.resetStream()
    try await client.warmConnection()
    let reconnected = try await recognize(0..<24, state: nil, name: "reconnect_starts_new_stream")
    XCTAssertEqual(reconnected.trace.decode?.bufferedFrames, 24)
  }
}
