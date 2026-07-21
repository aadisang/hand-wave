@preconcurrency import AVFoundation

final class PhoneCamera: NSObject, @unchecked Sendable {
  enum Position: CaseIterable, Sendable {
    case back
    case front

    fileprivate var next: Self { self == .back ? .front : .back }

    fileprivate var capturePosition: AVCaptureDevice.Position {
      self == .back ? .back : .front
    }
  }

  enum Failure: Error, LocalizedError {
    case denied
    case unavailable
    case rejectedInput
    case rejectedOutput

    var errorDescription: String? {
      switch self {
      case .denied: "Camera access denied. Allow camera access in Settings."
      case .unavailable: "Camera unavailable."
      case .rejectedInput, .rejectedOutput: "Camera setup failed."
      }
    }
  }

  let session = AVCaptureSession()
  private static let targetFrameRate = 30.0
  private static let maxPixels = Int32(1920 * 1080)
  private let queue = DispatchQueue(label: "sh.handwave.phone-camera")
  private let output = AVCaptureVideoDataOutput()
  private var frameContinuation: AsyncStream<CameraFrame>.Continuation?
  private var input: AVCaptureDeviceInput?
  private var position: Position = .back
  private var outputConfigured = false
  private var generation = 0

  func start(position: Position) async throws -> AsyncStream<CameraFrame> {
    let startGeneration = await beginStart()
    guard await cameraAccessGranted else { throw Failure.denied }
    guard await isCurrent(startGeneration) else { throw CancellationError() }
    try await configure(position)
    guard await isCurrent(startGeneration) else { throw CancellationError() }
    return try await run(generation: startGeneration)
  }

  func rotate() async throws -> Position {
    let next = await configuredPosition.next
    try await configure(next)
    return next
  }

  func stop() async {
    await withCheckedContinuation { continuation in
      queue.async {
        self.generation &+= 1
        self.session.stopRunning()
        self.frameContinuation?.finish()
        self.frameContinuation = nil
        continuation.resume()
      }
    }
  }

  private var cameraAccessGranted: Bool {
    get async {
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        true
      case .notDetermined:
        await AVCaptureDevice.requestAccess(for: .video)
      case .denied, .restricted:
        false
      @unknown default:
        false
      }
    }
  }

  private var configuredPosition: Position {
    get async {
      await withCheckedContinuation { continuation in
        queue.async { continuation.resume(returning: self.position) }
      }
    }
  }

  private func beginStart() async -> Int {
    await withCheckedContinuation { continuation in
      queue.async {
        self.generation &+= 1
        continuation.resume(returning: self.generation)
      }
    }
  }

  private func isCurrent(_ generation: Int) async -> Bool {
    await withCheckedContinuation { continuation in
      queue.async { continuation.resume(returning: generation == self.generation) }
    }
  }

  private func configure(_ position: Position) async throws {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          try self.configureNow(position)
          continuation.resume()
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func configureNow(_ position: Position) throws {
    guard
      let device = AVCaptureDevice.default(
        .builtInWideAngleCamera,
        for: .video,
        position: position.capturePosition
      )
    else {
      throw Failure.unavailable
    }

    let frameRate = try configureFormat(device)
    let nextInput = try AVCaptureDeviceInput(device: device)
    let previousInput = input

    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .inputPriority
    // Add the shared output before touching the working input. If output setup
    // fails, the prior camera stays intact.
    try configureOutput()
    if let previousInput {
      session.removeInput(previousInput)
    }
    guard session.canAddInput(nextInput) else {
      if let previousInput, session.canAddInput(previousInput) {
        session.addInput(previousInput)
      }
      throw Failure.rejectedInput
    }
    session.addInput(nextInput)

    configure(output.connection(with: .video), for: position)
    input = nextInput
    self.position = position
    AppLog.camera.notice("Phone camera configured at \(frameRate) FPS")
  }

  private func configureOutput() throws {
    if !outputConfigured {
      output.alwaysDiscardsLateVideoFrames = true
      output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
      ]
      output.setSampleBufferDelegate(self, queue: queue)
      outputConfigured = true
    }
    guard !session.outputs.contains(output) else { return }
    guard session.canAddOutput(output) else { throw Failure.rejectedOutput }
    session.addOutput(output)
  }

  private func configureFormat(_ device: AVCaptureDevice) throws -> Double {
    typealias Candidate = (AVCaptureDevice.Format, AVFrameRateRange, Int32)
    let candidates: [Candidate] = device.formats.flatMap { format -> [Candidate] in
      let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      let pixels = size.width * size.height
      guard pixels <= Self.maxPixels else { return [] }
      return format.videoSupportedFrameRateRanges.compactMap { range in
        min(Self.targetFrameRate, range.maxFrameRate) >= range.minFrameRate
          ? (format, range, pixels)
          : nil
      }
    }
    guard
      let candidate = candidates.max(by: {
        let lhsRate = min(Self.targetFrameRate, $0.1.maxFrameRate)
        let rhsRate = min(Self.targetFrameRate, $1.1.maxFrameRate)
        return lhsRate == rhsRate ? $0.2 < $1.2 : lhsRate < rhsRate
      })
    else {
      throw Failure.unavailable
    }
    let frameRate = min(Self.targetFrameRate, candidate.1.maxFrameRate)

    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    device.activeFormat = candidate.0
    let duration = Self.frameDuration(
      for: frameRate,
      minimum: candidate.1.minFrameDuration,
      maximum: candidate.1.maxFrameDuration
    )
    device.activeVideoMinFrameDuration = duration
    device.activeVideoMaxFrameDuration = duration
    return frameRate
  }

  static func frameDuration(
    for frameRate: Double,
    minimum: CMTime,
    maximum: CMTime
  ) -> CMTime {
    let requested = CMTime(value: 1, timescale: CMTimeScale(frameRate.rounded()))
    if CMTimeCompare(requested, minimum) < 0 { return minimum }
    if CMTimeCompare(requested, maximum) > 0 { return maximum }
    return requested
  }

  private func configure(_ connection: AVCaptureConnection?, for position: Position) {
    guard let connection else { return }
    if connection.isVideoRotationAngleSupported(90) {
      connection.videoRotationAngle = 90
    }
    if connection.isVideoMirroringSupported {
      connection.isVideoMirrored = position == .front
    }
  }

  private func run(generation: Int) async throws -> AsyncStream<CameraFrame> {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        guard generation == self.generation else {
          continuation.resume(throwing: CancellationError())
          return
        }
        self.frameContinuation?.finish()
        let pair = AsyncStream.makeStream(
          of: CameraFrame.self,
          bufferingPolicy: .bufferingNewest(1)
        )
        self.frameContinuation = pair.continuation
        if !self.session.isRunning {
          self.session.startRunning()
        }
        continuation.resume(returning: pair.stream)
      }
    }
  }
}

extension PhoneCamera: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    frameContinuation?.yield(CameraFrame(sampleBuffer: sampleBuffer))
  }
}
