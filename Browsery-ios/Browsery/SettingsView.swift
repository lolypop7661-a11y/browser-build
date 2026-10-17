import SwiftUI

/// Settings, grouped like the design: Browsing, Privacy, Hey Groq, Look, About.
struct SettingsView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @State private var confirmClear = false
    @State private var keyDraft = ""
    @State private var showKey = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                group("BROWSING") {
                    row("Search engine", "Used in the address bar") {
                        Picker("Search engine", selection: $store.engine) {
                            ForEach(Store.engines, id: \.self) { Text($0 == "Browsery" ? "Browsery (Mojeek)" : $0).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .tint(pal.secondaryInk)
                        .labelsHidden()
                    }
                    divider
                    toggleRow("Search suggestions", "From history and bookmarks", isOn: $store.suggestions)
                }

                group("PRIVACY") {
                    toggleRow("Privacy shield", "Blocks ads and trackers", isOn: Binding(get: { store.shield }, set: { browser.setShield($0) }))
                    divider
                    toggleRow("HTTPS only", "Upgrades sites to a secure connection", isOn: $store.httpsOnly)
                    divider
                    row("Clear browsing data", "History, cookies, cache") {
                        Button("Clear") { confirmClear = true }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(pal.danger)
                    }
                }

                group("HEY GROQ") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Groq API key").font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink)
                        Text(store.groqKey.isEmpty ? "Hey Groq needs your own free key. It stays in this phone's Keychain." : "Saved in this phone's Keychain.")
                            .font(.system(size: 13))
                            .foregroundStyle(pal.inkMuted)
                        HStack(spacing: 8) {
                            Group {
                                if showKey { TextField("gsk_…", text: $keyDraft) } else { SecureField("gsk_…", text: $keyDraft) }
                            }
                            .font(.system(size: 15, design: .monospaced))
                            .foregroundStyle(pal.ink)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 12)
                            .frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(pal.void))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(pal.lineStrong, lineWidth: 1))
                            Button { showKey.toggle() } label: {
                                Image(systemName: showKey ? "eye.slash" : "eye").foregroundStyle(pal.inkMuted).frame(width: 36, height: 44)
                            }
                            .accessibilityLabel(showKey ? "Hide key" : "Show key")
                            Button("Save") {
                                store.groqKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                                browser.show(store.groqKey.isEmpty ? "Groq key removed" : "Groq key saved")
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(pal.onAccent)
                            .padding(.horizontal, 14)
                            .frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(pal.accent))
                        }
                        Link("Get a free key at console.groq.com", destination: URL(string: "https://console.groq.com/keys")!)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(pal.secondaryInk)
                    }
                    .padding(14)
                    divider
                    row("Model", "Bigger is smarter, smaller is faster") {
                        Picker("Model", selection: $store.groqModel) {
                            ForEach(Store.models, id: \.self) { Text($0.replacingOccurrences(of: "openai/", with: "")).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .tint(pal.secondaryInk)
                        .labelsHidden()
                    }
                }

                group("LOOK") {
                    toggleRow("Chill mode", "Plain look, no effects", isOn: $store.chill)
                    divider
                    row("Theme", store.chill ? "Chill mode follows your phone" : "Full Browsery is always dark space") {
                        Text(store.chill ? "Automatic" : "Dark").font(.system(size: 14)).foregroundStyle(pal.secondaryInk)
                    }
                }

                group("ABOUT") {
                    row("Browsery for iPhone", "Private by default. Made with Marea.") {
                        Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                            .font(.system(size: 14)).foregroundStyle(pal.inkMuted)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { keyDraft = store.groqKey }
        .confirmationDialog("Clear browsing data?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear history, cookies and cache", role: .destructive) { browser.clearBrowsingData() }
        } message: {
            Text("You'll be signed out of most websites. Bookmarks and favourites stay.")
        }
    }

    private var divider: some View {
        Rectangle().fill(pal.surfaceMuted).frame(height: 1)
    }

    private func group<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .tracking(1.9)
                .foregroundStyle(pal.secondary)
                .padding(.horizontal, 4)
            VStack(spacing: 0) { content() }
                .mareaCard(pal)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func row<Trailing: View>(_ title: String, _ sub: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink)
                Text(sub).font(.system(size: 13)).foregroundStyle(pal.inkMuted)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
    }

    private func toggleRow(_ title: String, _ sub: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink)
                Text(sub).font(.system(size: 13)).foregroundStyle(pal.inkMuted)
            }
        }
        .tint(pal.accent)
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
    }
}
