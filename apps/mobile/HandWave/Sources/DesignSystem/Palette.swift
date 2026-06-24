import SwiftUI

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
  static var canvas: Color { Color(hex: 0x0C0C0C) }
  static var stage: Color { Color(hex: 0x0A0A0A) }
  static var surface: Color { Color(hex: 0x131313) }
  static var textPrimary: Color { Color(hex: 0xF5F5F5) }
  static var textSecondary: Color { Color(hex: 0x868686) }
  static var primarySolid: Color { Color(hex: 0xF5F5F5) }
}
