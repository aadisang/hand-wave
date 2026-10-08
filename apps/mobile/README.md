# Hand Wave Mobile

SwiftUI iOS client for camera-stream sign recognition with Meta Wearables DAT SDK 1.0.0.

## Setup

Requires Xcode 26 or later, Tuist, and CocoaPods; add Meta credentials and your Apple development team to the local configuration:

```sh
cp apps/mobile/Configurations/HandWave.xcconfig.example apps/mobile/Configurations/HandWave.xcconfig
```

Keep `pnpm dev:mobile` running to configure the Debug backend, then open the workspace from the repository root:

```sh
moon run mobile:open
```

Run `pnpm test --native-only` for the live client/service check and saved `.xcresult` evidence; physical camera-to-speech behavior still needs a device check.
