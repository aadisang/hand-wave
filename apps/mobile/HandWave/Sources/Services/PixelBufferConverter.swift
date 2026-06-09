import CoreImage
import CoreMedia
import Foundation

final class PixelBufferConverter: @unchecked Sendable {
  enum ConversionError: Error, LocalizedError {
    case missingImageBuffer
    case createPixelBufferFailed(CVReturn)
    case createFormatDescriptionFailed(OSStatus)
    case createSampleBufferFailed(OSStatus)

    var errorDescription: String? {
      switch self {
      case .missingImageBuffer:
        "The wearable frame did not contain an image buffer."
      case .createPixelBufferFailed(let status):
        "Could not allocate a BGRA pixel buffer. CVReturn \(status)."
      case .createFormatDescriptionFailed(let status):
        "Could not describe the converted BGRA pixel buffer. OSStatus \(status)."
      case .createSampleBufferFailed(let status):
        "Could not wrap the converted BGRA pixel buffer. OSStatus \(status)."
      }
    }
  }

  private let context = CIContext()

  func bgraSampleBuffer(from sampleBuffer: CMSampleBuffer) throws -> CMSampleBuffer {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw ConversionError.missingImageBuffer
    }

    if CVPixelBufferGetPixelFormatType(imageBuffer) == kCVPixelFormatType_32BGRA {
      return sampleBuffer
    }

    let width = CVPixelBufferGetWidth(imageBuffer)
    let height = CVPixelBufferGetHeight(imageBuffer)
    let attributes: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferMetalCompatibilityKey: true,
    ]
    var convertedBuffer: CVPixelBuffer?
    let createStatus = CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCVPixelFormatType_32BGRA,
      attributes as CFDictionary,
      &convertedBuffer
    )
    guard createStatus == kCVReturnSuccess, let convertedBuffer else {
      throw ConversionError.createPixelBufferFailed(createStatus)
    }

    context.render(CIImage(cvPixelBuffer: imageBuffer), to: convertedBuffer)
    return try makeSampleBuffer(
      imageBuffer: convertedBuffer,
      sourceSampleBuffer: sampleBuffer
    )
  }

  private func makeSampleBuffer(
    imageBuffer: CVPixelBuffer,
    sourceSampleBuffer: CMSampleBuffer
  ) throws -> CMSampleBuffer {
    var formatDescription: CMVideoFormatDescription?
    let descriptionStatus = CMVideoFormatDescriptionCreateForImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: imageBuffer,
      formatDescriptionOut: &formatDescription
    )
    guard descriptionStatus == noErr, let formatDescription else {
      throw ConversionError.createFormatDescriptionFailed(descriptionStatus)
    }

    var timing = CMSampleTimingInfo(
      duration: CMSampleBufferGetDuration(sourceSampleBuffer),
      presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(sourceSampleBuffer),
      decodeTimeStamp: CMSampleBufferGetDecodeTimeStamp(sourceSampleBuffer)
    )
    var convertedSampleBuffer: CMSampleBuffer?
    let sampleStatus = CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: imageBuffer,
      formatDescription: formatDescription,
      sampleTiming: &timing,
      sampleBufferOut: &convertedSampleBuffer
    )
    guard sampleStatus == noErr, let convertedSampleBuffer else {
      throw ConversionError.createSampleBufferFailed(sampleStatus)
    }

    return convertedSampleBuffer
  }
}
