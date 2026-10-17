import SwiftUI
import WebKit

@main
struct BrowseryApp: App {
    @StateObject private var store: Store
    @StateObject private var browser: Browser

    init() {
        let s = Store()
        _store = StateObject(wrappedValue: s)
        _browser = StateObject(wrappedValue: Browser(store: s))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(browser)
                .preferredColorScheme(store.chill ? nil : .dark)
                .onOpenURL { url in
                    guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
                    browser.newTab(url: url)
                }
        }
    }
}

enum Panel: Identifiable {
    case menu
    case groq(String?)
    var id: String {
        switch self {
        case .menu: return "menu"
        case .groq(let p): return "groq" + (p ?? "")
        }
    }
}

/// Picks the Marea palette (dark space for full Browsery, plain Marea light or dark for Chill mode) and owns the panels,
/// so switching or closing tabs never closes the tab switcher.
struct RootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.colorScheme) private var scheme
    @State private var panel: Panel?
    @State private var showTabs = false

    var pal: Pal { store.chill ? (scheme == .dark ? .chillDark : .chillLight) : .spaceDark }

    var body: some View {
        Group {
            if let tab = browser.current {
                BrowserScreen(tab: tab, panel: $panel, showTabs: $showTabs)
                    .id(tab.id)
            }
        }
        .environment(\.pal, pal)
        .tint(pal.accent)
        .sheet(item: $panel) { p in
            Group {
                if let tab = browser.current {
                    switch p {
                    case .menu:
                        MenuSheet(tab: tab, openGroq: {
                            panel = nil
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { panel = .groq(nil) }
                        })
                    case .groq(let prompt):
                        GroqView(tab: tab, initialPrompt: prompt)
                    }
                }
            }
            .environmentObject(store)
            .environmentObject(browser)
            .environment(\.pal, pal)
            .tint(pal.accent)
            .preferredColorScheme(store.chill ? nil : .dark)
        }
        .fullScreenCover(isPresented: $showTabs) {
            TabsView(startPrivate: browser.current?.isPrivate ?? false)
                .environmentObject(store)
                .environmentObject(browser)
                .environment(\.pal, pal)
                .tint(pal.accent)
                .preferredColorScheme(store.chill ? nil : .dark)
        }
    }
}

/// Holds the page (or the new tab) above the address bar.
struct BrowserScreen: View {
    @ObservedObject var tab: Tab
    @Binding var panel: Panel?
    @Binding var showTabs: Bool
    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal

    @State private var editing = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                if let w = tab.webView, tab.url != nil {
                    WebViewContainer(webView: w)
                        .background(pal.canvas)
                    if let failure = tab.failure { FailureView(message: failure) { tab.reloadOrStop() } }
                } else {
                    NewTabView(focusAddress: { editing = true }, openGroq: { panel = .groq(nil) })
                }
                if tab.url != nil, tab.failure == nil, pal.isSpace, !editing {
                    Button {
                        Haptic.tap()
                        panel = .groq("Summarize this page in three points")
                    } label: {
                        Label("Summarize page", systemImage: "sparkle")
                            .font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 14)
                            .frame(height: 40)
                            .foregroundStyle(pal.secondaryInk)
                            .background(Capsule().fill(pal.surface.opacity(0.94)))
                            .overlay(Capsule().stroke(pal.secondary.opacity(0.3), lineWidth: 1))
                            .shadow(color: .black.opacity(0.22), radius: 20, y: 10)
                            .shadow(color: pal.secondary.opacity(0.12), radius: 12)
                    }
                    .buttonStyle(PressStyle())
                    .padding(16)
                    .accessibilityIdentifier("summarize")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            BottomBar(tab: tab, editing: $editing,
                      openMenu: { panel = .menu },
                      openGroq: { panel = .groq(nil) },
                      openTabs: { tab.captureSnapshot { showTabs = true } })
        }
        .background(pal.void.ignoresSafeArea())
        .overlay(alignment: .top) {
            if let toast = browser.toast {
                Text(toast)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(pal.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(Capsule().fill(pal.surface))
                    .overlay(Capsule().stroke(pal.line, lineWidth: 1))
                    .shadow(color: .black.opacity(0.22), radius: 20, y: 10)
                    .padding(.top, 8)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .onAppear(perform: smokeHooks)
    }

    /// Launch arguments used by the automated screenshot run, e.g. -smokePanel menu.
    private static var smokeDone = false

    private func smokeHooks() {
        guard !BrowserScreen.smokeDone else { return }
        BrowserScreen.smokeDone = true
        let d = UserDefaults.standard
        if let s = d.string(forKey: "smokeURL"), let u = URL(string: s), tab.url == nil {
            tab.load(u)
        }
        guard let p = d.string(forKey: "smokePanel") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            switch p {
            case "menu", "settings": panel = .menu
            case "groq": panel = .groq(nil)
            case "tabs": tab.captureSnapshot { showTabs = true }
            default: break
            }
        }
    }
}

struct FailureView: View {
    let message: String
    let retry: () -> Void
    @Environment(\.pal) private var pal

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(pal.secondary)
            Text("This page didn't load")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(pal.ink)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(pal.inkMuted)
                .multilineTextAlignment(.center)
            Button(action: retry) {
                Text("Try again")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(pal.onAccent)
                    .padding(.horizontal, 22)
                    .frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 14).fill(pal.accent))
            }
            .buttonStyle(PressStyle())
            .padding(.top, 6)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(pal.void)
    }
}

/// Hosts the tab's WKWebView. The same web view moves between hosts, so pages keep their state.
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        attach(to: v)
        return v
    }

    func updateUIView(_ v: UIView, context: Context) {
        if webView.superview !== v { attach(to: v) }
    }

    private func attach(to v: UIView) {
        v.subviews.forEach { $0.removeFromSuperview() }
        webView.removeFromSuperview()
        webView.frame = v.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.addSubview(webView)
    }
}
