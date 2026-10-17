import SwiftUI

/// Tab switcher: a grid of cards, normal or private, with New tab and Reopen closed.
struct TabsView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @Environment(\.dismiss) private var dismiss
    @State private var privateMode: Bool

    init(startPrivate: Bool) {
        _privateMode = State(initialValue: startPrivate)
    }

    private var shown: [Tab] { browser.tabs.filter { $0.isPrivate == privateMode } }
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Tabs")
                    .font(.system(size: 22, weight: .semibold))
                    .tracking(-0.4)
                Spacer()
                HStack(spacing: 2) {
                    segment("\(browser.tabs.filter { !$0.isPrivate }.count) open", selected: !privateMode) { privateMode = false }
                    segment("Private", selected: privateMode) { privateMode = true }
                }
                .padding(3)
                .background(RoundedRectangle(cornerRadius: 12).fill(pal.canvas))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(pal.line, lineWidth: 1))
            }
            .foregroundStyle(pal.ink)
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 12)

            ScrollView {
                if shown.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: privateMode ? "eyeglasses" : "square.on.square")
                            .font(.system(size: 34, weight: .light))
                            .foregroundStyle(pal.secondary)
                        Text(privateMode ? "No private tabs" : "No tabs")
                            .font(.system(size: 18, weight: .semibold))
                        Text(privateMode ? "Private tabs don't save history, cookies or site data after you close them." : "Open a new tab to start browsing.")
                            .font(.system(size: 14))
                            .foregroundStyle(pal.inkMuted)
                            .multilineTextAlignment(.center)
                    }
                    .foregroundStyle(pal.ink)
                    .padding(40)
                    .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(shown) { t in
                            TabCard(tab: t, active: t.id == browser.current?.id) {
                                browser.select(t)
                                dismiss()
                            } close: {
                                withAnimation(.spring(duration: 0.3)) { browser.close(t) }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
                }
            }

            HStack(spacing: 10) {
                Button {
                    Haptic.tap()
                    browser.newTab(isPrivate: privateMode)
                    dismiss()
                } label: {
                    Label(privateMode ? "New private tab" : "New tab", systemImage: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(pal.onAccent)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(pal.accent))
                        .shadow(color: pal.isSpace ? pal.accent.opacity(0.22) : .clear, radius: 10, y: 6)
                }
                .buttonStyle(PressStyle())
                .accessibilityIdentifier("newTab")
                if privateMode && !shown.isEmpty {
                    outlineButton("Close all") { browser.closeAll(isPrivate: true) }
                } else {
                    outlineButton("Reopen closed") {
                        browser.reopenClosed()
                        dismiss()
                    }
                    .disabled(browser.closed.isEmpty)
                    .opacity(browser.closed.isEmpty ? 0.5 : 1)
                }
                Button { dismiss() } label: {
                    Text("Done")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(pal.secondaryInk)
                        .frame(minWidth: 52, minHeight: 52)
                }
                .disabled(browser.current == nil)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
        }
        .background(
            ZStack {
                pal.void
                if pal.isSpace {
                    RadialGradient(colors: [pal.secondary.opacity(0.07), .clear], center: UnitPoint(x: 0.7, y: 0.3), startRadius: 0, endRadius: 320)
                }
            }
            .ignoresSafeArea()
        )
    }

    private func segment(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { Haptic.tap(); withAnimation(.easeOut(duration: 0.2)) { action() } }) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? pal.ink : pal.inkMuted)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(selected ? pal.surfaceMuted : .clear))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func outlineButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(pal.ink)
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(pal.lineStrong, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
    }
}

private struct TabCard: View {
    @ObservedObject var tab: Tab
    let active: Bool
    let open: () -> Void
    let close: () -> Void
    @Environment(\.pal) private var pal

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(tab.url == nil ? "B" : siteLetter(tab.host))
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 18, height: 18)
                    .background(RoundedRectangle(cornerRadius: 5).fill(pal.surfaceMuted))
                Text(tab.displayTitle)
                    .font(.system(size: 13))
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(pal.inkMuted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close \(tab.displayTitle)")
            }
            .foregroundStyle(pal.ink)
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .frame(height: 40)
            .overlay(alignment: .bottom) { Rectangle().fill(pal.line).frame(height: 1) }

            ZStack {
                if let img = tab.snapshot, tab.url != nil {
                    Color.clear.overlay(alignment: .top) {
                        Image(uiImage: img).resizable().scaledToFill()
                    }
                    .clipped()
                } else if tab.url != nil {
                    LinearGradient(stops: [.init(color: .white, location: 0), .init(color: .white, location: 0.3), .init(color: Color(hex: 0xF7F5F0), location: 0.3)], startPoint: .top, endPoint: .bottom)
                } else {
                    ZStack {
                        pal.void
                        RadialGradient(colors: [pal.secondary.opacity(0.25), .clear], center: UnitPoint(x: 0.5, y: 0.3), startRadius: 0, endRadius: 110)
                        Image(systemName: tab.isPrivate ? "eyeglasses" : "sparkles")
                            .font(.system(size: 26, weight: .light))
                            .foregroundStyle(pal.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: 236)
        .background(pal.canvas)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(active ? pal.accent : pal.line, lineWidth: 1))
        .shadow(color: active && pal.isSpace ? pal.accent.opacity(0.14) : .clear, radius: 14)
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .onTapGesture(perform: open)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
    }
}
