actor InferenceClientRouter: InferAPI {
  private let remoteClient: any InferAPI
  private let deviceClient: any InferAPI
  private let selectedMode: @Sendable () -> InferenceMode
  private var activeClient: (any InferAPI)?

  init(
    remoteClient: any InferAPI = InferClient(),
    deviceClient: any InferAPI = LocalInferClient(),
    selectedMode: @escaping @Sendable () -> InferenceMode = { InferenceMode.selected }
  ) {
    self.remoteClient = remoteClient
    self.deviceClient = deviceClient
    self.selectedMode = selectedMode
  }

  func warmConnection() async throws(InferenceFailure) {
    try await selectedClient().warmConnection()
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    try await selectedClient().recognize(
      frames: frames,
      state: state,
      context: context,
      finalize: finalize
    )
  }

  func resetStream() async {
    await activeClient?.resetStream()
    activeClient = nil
  }

  private func selectedClient() -> any InferAPI {
    if let activeClient { return activeClient }
    let selected: any InferAPI =
      switch selectedMode() {
      case .remote: remoteClient
      case .device: deviceClient
      }
    activeClient = selected
    return selected
  }
}
