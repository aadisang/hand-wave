import SwiftUI

// Semantic colors — the web client's dark theme, converted oklch -> sRGB.
// Monochrome (near-white on near-black); the only accent is the system red on
// the Stop button. Dark-only, so these are fixed values.

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

extension ShapeStyle where Self == Color {
  /// App canvas — web `--background`.
  static var canvas: Color { Color(hex: 0x0C0C0C) }
  /// Camera backdrop — web `--stage`.
  static var stage: Color { Color(hex: 0x0A0A0A) }
  /// Raised surface — web `--card`.
  static var surface: Color { Color(hex: 0x131313) }
  /// Primary text — web `--foreground`.
  static var textPrimary: Color { Color(hex: 0xF5F5F5) }
  /// Muted text — web `--muted-foreground`.
  static var textSecondary: Color { Color(hex: 0x868686) }
  /// Button tint — web `--primary`.
  static var primarySolid: Color { Color(hex: 0xF5F5F5) }
}
