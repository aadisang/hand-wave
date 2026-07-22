import MWDATCamera
import UIKit

actor FramePipeline {
  private static let reportInterval: Duration = .seconds(5)

  enum Frame: Sendable {
    case glasses(VideoFrame)
    case phone(CameraFrame)
  }

  typealias PreviewHandler = @MainActor @Sendable (UIImage) -> Void
  typealias OutputHandler = @MainActor @Sendable (RecognitionOutput) -> Void
  typealias EventHandler = @MainActor @Sendable (RecognitionEvent) -> Void
  typealias FailureHandler = @MainActor @Sendable (String) -> Void

  private let recognizer: Recognizer
  private var generation = 0
  private var latestFrame: Frame?
  private var latestPreview: VideoFrame?
  private var recognitionTask: Task<Void, Never>?
  private var previewTask: Task<Void, Never>?
  private var onPreview: PreviewHandler?
  private var onOutput: OutputHandler?
  private var onEvent: EventHandler?
  private var onFailure: FailureHandler?
  private var receivedFrames = 0
  private var processedFrames = 0
  private var inferenceFrames = 0
  private var supersededFrames = 0
  private var reportStartedAt = ContinuousClock.now

  init(recognizer: Recognizer = Recognizer()) {
    self.recognizer = recognizer
  }

  func prepare() async throws {
    try await recognizer.prepare()
  }

  func start(
    onPreview: @escaping PreviewHandler,
    onOutput: @escaping OutputHandler,
    onEvent: @escaping EventHandler,
    onFailure: @escaping FailureHandler
  ) async throws {
    generation &+= 1
    self.onPreview = onPreview
    self.onOutput = onOutput
    self.onEvent = onEvent
    self.onFailure = onFailure
    reportStartedAt = .now

    try await recognizer.start { [weak self] event in
      await self?.deliver(event)
    }
  }

  func submit(_ frame: Frame) {
    receivedFrames += 1
    if latestFrame != nil {
      supersededFrames += 1
    }
    latestFrame = frame
    startRecognitionIfNeeded()

    guard case .glasses(let videoFrame) = frame else { return }
    latestPreview = videoFrame
    startPreviewIfNeeded()
  }

  func stop() async {
    generation &+= 1
    let activeRecognitionTask = recognitionTask
    let activePreviewTask = previewTask
    activeRecognitionTask?.cancel()
    activePreviewTask?.cancel()
    await activeRecognitionTask?.value
    await activePreviewTask?.value
    recognitionTask = nil
    previewTask = nil
    latestFrame = nil
    latestPreview = nil
    onPreview = nil
    onOutput = nil
    onEvent = nil
    onFailure = nil
    receivedFrames = 0
    processedFrames = 0
    inferenceFrames = 0
    supersededFrames = 0
    await recognizer.stop()
  }

  private func startRecognitionIfNeeded() {
    guard recognitionTask == nil else { return }
    let currentGeneration = generation
    recognitionTask = Task(priority: .userInitiated) { [weak self] in
      await self?.drainRecognition(generation: currentGeneration)
    }
  }

  private func drainRecognition(generation expectedGeneration: Int) async {
    while expectedGeneration == generation, !Task.isCancelled {
      guard let frame = latestFrame else { break }
      latestFrame = nil

      let interval = AppLog.performance.beginInterval("Landmark processing")
      do {
        let output = try await recognizer.process(frame)
        AppLog.performance.endInterval("Landmark processing", interval)
        guard expectedGeneration == generation, !Task.isCancelled else { break }
        processedFrames += 1
        if output.hasLandmarks {
          inferenceFrames += 1
        }
        reportPerformanceIfNeeded()
        if let onOutput {
          await onOutput(output)
        }
      } catch is CancellationError {
        AppLog.performance.endInterval("Landmark processing", interval)
        break
      } catch {
        AppLog.performance.endInterval("Landmark processing", interval)
        guard expectedGeneration == generation else { break }
        AppLog.inference.error(
          "Landmark processing failed: \(error.localizedDescription, privacy: .private)")
        if let onFailure {
          await onFailure(error.localizedDescription)
        }
      }
    }

    guard expectedGeneration == generation else { return }
    recognitionTask = nil
    if latestFrame != nil {
      startRecognitionIfNeeded()
    }
  }

  private func startPreviewIfNeeded() {
    guard previewTask == nil else { return }
    let currentGeneration = generation
    previewTask = Task(priority: .userInitiated) { [weak self] in
      await self?.drainPreview(generation: currentGeneration)
    }
  }

  private func drainPreview(generation expectedGeneration: Int) async {
    while expectedGeneration == generation, !Task.isCancelled {
      guard let frame = latestPreview else { break }
      latestPreview = nil
      let image = await Task.detached(priority: .userInitiated) {
        frame.makeUIImage()
      }.value
      guard expectedGeneration == generation, !Task.isCancelled else { break }
      if let image, let onPreview {
        await onPreview(image)
      }
    }

    guard expectedGeneration == generation else { return }
    previewTask = nil
    if latestPreview != nil {
      startPreviewIfNeeded()
    }
  }

  private func deliver(_ event: RecognitionEvent) async {
    guard let onEvent else { return }
    await onEvent(event)
  }

  private func reportPerformanceIfNeeded() {
    guard reportStartedAt.duration(to: .now) >= Self.reportInterval else { return }
    AppLog.stream.debug(
      "Frame pipeline received=\(self.receivedFrames) processed=\(self.processedFrames) inference=\(self.inferenceFrames) superseded=\(self.supersededFrames)"
    )
    receivedFrames = 0
    processedFrames = 0
    inferenceFrames = 0
    supersededFrames = 0
    reportStartedAt = .now
  }
}
