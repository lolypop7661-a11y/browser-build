import SwiftUI

/// Marea roles. Full Browsery is the dark "space" look; Chill mode is plain Marea that follows the phone's light or dark setting.
struct Pal {
    var void: Color
    var canvas: Color
    var surface: Color
    var surfaceMuted: Color
    var ink: Color
    var inkMuted: Color
    var line: Color
    var lineStrong: Color
    var accent: Color
    var onAccent: Color
    var accentSoft: Color
    var accentInk: Color
    var secondary: Color
    var secondarySoft: Color
    var secondaryInk: Color
    var danger: Color
    var isDark: Bool
    var isSpace: Bool

    static let spaceDark = Pal(
        void: Color(hex: 0x0B100E), canvas: Color(hex: 0x151C19), surface: Color(hex: 0x1D2722), surfaceMuted: Color(hex: 0x26332B),
        ink: Color(hex: 0xF1F3EC), inkMuted: Color(hex: 0xB5C2B7), line: Color(hex: 0x3D5042), lineStrong: Color(hex: 0x728979),
        accent: Color(hex: 0xF29A80), onAccent: Color(hex: 0x301A13), accentSoft: Color(hex: 0x402923), accentInk: Color(hex: 0xFFB8A1),
        secondary: Color(hex: 0x8DD5C0), secondarySoft: Color(hex: 0x203B32), secondaryInk: Color(hex: 0xB2E9D9), danger: Color(hex: 0xFFADB4),
        isDark: true, isSpace: true
    )

    static let chillDark: Pal = {
        var p = Pal.spaceDark
        p.void = Color(hex: 0x151C19)
        p.isSpace = false
        return p
    }()

    static let chillLight = Pal(
        void: Color(hex: 0xF7F5F0), canvas: Color(hex: 0xF7F5F0), surface: Color(hex: 0xFFFFFF), surfaceMuted: Color(hex: 0xEEECE5),
        ink: Color(hex: 0x202622), inkMuted: Color(hex: 0x5D6861), line: Color(hex: 0xD4DAD2), lineStrong: Color(hex: 0x7D897F),
        accent: Color(hex: 0xA63D2F), onAccent: Color(hex: 0xFFFFFF), accentSoft: Color(hex: 0xF7E4DE), accentInk: Color(hex: 0x823125),
        secondary: Color(hex: 0x17645D), secondarySoft: Color(hex: 0xDFEEE8), secondaryInk: Color(hex: 0x15564F), danger: Color(hex: 0xA32A37),
        isDark: false, isSpace: false
    )
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

private struct PalKey: EnvironmentKey {
    static let defaultValue = Pal.spaceDark
}

extension EnvironmentValues {
    var pal: Pal {
        get { self[PalKey.self] }
        set { self[PalKey.self] = newValue }
    }
}

/// A soft press: shrinks a little and gives a light tap.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}

/// First letter of a site, for favourite tiles and tab cards.
func siteLetter(_ text: String) -> String {
    var t = text.lowercased()
    for p in ["https://", "http://", "www.", "m.", "en.m.", "en."] where t.hasPrefix(p) { t.removeFirst(p.count) }
    return t.first.map { String($0).uppercased() } ?? "B"
}

extension View {
    /// The rounded Marea card used across sheets and settings.
    func mareaCard(_ pal: Pal, radius: CGFloat = 16) -> some View {
        background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(LinearGradient(colors: [pal.surface, pal.canvas], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(pal.line, lineWidth: 1))
    }
}
