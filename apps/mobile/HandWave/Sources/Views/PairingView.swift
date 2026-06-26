import SwiftUI

struct PairingView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: Spacing.xl)
      Hero()
      Spacer(minLength: Spacing.xl)
      PrimaryAction()
    }
    .padding(.horizontal, Spacing.xl)
    .padding(.top, Spacing.lg)
    .padding(.bottom, Spacing.xl)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.canvas)
    .animation(Motion.standard, value: appModel.wearables.isRegistered)
  }
}

private struct Hero: View {
  var body: some View {
    VStack(spacing: Spacing.xl) {
      Image("BrandMark")
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 64, height: 64)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .shadow(color: .black.opacity(0.5), radius: 18, y: 10)

      VStack(spacing: Spacing.sm) {
        Text("Hand Wave")
          .font(.appLargeTitle)
          .tracking(-0.4)
          .foregroundStyle(.textPrimary)
        Text("Sign language, from your wearable.")
          .font(.appCallout)
          .foregroundStyle(.textSecondary)
          .multilineTextAlignment(.center)
      }
    }
  }

}

private struct PrimaryAction: View {
  @Environment(AppModel.self) private var appModel
  @State private var taps = 0

  var body: some View {
    VStack(spacing: Spacing.md) {
      if state.showsReadinessLine {
        ReadinessLine(state: state)
      }

      Button {
        taps &+= 1
        tap()
      } label: {
        HStack(spacing: Spacing.sm) {
          if state.isBusy {
            ProgressView()
              .controlSize(.small)
              .tint(.textPrimary)
          }
          Text(state.buttonTitle)
            .font(.satoshi(15, .semibold))
        }
        .foregroundStyle(.textPrimary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xs)
      }
      .buttonStyle(.glass)
      .controlSize(.large)
      .buttonBorderShape(.capsule)
      .disabled(!state.isActionable)
    }
    .sensoryFeedback(Haptic.primaryTap, trigger: taps)
    .animation(Motion.standard, value: state)
  }

  private func tap() {
    Task {
      if appModel.wearables.isRegistered {
        if await appModel.wearables.ensureCameraPermission() {
          await appModel.stream.start()
        }
      } else {
        await appModel.wearables.connect()
      }
    }
  }

  private var state: PairingActionState {
    if appModel.wearables.isRegistering {
      return .registering
    }
    if !appModel.wearables.isRegistered {
      return .needsRegistration
    }
    if appModel.stream.status == .connecting {
      return .startingStream
    }
    if appModel.stream.hasActiveDevice {
      return .ready
    }
    if appModel.wearables.devices.isEmpty {
      return .waitingForDevice
    }
    return .waitingForActiveDevice
  }
}

private struct ReadinessLine: View {
  let state: PairingActionState

  var body: some View {
    HStack(alignment: .top, spacing: Spacing.sm) {
      Image(systemName: state.systemImage)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(state.iconStyle)
        .frame(width: 22, height: 22)

      VStack(alignment: .leading, spacing: 3) {
        Text(state.headline)
          .font(.satoshi(14, .semibold))
          .foregroundStyle(.textPrimary)
        Text(state.detail)
          .font(.appFootnote)
          .foregroundStyle(.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 0)
    }
    .padding(.horizontal, Spacing.lg)
    .padding(.vertical, Spacing.md)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    .accessibilityElement(children: .combine)
  }
}

private enum PairingActionState: Equatable {
  case needsRegistration
  case registering
  case waitingForDevice
  case waitingForActiveDevice
  case ready
  case startingStream

  var headline: String {
    switch self {
    case .needsRegistration: "Connect your glasses"
    case .registering: "Finish setup in Meta AI"
    case .waitingForDevice: "Glasses are paired"
    case .waitingForActiveDevice: "Glasses are paired"
    case .ready: "Glasses are ready"
    case .startingStream: "Opening camera stream"
    }
  }

  var detail: String {
    switch self {
    case .needsRegistration:
      "Approve Hand Wave in Meta AI to pair this app."
    case .registering:
      "Return here after approving access in Meta AI."
    case .waitingForDevice:
      "Open the glasses and keep them near this phone."
    case .waitingForActiveDevice:
      "Open the glasses or put them on before streaming."
    case .ready:
      "Camera access is available for this session."
    case .startingStream:
      "Keep the glasses open while the stream starts."
    }
  }

  var buttonTitle: String {
    switch self {
    case .needsRegistration: "Connect Glasses"
    case .registering: "Connecting"
    case .waitingForDevice, .waitingForActiveDevice: "Waiting for Glasses"
    case .ready: "Start Streaming"
    case .startingStream: "Starting"
    }
  }

  var systemImage: String {
    switch self {
    case .needsRegistration: "link"
    case .registering, .startingStream: "hourglass"
    case .waitingForDevice, .waitingForActiveDevice: "eyeglasses"
    case .ready: "checkmark.circle.fill"
    }
  }

  var iconStyle: Color {
    switch self {
    case .ready: Color(hex: 0x9EE7C8)
    case .waitingForDevice, .waitingForActiveDevice: Color(hex: 0xF2C96D)
    default: Color(hex: 0xF5F5F5)
    }
  }

  var isActionable: Bool {
    switch self {
    case .needsRegistration, .ready: true
    case .registering, .waitingForDevice, .waitingForActiveDevice, .startingStream: false
    }
  }

  var isBusy: Bool {
    switch self {
    case .registering, .startingStream: true
    default: false
    }
  }

  var showsReadinessLine: Bool {
    self != .ready
  }

}
