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
        Text("Signs from your glasses.")
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
      if state.showsStatus {
        StatusLine(state: state)
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
      .disabled(!state.canTap)

      if state.showsReset {
        Button("Reset") {
          taps &+= 1
          reconnect()
        }
        .font(.appFootnote)
        .foregroundStyle(.textSecondary)
        .buttonStyle(.plain)
      }
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

  private func reconnect() {
    Task {
      await appModel.stream.stop()
      await appModel.wearables.disconnect()
    }
  }

  private var state: PairingState {
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

private struct StatusLine: View {
  let state: PairingState
  @ScaledMetric private var iconBoxSize = 34
  @ScaledMetric private var iconSize = 15

  var body: some View {
    HStack(alignment: .center, spacing: Spacing.md) {
      icon

      VStack(alignment: .leading, spacing: 3) {
        Text(state.headline)
          .font(.satoshi(14, .semibold))
          .foregroundStyle(.textPrimary)
        Text(state.detail)
          .font(.appFootnote)
          .foregroundStyle(.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .layoutPriority(1)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, Spacing.md)
    .padding(.vertical, Spacing.md)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
    .accessibilityElement(children: .combine)
  }

  private var icon: some View {
    Image(systemName: state.systemImage)
      .font(.system(size: iconSize, weight: .semibold))
      .foregroundStyle(state.iconStyle)
      .frame(width: iconBoxSize, height: iconBoxSize)
      .background(
        Circle()
          .fill(state.iconStyle.opacity(0.14))
      )
      .overlay(
        Circle()
          .strokeBorder(state.iconStyle.opacity(0.18), lineWidth: 1)
      )
      .accessibilityHidden(true)
  }
}

private enum PairingState: Equatable {
  case needsRegistration
  case registering
  case waitingForDevice
  case waitingForActiveDevice
  case ready
  case startingStream

  var headline: String {
    switch self {
    case .needsRegistration: "Connect glasses"
    case .registering: "Finish in Meta AI"
    case .waitingForDevice: "Reconnect glasses"
    case .waitingForActiveDevice: "Open glasses"
    case .ready: "Ready"
    case .startingStream: "Starting camera"
    }
  }

  var detail: String {
    switch self {
    case .needsRegistration:
      "Approve Hand Wave in Meta AI."
    case .registering:
      "Approve, then return here."
    case .waitingForDevice:
      "Meta AI cannot see them."
    case .waitingForActiveDevice:
      "Open or wear them nearby."
    case .ready:
      "Ready to stream."
    case .startingStream:
      "Keep glasses open."
    }
  }

  var buttonTitle: String {
    switch self {
    case .needsRegistration: "Connect"
    case .registering: "Connecting"
    case .waitingForDevice, .waitingForActiveDevice: "Waiting"
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

  var canTap: Bool {
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

  var showsReset: Bool {
    switch self {
    case .waitingForDevice, .waitingForActiveDevice:
      true
    default:
      false
    }
  }

  var showsStatus: Bool {
    self != .ready
  }
}
