# Hand Wave Mobile

SwiftUI iOS client for camera-stream sign recognition with Meta wearables.

## Setup

The app uses Meta Wearables DAT SDK 1.0.0 and requires Xcode 26 or later, Tuist, and CocoaPods.
Create the optional local configuration before using a physical device:

```sh
cp apps/mobile/Configurations/HandWave.xcconfig.example apps/mobile/Configurations/HandWave.xcconfig
```

Add your Meta app credentials and Apple development team to that file.

Run `pnpm dev:mobile` from the repository root before building Debug. It starts a
temporary Modal backend in the `dev` environment, verifies recognition, and
writes the ignored `Configurations/DebugEndpoint.xcconfig` automatically. Keep
the command running while testing. No phone IP settings are needed. Debug never
defaults to production; without the launcher, it reports a missing dev service.

The manual Release workflow deploys a backend for the same Git commit and writes
`Configurations/ReleaseEndpoint.xcconfig` after verification. The Release test
suite must connect to that service before the signed app is built and uploaded.
Do not edit either generated endpoint file.

Camera images stay on the phone; the app sends landmarks for cloud recognition.
Connection failures show the actual error and retry automatically. The full
initial connection attempt has a 120-second deadline for a cloud cold start.

Generate dependencies and open the workspace from the repository root:

```sh
moon run mobile:open
```

Run the iOS tests with:

```sh
moon run mobile:test
```
