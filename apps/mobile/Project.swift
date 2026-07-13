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
  "LSApplicationQueriesSchemes": ["fb-viewapp"],
  "MWDAT": [
    "AppLinkURLScheme": "\(urlScheme)://",
    "MetaAppID": "$(META_APP_ID)",
    "ClientToken": "$(CLIENT_TOKEN)",
    "TeamID": "$(DEVELOPMENT_TEAM)",
  ],
  "HandWaveInferenceURL": "$(HANDWAVE_INFERENCE_URL)",
  "ITSAppUsesNonExemptEncryption": false,
  "NSAppTransportSecurity": [
    "NSAllowsLocalNetworking": true
  ],
  "UIBackgroundModes": [
    "bluetooth-peripheral",
    "external-accessory",
  ],
  "NSBluetoothAlwaysUsageDescription":
    "Hand Wave connects to your Meta wearable over Bluetooth.",
  "NSLocalNetworkUsageDescription":
    "Hand Wave connects to the local inference server while recognizing signs.",
  "UISupportedExternalAccessoryProtocols": ["com.meta.ar.wearable"],
  "NSCameraUsageDescription":
    "Hand Wave uses your phone or Meta wearable camera to interpret signs.",
  "UIApplicationSceneManifest": [
    "UIApplicationSupportsMultipleScenes": false
  ],
  "UIApplicationSupportsIndirectInputEvents": true,
  "UILaunchScreen": [
    "UIColorName": "LaunchBackground",
    "UIImageName": "LaunchMark",
    "UIImageRespectsSafeAreaInsets": true,
  ],
  "UISupportedInterfaceOrientations": [
    "UIInterfaceOrientationPortrait"
  ],
]

let project = Project(
  name: "HandWave",
  organizationName: "Hand Wave",
  options: .options(
    automaticSchemesOptions: .enabled(),
    defaultKnownRegions: ["Base", "en"],
    developmentRegion: "en"
  ),
  settings: .settings(
    base: [
      "SWIFT_VERSION": "6.0",
      "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
      "STRING_CATALOG_GENERATE_SYMBOLS": "YES",
      "MARKETING_VERSION": "0.1.0",
      "CURRENT_PROJECT_VERSION": "2",
    ],
    configurations: [
      .debug(name: "Debug", xcconfig: "Configurations/HandWave.xcconfig"),
      .release(
        name: "Release",
        settings: [
          "HANDWAVE_INFERENCE_URL": "https://handwave.sh"
        ],
        xcconfig: "Configurations/HandWave.xcconfig"
      ),
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
      resources: [
        "../../packages/contract/config.json"
      ],
      buildableFolders: [
        "HandWave/Sources",
        "HandWave/Resources",
      ],
      entitlements: "HandWave/HandWave.entitlements",
      dependencies: [
        .external(name: "MWDATCore"),
        .external(name: "MWDATCamera"),
      ],
      settings: .settings(
        base: [
          "CODE_SIGN_STYLE": "Automatic"
        ]
      )
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
