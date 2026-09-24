import SwiftUI
import UIKit

/// Implementation spec §1.3. Light values are Phase 11.1's warm palette,
/// unchanged; the dark set is new for the dim cellar / restaurant / shop
/// context. Follows the system appearance — no in-app switch in v1.
enum Theme {
    static let bg = Color(light: 0xFBF7F1, dark: 0x191413)
    static let surface = Color(light: 0xFFFFFF, dark: 0x241C1A)
    static let surface2 = Color(light: 0xF4ECE2, dark: 0x312624)
    static let line = Color(light: 0xE6DACB, dark: 0x403230)
    static let text = Color(light: 0x241C1A, dark: 0xF5EDE5)
    static let textMuted = Color(light: 0x6E6059, dark: 0xA5948B)
    static let accent = Color(light: 0x7A2333, dark: 0xC4566A)
    static let accentSoft = Color(light: 0xF3DFE2, dark: 0x3A1F25)
    static let accent2 = Color(light: 0xB08A3E, dark: 0xD6AC5C)
    static let accent2Soft = Color(light: 0xF1E7D2, dark: 0x372D1B)
    static let green = Color(light: 0x3F6B4C, dark: 0x7FB08E)
    static let greenSoft = Color(light: 0xE1EBE3, dark: 0x1E2E23)
    static let redPill = Color(light: 0xB3261E, dark: 0xE5716A)
    static let redSoft = Color(light: 0xFBE5E3, dark: 0x331C1B)

    /// These encode real wine colour, so they don't change with appearance.
    static let redWine = Color(hex: 0x7A2333)
    static let whiteWine = Color(hex: 0xC9A227)
    static let roseWine = Color(hex: 0xB5687F)

    static func colour(for wine: WineColor?) -> Color {
        switch wine {
        case .red: return redWine
        case .white: return whiteWine
        case .rose: return roseWine
        case nil: return textMuted
        }
    }

    // Geometry (§1.1)
    static let sideMargin: CGFloat = 16
    static let widgetGap: CGFloat = 12
    static let rowGap: CGFloat = 10
    static let cardRadius: CGFloat = 14
    static let buttonRadius: CGFloat = 10
    static let fieldRadius: CGFloat = 8
    static let minHitTarget: CGFloat = 44
}

/// Domine (display) / Work Sans (body), §1.2. Until the font files are
/// bundled, `Font.custom` falls back to the system face — layout is unchanged,
/// only the typeface differs.
enum AppFont {
    static func largeTitle() -> Font { .custom("Domine", size: 32, relativeTo: .largeTitle).weight(.bold) }
    static func cardTitle() -> Font { .custom("Domine", size: 15.5, relativeTo: .headline).weight(.semibold) }
    static func detailTitle() -> Font { .custom("Domine", size: 19, relativeTo: .title3).weight(.semibold) }
    static func sectionLabel() -> Font { .custom("Work Sans", size: 11, relativeTo: .caption).weight(.bold) }
    static func body() -> Font { .custom("Work Sans", size: 13.5, relativeTo: .body) }
    static func meta() -> Font { .custom("Work Sans", size: 12.5, relativeTo: .subheadline) }
    static func badge() -> Font { .custom("Work Sans", size: 11, relativeTo: .caption2).weight(.semibold) }
}

extension Color {
    init(hex: UInt32) {
        self.init(uiColor: UIColor(hex: hex))
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: 1)
    }
}
