// swift-tools-version: 6.0
@preconcurrency import PackageDescription

#if TUIST
  import struct ProjectDescription.PackageSettings

  let packageSettings = PackageSettings(
    productTypes: [:]
  )
#endif

let package = Package(
  name: "HandWave",
  dependencies: [
    // Pin to the 0.6.x line: 0.7.0 renamed the camera API (StreamSession ->
    // Stream, etc.), which the app is written against. Stay on next-minor until
    // those call sites are migrated.
    .package(
      url: "https://github.com/facebook/meta-wearables-dat-ios",
      .upToNextMinor(from: "0.6.0")
    ),
    .package(
      url: "https://github.com/pointfreeco/swift-dependencies",
      from: "1.13.0"
    ),
  ]
)
