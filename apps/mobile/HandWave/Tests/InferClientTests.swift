import Foundation
import Testing

@testable import HandWave

@Suite
struct InferClientTests {
  @Test
  func convertsBackendURLsToWebSocketURLs() {
    #expect(
      URL(string: "http://localhost:8000")?.webSocketURL(path: "/v1/stream")
        == URL(string: "ws://localhost:8000/v1/stream")
    )
    #expect(
      URL(string: "https://inference.example")?.webSocketURL(path: "/v1/stream")
        == URL(string: "wss://inference.example/v1/stream")
    )
  }

  @Test
  func sendsOnlyFramesNewerThanTheServerCursor() {
    let frames = [0, 42, 84, 126].map { Self.frame(at: $0) }

    #expect(
      InferClient.unsentFrames(frames, after: 42, requiresResync: false).map(\.timestampMs)
        == [84, 126]
    )
    #expect(
      InferClient.unsentFrames(frames, after: 84, requiresResync: true).map(\.timestampMs)
        == [0, 42, 84, 126]
    )
  }

  @Test
  func encodesTheVersionedStreamEnvelope() throws {
    let request = InferenceStreamPingRequest(
      sequence: 7,
      _protocol: 1,
      type: .ping
    )

    let object = try #require(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
    )

    #expect(object["type"] as? String == "ping")
    #expect(object["sequence"] as? Int == 7)
    #expect(object["protocol"] as? Int == 1)
  }

  private static func frame(at timestampMs: Int) -> LandmarkFrame {
    LandmarkFrame(
      landmarks: (0..<54).map { _ in LandmarkPoint(x: 0, y: 0, z: nil) },
      timestampMs: timestampMs
    )
  }
}
