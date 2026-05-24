import CoreMedia
import CoreVideo
import Foundation
import UIKit

#if canImport(MediaPipeTasksVision)
import CoreImage
import MediaPipeTasksVision
#endif

actor LandmarkDetector {
  enum DetectorError: Error, LocalizedError {
    case mediaPipeUnavailable
    case modelUnavailable(String)
    case invalidImage

    var errorDescription: String? {
      switch self {
      case .mediaPipeUnavailable:
        "Install the MediaPipeTasksVision pod before running landmark detection."
      case .modelUnavailable(let name):
        "Could not load the \(name) MediaPipe model."
      case .invalidImage:
        "Could not convert the wearable frame for MediaPipe."
      }
    }
  }

  private var lastTimestampMs = 0

  #if canImport(MediaPipeTasksVision)
  private var handLandmarker: HandLandmarker?
  private var poseLandmarker: PoseLandmarker?
  private let ciContext = CIContext()
  #endif

  func prepare() async throws {
    #if canImport(MediaPipeTasksVision)
    if handLandmarker != nil, poseLandmarker != nil { return }

    let handPath = try await modelPath(
      resource: "hand_landmarker",
      fileName: "hand_landmarker.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
      )!
    )
    let posePath = try await modelPath(
      resource: "pose_landmarker_lite",
      fileName: "pose_landmarker_lite.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
      )!
    )

    let handOptions = HandLandmarkerOptions()
    handOptions.baseOptions.modelAssetPath = handPath
    handOptions.runningMode = .video
    handOptions.numHands = 2
    handOptions.minHandDetectionConfidence = 0.5
    handOptions.minHandPresenceConfidence = 0.3
    handOptions.minTrackingConfidence = 0.3
    handLandmarker = try HandLandmarker(options: handOptions)

    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = posePath
    poseOptions.runningMode = .video
    poseOptions.numPoses = 1
    poseOptions.minPoseDetectionConfidence = 0.3
    poseOptions.minPosePresenceConfidence = 0.3
    poseOptions.minTrackingConfidence = 0.3
    poseLandmarker = try PoseLandmarker(options: poseOptions)
    #else
    throw DetectorError.mediaPipeUnavailable
    #endif
  }

  func detect(
    sampleBuffer: CMSampleBuffer,
    timestampMs rawTimestampMs: Int
  ) async throws -> DetectResult {
    #if canImport(MediaPipeTasksVision)
    try await prepare()
    guard let handLandmarker, let poseLandmarker else {
      throw DetectorError.mediaPipeUnavailable
    }
    guard let pixelBuffer = try? bgraPixelBuffer(from: sampleBuffer),
      let image = try? MPImage(pixelBuffer: pixelBuffer)
    else {
      throw DetectorError.invalidImage
    }

    let timestampMs = max(rawTimestampMs, lastTimestampMs + 1)
    lastTimestampMs = timestampMs

    let handResult = try handLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )
    let poseResult = try poseLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )

    let frame = HandLandmarksFrame(
      rightHandLandmarks: rightHands(from: handResult),
      leftHandLandmarks: leftHands(from: handResult),
      poseLandmarks: poseResult.landmarks.map { $0.map(LandmarkPoint.init) }
    )
    let overlay = Self.overlayLandmarks(from: frame)
    return DetectResult(
      inferenceFrame: Self.toInferenceFrame(frame, timestampMs: timestampMs),
      overlayLandmarks: overlay
    )
    #else
    throw DetectorError.mediaPipeUnavailable
    #endif
  }

  private static func toInferenceFrame(
    _ frame: HandLandmarksFrame,
    timestampMs: Int
  ) -> LandmarkFrame? {
    let right = frame.rightHandLandmarks.first
    let left = frame.leftHandLandmarks.first
    guard let pose = frame.poseLandmarks.first, right != nil || left != nil else {
      return nil
    }

    let useLeft = right == nil && left != nil
    let hand = useLeft ? mirror(left ?? []) : (right ?? [])
    let alignedPose = useLeft ? mirror(pose) : pose
    guard hand.count == 21, alignedPose.count == 33 else { return nil }

    return LandmarkFrame(
      landmarks: hand + alignedPose,
      timestampMs: timestampMs
    )
  }

  private static func mirror(_ points: [LandmarkPoint]) -> [LandmarkPoint] {
    points.map { LandmarkPoint(x: 1 - $0.x, y: $0.y, z: $0.z) }
  }

  private static func overlayLandmarks(from frame: HandLandmarksFrame) -> [LandmarkPoint] {
    frame.rightHandLandmarks.flatMap(\.self)
      + frame.leftHandLandmarks.flatMap(\.self)
  }

  #if canImport(MediaPipeTasksVision)
  private func rightHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Right")
  }

  private func leftHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Left")
  }

  private func hands(
    from result: HandLandmarkerResult,
    matching handedness: String
  ) -> [[LandmarkPoint]] {
    result.landmarks.enumerated().compactMap { index, landmarks in
      let category = result.handedness[safe: index]?.first?.categoryName
      guard category == handedness || (handedness == "Right" && category == nil) else {
        return nil
      }
      return landmarks.map(LandmarkPoint.init)
    }
  }

  private func modelPath(
    resource: String,
    fileName: String,
    remoteURL: URL
  ) async throws -> String {
    if let bundled = Bundle.main.path(forResource: resource, ofType: "task") {
      return bundled
    }

    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appending(path: "MediaPipeModels", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )

    let localURL = directory.appending(path: fileName)
    if FileManager.default.fileExists(atPath: localURL.path) {
      return localURL.path
    }

    let (downloadURL, response) = try await URLSession.shared.download(from: remoteURL)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw DetectorError.modelUnavailable(fileName)
    }
    try FileManager.default.moveItem(at: downloadURL, to: localURL)
    return localURL.path
  }

  private func bgraPixelBuffer(from sampleBuffer: CMSampleBuffer) throws -> CVPixelBuffer {
    guard let source = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw DetectorError.invalidImage
    }

    if CVPixelBufferGetPixelFormatType(source) == kCVPixelFormatType_32BGRA {
      return source
    }

    let width = CVPixelBufferGetWidth(source)
    let height = CVPixelBufferGetHeight(source)
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:],
    ]

    var output: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &output
    )
    guard status == kCVReturnSuccess, let output else {
      throw DetectorError.invalidImage
    }

    let image = CIImage(cvPixelBuffer: source)
    ciContext.render(image, to: output)
    return output
  }
  #endif
}

#if canImport(MediaPipeTasksVision)
extension LandmarkPoint {
  fileprivate init(_ landmark: NormalizedLandmark) {
    self.init(
      x: Double(landmark.x),
      y: Double(landmark.y),
      z: Double(landmark.z)
    )
  }
}

extension Collection {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
#endif
