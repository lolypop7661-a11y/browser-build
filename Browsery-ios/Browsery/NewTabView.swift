import SwiftUI

/// The new tab: Saturn over dark space, a big clock, and your favourites.
struct NewTabView: View {
    let focusAddress: () -> Void
    let openGroq: () -> Void

    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal

    @State private var adding = false
    @State private var newName = ""
    @State private var newURL = ""

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        ScrollView {
            ZStack(alignment: .top) {
                if pal.isSpace {
                    Color.clear
                        .frame(height: 380)
                        .overlay {
                            Image("Saturn")
                                .resizable()
                                .scaledToFill()
                                .opacity(0.85)
                        }
                        .clipped()
                        .overlay {
                            LinearGradient(stops: [
                                .init(color: pal.void.opacity(0.2), location: 0),
                                .init(color: pal.void.opacity(0.35), location: 0.55),
                                .init(color: pal.void, location: 1),
                            ], startPoint: .top, endPoint: .bottom)
                        }
                        .accessibilityHidden(true)
                }

                VStack(alignment: .leading, spacing: 0) {
                    header
                    clock
                        .padding(.top, pal.isSpace ? 118 : 56)
                        .padding(.horizontal, 24)
                    favourites
                        .padding(.top, 26)
                        .padding(.horizontal, 20)
                    if !store.bookmarks.isEmpty { recentBookmarks.padding(.top, 26).padding(.horizontal, 20) }
                    Spacer(minLength: 24)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(pal.void)
        .alert("Add a favourite", isPresented: $adding) {
            TextField("Name", text: $newName)
            TextField("Website address", text: $newURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Add") { addShortcut() }
        } message: {
            Text("It appears on every new tab.")
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) {
                Image("Brand")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 22, height: 22)
                    .foregroundStyle(pal.ink)
                Text("Browsery").font(.system(size: 17, weight: .semibold))
            }
            .foregroundStyle(pal.ink)
            Spacer()
            Button {
                Haptic.tap()
                browser.setShield(!store.shield)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: store.shield ? "checkmark.shield" : "shield.slash")
                    Text(store.shield ? "Shield on" : "Shield off")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(store.shield ? pal.secondaryInk : pal.inkMuted)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Capsule().fill(store.shield ? pal.secondarySoft.opacity(0.8) : pal.surfaceMuted))
                .overlay(Capsule().stroke(store.shield ? pal.secondary.opacity(0.28) : pal.line, lineWidth: 1))
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel(store.shield ? "Privacy shield is on" : "Privacy shield is off")
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
    }

    private var clock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(pal.isSpace ? "SPACE · BROWSERY SEARCH" : "BROWSERY")
                .font(.system(size: 12, weight: .semibold))
                .tracking(2.2)
                .foregroundStyle(pal.secondary)
            TimelineView(.everyMinute) { ctx in
                Text(ctx.date.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute()))
                    .font(.system(size: 66, weight: .ultraLight))
                    .monospacedDigit()
                    .tracking(-2.5)
                    .foregroundStyle(pal.ink)
                    .shadow(color: pal.isSpace ? pal.secondary.opacity(0.22) : .clear, radius: 17)
            }
            Button(action: focusAddress) {
                Text("Where do you want to go?")
                    .font(.system(size: 17))
                    .foregroundStyle(pal.inkMuted)
            }
            .buttonStyle(.plain)
        }
    }

    private var favourites: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Favourites")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(pal.ink)
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(store.shortcuts) { s in
                    tile(letter: siteLetter(s.url == "https://www.openstreetmap.org/" ? "OpenStreetMap" : s.name), name: s.name) {
                        if let u = URL(string: s.url) { browser.current?.load(u) }
                    }
                    .contextMenu {
                        Button(role: .destructive) {
                            store.shortcuts.removeAll { $0.url == s.url }
                        } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                if store.shortcuts.count < 12 {
                    tile(letter: "+", name: "Add") {
                        newName = ""
                        newURL = ""
                        adding = true
                    }
                }
            }
        }
    }

    private var recentBookmarks: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Bookmarks")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(pal.ink)
            VStack(spacing: 0) {
                ForEach(store.bookmarks.prefix(4)) { b in
                    Button {
                        if let u = URL(string: b.url) { browser.current?.load(u) }
                    } label: {
                        HStack(spacing: 12) {
                            Text(siteLetter(b.url))
                                .font(.system(size: 13, weight: .bold))
                                .frame(width: 30, height: 30)
                                .background(RoundedRectangle(cornerRadius: 8).fill(pal.surfaceMuted))
                            Text(b.title).font(.system(size: 15)).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(pal.ink)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 50)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .mareaCard(pal, radius: 14)
        }
    }

    private func tile(letter: String, name: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            VStack(spacing: 7) {
                Text(letter)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(pal.ink)
                    .frame(width: 62, height: 62)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(LinearGradient(colors: [pal.surfaceMuted, pal.canvas], startPoint: .topLeading, endPoint: .bottomTrailing))
                    )
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(pal.line, lineWidth: 1))
                    .shadow(color: .black.opacity(pal.isDark ? 0.3 : 0.06), radius: 13, y: 10)
                Text(name)
                    .font(.system(size: 12))
                    .foregroundStyle(pal.inkMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(name)
    }

    private func addShortcut() {
        let raw = newURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        let withScheme = raw.lowercased().hasPrefix("http") ? raw : "https://" + raw
        guard let u = URL(string: withScheme), u.host != nil else {
            browser.show("That doesn't look like a website address")
            return
        }
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        store.shortcuts.removeAll { $0.url == u.absoluteString }
        store.shortcuts.append(Shortcut(name: name.isEmpty ? (u.host ?? "Site") : name, url: u.absoluteString))
    }
}
