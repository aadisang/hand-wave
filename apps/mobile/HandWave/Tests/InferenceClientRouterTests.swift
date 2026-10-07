import Testing

@testable import HandWave

@Suite
struct InferenceClientRouterTests {
  @Test
  func keepsTheDeviceModelClientAcrossStreams() async throws {
    let remote = RouterClientSpy()
    let device = RouterClientSpy()
    let router = InferenceClientRouter(
      remoteClient: remote,
      deviceClient: device,
      selectedMode: { .device }
    )

    try await router.warmConnection()
    await router.resetStream()
    try await router.warmConnection()

    #expect(await device.warmCount == 2)
    #expect(await device.resetCount == 1)
    #expect(await remote.warmCount == 0)
  }
}

private actor RouterClientSpy: InferAPI {
  private(set) var warmCount = 0
  private(set) var resetCount = 0

  func warmConnection() {
    warmCount += 1
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    throw .cancelled
  }

  func resetStream() {
    resetCount += 1
  }
}
