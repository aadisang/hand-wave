import CoreText
import SwiftUI

// Satoshi — the same typeface as the web client. The variable WOFF2 can't load
// on iOS, so four static TTFs live in `Resources/Fonts` and register at launch.

enum AppFont {
  static func register() {
    for face in ["Satoshi-Regular", "Satoshi-SemiBold"] {
      let url = Bundle.main.url(forResource: face, withExtension: "ttf")!
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
  }

  static func name(for weight: Font.Weight) -> String {
    weight == .semibold ? "Satoshi-SemiBold" : "Satoshi-Regular"
  }
}

extension Font {
  static func satoshi(_ size: CGFloat, _ weight: Font.Weight, relativeTo style: Font.TextStyle = .body) -> Font {
    .custom(AppFont.name(for: weight), size: size, relativeTo: style)
  }

  static let appLargeTitle = satoshi(30, .semibold, relativeTo: .largeTitle)
  static let appBody = satoshi(15, .regular, relativeTo: .body)
  static let appCallout = satoshi(14, .regular, relativeTo: .callout)
  static let appFootnote = satoshi(13, .regular, relativeTo: .footnote)
}
