import SwiftUI

/// Safari-style bottom: the address pill with a progress line, then back, forward, Groq or share, menu and tabs.
struct BottomBar: View {
    @ObservedObject var tab: Tab
    @Binding var editing: Bool
    let openMenu: () -> Void
    let openGroq: () -> Void
    let openTabs: () -> Void

    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @FocusState private var focused: Bool
    @State private var text = ""
    @StateObject private var listener = Listener()

    private var home: Bool { tab.url == nil }
    private var showField: Bool { editing || home }

    var body: some View {
        VStack(spacing: 0) {
            if editing { suggestions }
            pill
            if !editing { toolbar } else { Color.clear.frame(height: 10) }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .background(
            LinearGradient(colors: [pal.surface.opacity(pal.isSpace ? 0.98 : 1), pal.canvas], startPoint: .top, endPoint: .bottom)
                .overlay(alignment: .top) { Rectangle().fill(pal.line).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        )
        .onChange(of: editing) { _, now in
            if now {
                text = tab.url?.absoluteString ?? text
                DispatchQueue.main.async { focused = true }
            } else {
                focused = false
            }
        }
        .onChange(of: focused) { _, now in
            if now { editing = true } else if editing { editing = false }
        }
    }

    // MARK: Address pill

    private var pill: some View {
        HStack(spacing: 8) {
            if showField {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(pal.inkMuted)
                TextField("", text: $text, prompt: Text("Search or enter website").foregroundColor(pal.inkMuted))
                    .focused($focused)
                    .font(.system(size: 17))
                    .foregroundStyle(pal.ink)
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit(submit)
                    .accessibilityIdentifier("address")
                if listener.listening {
                    Image(systemName: "waveform")
                        .symbolEffect(.variableColor.iterative)
                        .foregroundStyle(pal.secondary)
                        .frame(width: 32, height: 40)
                } else if text.isEmpty {
                    Button { listener.toggle { heard in text = heard; submit() } } label: {
                        Image(systemName: "mic").font(.system(size: 17)).foregroundStyle(pal.secondary)
                            .frame(width: 36, height: 40)
                    }
                    .accessibilityLabel("Voice search")
                } else if editing {
                    Button { text = "" } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundStyle(pal.inkMuted)
                            .frame(width: 32, height: 40)
                    }
                    .accessibilityLabel("Clear")
                }
                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(pal.onAccent)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(pal.accent))
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel("Go")
            } else {
                Image(systemName: tab.isSecure ? "lock.fill" : "exclamationmark.triangle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tab.isSecure ? pal.secondary : pal.danger)
                    .frame(width: 22)
                    .accessibilityLabel(tab.isSecure ? "Secure connection" : "Not secure")
                Button { editing = true } label: {
                    HStack(spacing: 6) {
                        if tab.isPrivate { Image(systemName: "eyeglasses").foregroundStyle(pal.accent) }
                        Text(tab.host)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .font(.system(size: 16))
                    .foregroundStyle(pal.ink)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("addressLabel")
                Button { tab.reloadOrStop() } label: {
                    Image(systemName: tab.isLoading ? "xmark" : "arrow.clockwise")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(pal.inkMuted)
                        .frame(width: 40, height: 40)
                }
                .accessibilityLabel(tab.isLoading ? "Stop" : "Reload")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 5)
        .frame(height: 50)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(home && pal.isSpace ? pal.surface.opacity(0.95) : pal.void))
        .overlay(alignment: .bottom) {
            if tab.isLoading && !editing {
                GeometryReader { g in
                    LinearGradient(colors: [pal.secondary, pal.accent], startPoint: .leading, endPoint: .trailing)
                        .frame(width: max(12, g.size.width * tab.progress), height: 2)
                        .animation(.easeOut(duration: 0.25), value: tab.progress)
                }
                .frame(height: 2)
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(focused ? pal.secondary : pal.lineStrong, lineWidth: 1))
        .shadow(color: pal.isSpace ? pal.secondary.opacity(home ? 0.14 : 0.06) : .clear, radius: 14)
    }

    // MARK: Suggestions while typing

    @ViewBuilder
    private var suggestions: some View {
        let q = text.trimmingCharacters(in: .whitespaces)
        let hits = q.isEmpty || q == tab.url?.absoluteString ? [] : store.matches(q)
        if !q.isEmpty && q != tab.url?.absoluteString {
            VStack(spacing: 0) {
                ForEach(hits) { b in
                    suggestionRow(icon: store.isBookmarked(URL(string: b.url)) ? "bookmark" : "clock", title: b.title, sub: b.url) {
                        if let u = URL(string: b.url) { tab.load(u) }
                        editing = false
                    }
                }
                suggestionRow(icon: "magnifyingglass", title: "Search for “\(q)”", sub: store.engineLabel) {
                    tab.load(store.searchURL(q))
                    editing = false
                }
            }
            .mareaCard(pal, radius: 14)
            .padding(.bottom, 8)
        }
    }

    private func suggestionRow(icon: String, title: String, sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).foregroundStyle(pal.secondary).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink).lineLimit(1)
                    Text(sub).font(.system(size: 12)).foregroundStyle(pal.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 0) {
            barButton("chevron.backward", "Back", enabled: tab.canGoBack) { tab.back() }
            barButton("chevron.forward", "Forward", enabled: tab.canGoForward) { tab.forward() }
            Group {
                if home || !pal.isSpace && tab.url == nil {
                    Button { Haptic.tap(); openGroq() } label: {
                        Image(systemName: "sparkle")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(pal.onAccent)
                            .frame(width: 46, height: 46)
                            .background(Circle().fill(pal.accent))
                            .shadow(color: pal.isSpace ? pal.accent.opacity(0.3) : .clear, radius: 12)
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("Hey Groq")
                } else if let u = tab.url {
                    ShareLink(item: u) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 20))
                            .foregroundStyle(pal.ink)
                            .frame(width: 46, height: 46)
                    }
                    .accessibilityLabel("Share")
                }
            }
            .frame(maxWidth: .infinity)
            barButton("ellipsis.circle", "Menu", enabled: true, id: "menu") { openMenu() }
            barButton(tabsSymbol, "\(browser.tabs.count) tabs", enabled: true, id: "tabs") { openTabs() }
        }
        .frame(height: 52)
        .padding(.top, 4)
    }

    private var tabsSymbol: String {
        let n = browser.tabs.filter { $0.isPrivate == tab.isPrivate }.count
        return (1...50).contains(n) ? "\(n).square" : "square.on.square"
    }

    private func barButton(_ symbol: String, _ label: String, enabled: Bool, id: String? = nil, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .regular))
                .foregroundStyle(enabled ? pal.ink : pal.lineStrong)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id ?? label)
    }

    private func submit() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let url = store.resolve(t) else { return }
        tab.load(url)
        text = ""
        editing = false
        focused = false
    }
}
