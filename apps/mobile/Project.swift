import ProjectDescription

let urlScheme = "handwave"

let infoPlist: [String: Plist.Value] = [
  "CFBundleDevelopmentRegion": "$(DEVELOPMENT_LANGUAGE)",
  "CFBundleDisplayName": "Hand Wave",
  "CFBundleExecutable": "$(EXECUTABLE_NAME)",
  "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
  "CFBundleInfoDictionaryVersion": "6.0",
  "CFBundleName": "$(PRODUCT_NAME)",
  "CFBundlePackageType": "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
  "CFBundleShortVersionString": "$(MARKETING_VERSION)",
  "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
  "CFBundleURLTypes": [
    [
      "CFBundleTypeRole": "Editor",
      "CFBundleURLName": "$(PRODUCT_BUNDLE_IDENTIFIER)",
      "CFBundleURLSchemes": [.string(urlScheme)],
    ]
  ],
  "MWDAT": [
    "AppLinkURLScheme": "\(urlScheme)://",
    "MetaAppID": "$(META_APP_ID)",
    "ClientToken": "$(CLIENT_TOKEN)",
    "TeamID": "$(DEVELOPMENT_TEAM)",
  ],
  "HandWaveInferenceURL": "$(HANDWAVE_INFERENCE_URL)",
  "NSAppTransportSecurity": [
    "NSAllowsArbitraryLoads": true
  ],
  "UIBackgroundModes": [
    "processing",
    "bluetooth-central",
    "bluetooth-peripheral",
    "external-accessory",
  ],
  "NSBluetoothAlwaysUsageDescription":
    "Hand Wave connects to your Meta wearable over Bluetooth.",
  "NSLocalNetworkUsageDescription":
    "Hand Wave connects to the local inference server while recognizing signs.",
  "NSBonjourServices": ["_http._tcp"],
  "UISupportedExternalAccessoryProtocols": ["com.meta.ar.wearable"],
  "NSCameraUsageDescription":
    "Hand Wave bridges the camera on your Meta wearable to interpret signs.",
  "NSMicrophoneUsageDescription":
    "Hand Wave streams audio from your Meta wearable to the recognizer.",
  "NSPhotoLibraryAddUsageDescription":
    "Hand Wave saves photos captured from your wearable.",
  "UIApplicationSceneManifest": [
    "UIApplicationSupportsMultipleScenes": false
  ],
  "UIApplicationSupportsIndirectInputEvents": true,
  "UILaunchScreen": [:],
  "UISupportedInterfaceOrientations": [
    "UIInterfaceOrientationPortrait"
  ],
]

let project = Project(
  name: "HandWave",
  organizationName: "Hand Wave",
  options: .options(
    automaticSchemesOptions: .enabled(),
    defaultKnownRegions: ["en"],
    developmentRegion: "en"
  ),
  settings: .settings(
    base: [
      "SWIFT_VERSION": "6.0",
      "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
      "DEVELOPMENT_TEAM": "$(DEVELOPMENT_TEAM)",
    ],
    configurations: [
      .debug(name: "Debug", xcconfig: "Configurations/HandWave.xcconfig"),
      .release(name: "Release", xcconfig: "Configurations/HandWave.xcconfig"),
    ]
  ),
  targets: [
    .target(
      name: "HandWave",
      destinations: .iOS,
      product: .app,
      bundleId: "sh.handwave.HandWave",
      deploymentTargets: .iOS("26.0"),
      infoPlist: .extendingDefault(with: infoPlist),
      buildableFolders: [
        "HandWave/Sources",
        "HandWave/Resources",
      ],
      entitlements: "HandWave/HandWave.entitlements",
      dependencies: [
        .external(name: "MWDATCore"),
        .external(name: "MWDATCamera"),
        .external(name: "MWDATMockDevice"),
      ]
    ),
    .target(
      name: "HandWaveTests",
      destinations: .iOS,
      product: .unitTests,
      bundleId: "sh.handwave.HandWaveTests",
      deploymentTargets: .iOS("26.0"),
      infoPlist: .default,
      buildableFolders: ["HandWave/Tests"],
      dependencies: [.target(name: "HandWave")],
      settings: .settings(
        base: [
          "FRAMEWORK_SEARCH_PATHS": [
            "$(inherited)",
            "$(PROJECT_DIR)/Pods/MediaPipeTasksCommon/frameworks",
            "$(PROJECT_DIR)/Pods/MediaPipeTasksVision/frameworks",
            "$(BUILT_PRODUCTS_DIR)/XCFrameworkIntermediates/MediaPipeTasksCommon",
            "$(BUILT_PRODUCTS_DIR)/XCFrameworkIntermediates/MediaPipeTasksVision",
          ]
        ]
      )
    ),
  ]
)
