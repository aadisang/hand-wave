@preconcurrency import AVFoundation

final class PhoneCamera: NSObject, @unchecked Sendable {
  enum Position: CaseIterable, Sendable {
    case back
    case front

    fileprivate var next: Self {
      self == .back ? .front : .back
    }

    fileprivate var capturePosition: AVCaptureDevice.Position {
      switch self {
      case .back: .back
      case .front: .front
      }
    }
  }

  enum Failure: Error, LocalizedError {
    case denied
    case unavailable
    case rejectedInput
    case rejectedOutput

    var errorDescription: String? {
      switch self {
      case .denied:
        "Camera access denied. Allow camera access in Settings."
      case .unavailable:
        "Camera unavailable."
      case .rejectedInput, .rejectedOutput:
        "Camera setup failed."
      }
    }
  }

  let session = AVCaptureSession()

  private let queue = DispatchQueue(label: "sh.handwave.phone-camera")
  private let output = AVCaptureVideoDataOutput()
  private var input: AVCaptureDeviceInput?
  private var onFrame: (@Sendable (CameraFrame) -> Void)?
  private var position: Position = .back
  private var outputConfigured = false

  func start(
    position: Position,
    onFrame: @escaping @Sendable (CameraFrame) -> Void
  ) async throws -> Double {
    guard await requestAccess() else { throw Failure.denied }
    let frameRate = try await configure(position: position, onFrame: onFrame)
    await run()
    return frameRate
  }

  func rotate() async throws -> (Position, Double) {
    let nextPosition = position.next
    let frameRate = try await configure(position: nextPosition, onFrame: onFrame)
    return (nextPosition, frameRate)
  }

  func stop() async {
    await withCheckedContinuation { continuation in
      queue.async {
        self.session.stopRunning()
        self.onFrame = nil
        continuation.resume()
      }
    }
  }

  private func requestAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      true
    case .notDetermined:
      await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: .video) { granted in
          continuation.resume(returning: granted)
        }
      }
    case .denied, .restricted:
      false
    @unknown default:
      false
    }
  }

  private func configure(
    position: Position,
    onFrame: (@Sendable (CameraFrame) -> Void)?
  ) async throws -> Double {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          let frameRate = try self.configureNow(position: position, onFrame: onFrame)
          continuation.resume(returning: frameRate)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func configureNow(
    position: Position,
    onFrame: (@Sendable (CameraFrame) -> Void)?
  ) throws -> Double {
    let device = AVCaptureDevice.default(
      .builtInWideAngleCamera,
      for: .video,
      position: position.capturePosition
    )
    guard let device else { throw Failure.unavailable }

    let frameRate = try configureMaxFrameRate(device)
    let nextInput = try AVCaptureDeviceInput(device: device)

    session.beginConfiguration()
    session.sessionPreset = .inputPriority
    if let input {
      session.removeInput(input)
    }
    guard session.canAddInput(nextInput) else {
      session.commitConfiguration()
      throw Failure.rejectedInput
    }
    session.addInput(nextInput)

    if !outputConfigured {
      output.alwaysDiscardsLateVideoFrames = true
      output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
      ]
      output.setSampleBufferDelegate(self, queue: queue)
      outputConfigured = true
    }
    if !session.outputs.contains(output) {
      guard session.canAddOutput(output) else {
        session.commitConfiguration()
        throw Failure.rejectedOutput
      }
      session.addOutput(output)
    }
    configure(output.connection(with: .video), for: position)
    session.commitConfiguration()

    self.input = nextInput
    self.onFrame = onFrame
    self.position = position
    return frameRate
  }

  private func configureMaxFrameRate(_ device: AVCaptureDevice) throws -> Double {
    var bestFormat: AVCaptureDevice.Format?
    var bestRange: AVFrameRateRange?
    var bestPixels: Int32 = 0

    for format in device.formats {
      let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      let pixels = dimensions.width * dimensions.height
      for range in format.videoSupportedFrameRateRanges {
        let isBetter: Bool
        if let current = bestRange {
          isBetter =
            range.maxFrameRate > current.maxFrameRate
            || (range.maxFrameRate == current.maxFrameRate && pixels > bestPixels)
        } else {
          isBetter = true
        }

        if isBetter {
          bestFormat = format
          bestRange = range
          bestPixels = pixels
        }
      }
    }

    guard let bestFormat, let bestRange else { throw Failure.unavailable }

    try device.lockForConfiguration()
    device.activeFormat = bestFormat
    device.activeVideoMinFrameDuration = bestRange.minFrameDuration
    device.activeVideoMaxFrameDuration = bestRange.minFrameDuration
    device.unlockForConfiguration()
    return bestRange.maxFrameRate
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

  private func run() async {
    await withCheckedContinuation { continuation in
      queue.async {
        if !self.session.isRunning {
          self.session.startRunning()
        }
        continuation.resume()
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
    onFrame?(CameraFrame(sampleBuffer: sampleBuffer))
  }
}
