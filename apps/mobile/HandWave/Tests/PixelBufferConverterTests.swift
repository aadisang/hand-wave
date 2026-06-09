import CoreMedia
import CoreVideo
import Foundation
import Testing

@testable import HandWave

struct PixelBufferConverterTests {
  @Test
  func convertsNonBGRASampleBufferToBGRA() throws {
    let source = try Self.sampleBuffer(pixelFormat: kCVPixelFormatType_32ARGB)
    let converted = try PixelBufferConverter().bgraSampleBuffer(from: source)

    let imageBuffer = try #require(CMSampleBufferGetImageBuffer(converted))
    #expect(CVPixelBufferGetPixelFormatType(imageBuffer) == kCVPixelFormatType_32BGRA)
    #expect(CVPixelBufferGetWidth(imageBuffer) == 16)
    #expect(CVPixelBufferGetHeight(imageBuffer) == 12)
    #expect(
      CMSampleBufferGetPresentationTimeStamp(converted)
        == CMSampleBufferGetPresentationTimeStamp(source)
    )
  }

  @Test
  func keepsBGRASampleBufferAsBGRA() throws {
    let source = try Self.sampleBuffer(pixelFormat: kCVPixelFormatType_32BGRA)
    let converted = try PixelBufferConverter().bgraSampleBuffer(from: source)

    let imageBuffer = try #require(CMSampleBufferGetImageBuffer(converted))
    #expect(CVPixelBufferGetPixelFormatType(imageBuffer) == kCVPixelFormatType_32BGRA)
  }

  private static func sampleBuffer(pixelFormat: OSType) throws -> CMSampleBuffer {
    var createdImageBuffer: CVPixelBuffer?
    let pixelStatus = CVPixelBufferCreate(
      kCFAllocatorDefault,
      16,
      12,
      pixelFormat,
      [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      ] as CFDictionary,
      &createdImageBuffer
    )
    #expect(pixelStatus == kCVReturnSuccess)
    let imageBuffer = try #require(createdImageBuffer)

    CVPixelBufferLockBaseAddress(imageBuffer, [])
    if let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer) {
      memset(baseAddress, 0, CVPixelBufferGetDataSize(imageBuffer))
    }
    CVPixelBufferUnlockBaseAddress(imageBuffer, [])

    var createdFormatDescription: CMVideoFormatDescription?
    let descriptionStatus = CMVideoFormatDescriptionCreateForImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: imageBuffer,
      formatDescriptionOut: &createdFormatDescription
    )
    #expect(descriptionStatus == noErr)
    let formatDescription = try #require(createdFormatDescription)

    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: 30),
      presentationTimeStamp: CMTime(value: 42, timescale: 1_000),
      decodeTimeStamp: .invalid
    )
    var sampleBuffer: CMSampleBuffer?
    let sampleStatus = CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: imageBuffer,
      formatDescription: formatDescription,
      sampleTiming: &timing,
      sampleBufferOut: &sampleBuffer
    )
    #expect(sampleStatus == noErr)
    return try #require(sampleBuffer)
  }
}
