import SwiftUI
import UIKit

struct ShakeDetector: UIViewRepresentable {
  let onShake: () -> Void

  func makeUIView(context: Context) -> ShakeView {
    ShakeView(onShake: onShake)
  }

  func updateUIView(_ view: ShakeView, context: Context) {
    view.onShake = onShake
  }
}

final class ShakeView: UIView {
  var onShake: () -> Void

  init(onShake: @escaping () -> Void) {
    self.onShake = onShake
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var canBecomeFirstResponder: Bool {
    true
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      DispatchQueue.main.async { [weak self] in self?.becomeFirstResponder() }
    }
  }

  override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if motion == .motionShake {
      onShake()
    }
  }
}
