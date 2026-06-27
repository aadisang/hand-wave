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
    .package(
      url: "https://github.com/facebook/meta-wearables-dat-ios",
      exact: "0.8.0"
    ),
    .package(
      url: "https://github.com/pointfreeco/swift-dependencies",
      from: "1.13.0"
    ),
  ]
)
