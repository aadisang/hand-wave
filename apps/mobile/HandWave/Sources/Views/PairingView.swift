import SwiftUI

struct PairingView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    VStack(spacing: 0) {
      Spacer(minLength: Spacing.xl)
      Hero()
      Spacer(minLength: Spacing.xl)
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
      Image(systemName: "hand.wave")
        .font(.system(size: 28, weight: .medium))
        .foregroundStyle(.textPrimary)
        .frame(width: 64, height: 64)
        .background {
          ZStack {
            shape.fill(.surface)
            shape.fill(
              LinearGradient(
                colors: [.white.opacity(0.08), .clear],
                startPoint: .top,
                endPoint: .center
              )
            )
          }
        }
        .overlay(shape.strokeBorder(.white.opacity(0.12)))
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

  private var shape: RoundedRectangle {
    RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
  }
}

private struct PrimaryAction: View {
  @Environment(AppModel.self) private var appModel
  @State private var taps = 0

  var body: some View {
    Button {
      taps &+= 1
      tap()
    } label: {
      HStack(spacing: Spacing.sm) {
        if busy {
          ProgressView()
            .controlSize(.small)
            .tint(.textPrimary)
        }
        Text(title)
          .font(.satoshi(15, .semibold))
      }
      .foregroundStyle(.textPrimary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, Spacing.xs)
    }
    .buttonStyle(.glass)
    .controlSize(.large)
    .buttonBorderShape(.capsule)
    .disabled(disabled)
    .sensoryFeedback(Haptic.primaryTap, trigger: taps)
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

  private var busy: Bool {
    if !appModel.wearables.isRegistered { return appModel.wearables.isRegistering }
    return appModel.stream.status == .connecting
  }

  private var title: String {
    if !appModel.wearables.isRegistered {
      return appModel.wearables.isRegistering ? "Connecting" : "Connect Glasses"
    }
    return appModel.stream.status == .connecting ? "Starting" : "Start Streaming"
  }

  private var disabled: Bool {
    if !appModel.wearables.isRegistered { return appModel.wearables.isRegistering }
    if appModel.stream.status == .connecting { return true }
    return appModel.wearables.devices.isEmpty || !appModel.stream.hasActiveDevice
  }
}
