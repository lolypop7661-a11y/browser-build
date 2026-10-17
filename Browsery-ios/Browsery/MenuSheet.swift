import SwiftUI

enum MenuRoute: Hashable {
    case bookmarks, history, downloads, settings
}

/// The menu sheet: this page, eight quick tiles, three switches, and Settings.
struct MenuSheet: View {
    @ObservedObject var tab: Tab
    let openGroq: () -> Void

    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @Environment(\.dismiss) private var dismiss

    @State private var path: [MenuRoute] = []
    @State private var detent: PresentationDetent = .height(640)

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
    private var onPage: Bool { tab.url != nil }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 14) {
                    pageHeader
                    LazyVGrid(columns: columns, spacing: 8) {
                        tile("book", "Bookmarks") { path.append(.bookmarks) }
                        tile("clock.arrow.circlepath", "History") { path.append(.history) }
                        tile("arrow.down.circle", "Downloads") { path.append(.downloads) }
                        tile("magnifyingglass", "Find", enabled: onPage) { after { tab.find() } }
                        tile("doc.plaintext", "Reader", enabled: onPage) { after { tab.reader() } }
                        tile(tab.night ? "moon.fill" : "moon", "Night Shift", enabled: onPage, on: tab.night) { after { tab.toggleNight() } }
                        tile("desktopcomputer", "Desktop site", enabled: onPage, on: tab.desktop) { after { tab.toggleDesktop() } }
                        if let u = tab.url {
                            ShareLink(item: u) { tileLabel("square.and.arrow.up", "Share", enabled: true, on: false) }
                                .buttonStyle(PressStyle())
                        } else {
                            tile("sparkle", "Hey Groq") { openGroq() }
                        }
                    }
                    switches
                    NavigationLink(value: MenuRoute.settings) {
                        Label("Settings", systemImage: "gearshape")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(pal.ink)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(pal.lineStrong, lineWidth: 1))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityIdentifier("settings")
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 24)
            }
            .background(sheetBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: MenuRoute.self) { route in
                Group {
                    switch route {
                    case .bookmarks: BookmarksView(close: { dismiss() })
                    case .history: HistoryView(close: { dismiss() })
                    case .downloads: DownloadsView()
                    case .settings: SettingsView()
                    }
                }
                .background(sheetBackground)
                .toolbarBackground(pal.canvas, for: .navigationBar)
                .toolbarColorScheme(pal.isDark ? .dark : .light, for: .navigationBar)
            }
        }
        .tint(pal.secondaryInk)
        .presentationDetents([.height(640), .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(24)
        .presentationBackground(pal.canvas)
        .onChange(of: path) { _, p in if !p.isEmpty { detent = .large } }
        .onAppear {
            if UserDefaults.standard.string(forKey: "smokePanel") == "settings", path.isEmpty {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { path = [.settings] }
            }
        }
    }

    private var sheetBackground: some View {
        LinearGradient(colors: [pal.surface, pal.canvas], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
    }

    private var pageHeader: some View {
        HStack(spacing: 12) {
            Text(onPage ? siteLetter(tab.host) : "B")
                .font(.system(size: 16, weight: .semibold, design: .serif))
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(pal.surfaceMuted))
            VStack(alignment: .leading, spacing: 2) {
                Text(tab.displayTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Text(onPage ? "\(tab.host) · \(tab.isSecure ? "secure" : "not secure")" : (tab.isPrivate ? "Private tab" : "New tab"))
                    .font(.system(size: 13))
                    .foregroundStyle(pal.inkMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let u = tab.url {
                let marked = store.isBookmarked(u)
                Button {
                    Haptic.tap()
                    store.toggleBookmark(url: u, title: tab.title)
                    browser.show(marked ? "Bookmark removed" : "Bookmarked")
                } label: {
                    Image(systemName: marked ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(marked ? pal.accent : pal.ink)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(marked ? pal.accentSoft : pal.surfaceMuted))
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel(marked ? "Remove bookmark" : "Bookmark this page")
            }
        }
        .foregroundStyle(pal.ink)
        .padding(.horizontal, 4)
    }

    private var switches: some View {
        VStack(spacing: 0) {
            switchRow("Privacy shield", "Blocks ads and trackers on this phone", isOn: Binding(get: { store.shield }, set: { browser.setShield($0) }))
            Divider().overlay(pal.surfaceMuted)
            switchRow("Private tab", tab.isPrivate ? "This tab saves nothing after you close it" : "Nothing is saved after you close it",
                      isOn: Binding(get: { tab.isPrivate }, set: { on in
                          dismiss()
                          DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                              if let other = browser.tabs.last(where: { $0.isPrivate == on }) { browser.select(other) } else { browser.newTab(isPrivate: on) }
                          }
                      }))
            Divider().overlay(pal.surfaceMuted)
            switchRow("Chill mode", "Plain look, no effects", isOn: $store.chill)
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(pal.canvas))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(pal.line, lineWidth: 1))
    }

    private func switchRow(_ title: String, _ sub: String, isOn: Binding<Bool>) -> some View {
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

    private func tile(_ symbol: String, _ label: String, enabled: Bool = true, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            tileLabel(symbol, label, enabled: enabled, on: on)
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func tileLabel(_ symbol: String, _ label: String, enabled: Bool, on: Bool) -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 20))
                .foregroundStyle(on ? pal.accent : pal.ink)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(pal.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 76)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? pal.accentSoft : pal.canvas))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(on ? pal.accent.opacity(0.5) : pal.line, lineWidth: 1))
        .opacity(enabled ? 1 : 0.45)
    }

    /// Close the sheet, then act on the page.
    private func after(_ action: @escaping () -> Void) {
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: action)
    }
}

// MARK: Bookmarks, History, Downloads

struct BookmarksView: View {
    let close: () -> Void
    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal

    var body: some View {
        List {
            if store.bookmarks.isEmpty {
                EmptyNote(symbol: "book", title: "No bookmarks yet", text: "Tap the bookmark button in the menu to save a page here.")
            }
            ForEach(store.bookmarks) { b in
                SiteRow(title: b.title, url: b.url) {
                    if let u = URL(string: b.url) { browser.current?.load(u) }
                    close()
                }
            }
            .onDelete { store.bookmarks.remove(atOffsets: $0) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle("Bookmarks")
        .toolbar { if !store.bookmarks.isEmpty { EditButton() } }
    }
}

struct HistoryView: View {
    let close: () -> Void
    @EnvironmentObject var store: Store
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal
    @State private var query = ""
    @State private var confirmClear = false

    private var shown: [Visit] {
        let q = query.lowercased()
        return q.isEmpty ? store.history : store.history.filter { $0.title.lowercased().contains(q) || $0.url.lowercased().contains(q) }
    }

    private struct Day: Identifiable {
        let id: String
        var visits: [Visit]
    }

    private var groups: [Day] {
        let cal = Calendar.current
        var out: [Day] = []
        for v in shown {
            let key = cal.isDateInToday(v.date) ? "Today" : cal.isDateInYesterday(v.date) ? "Yesterday" : v.date.formatted(.dateTime.weekday(.wide).day().month())
            if out.last?.id == key { out[out.count - 1].visits.append(v) } else { out.append(Day(id: key, visits: [v])) }
        }
        return out
    }

    var body: some View {
        List {
            if store.history.isEmpty {
                EmptyNote(symbol: "clock", title: "No history", text: "Pages you visit show up here. Private tabs are never saved.")
            }
            ForEach(groups) { group in
                Section {
                    ForEach(group.visits) { v in
                        SiteRow(title: v.title, url: v.url, time: v.date.formatted(date: .omitted, time: .shortened)) {
                            if let u = URL(string: v.url) { browser.current?.load(u) }
                            close()
                        }
                        .swipeActions {
                            Button(role: .destructive) { store.history.removeAll { $0.id == v.id } } label: { Label("Delete", systemImage: "trash") }
                        }
                    }
                } header: {
                    Text(group.id.uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(pal.secondary)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .searchable(text: $query, prompt: "Search history")
        .navigationTitle("History")
        .toolbar {
            if !store.history.isEmpty {
                Button("Clear") { confirmClear = true }
            }
        }
        .confirmationDialog("Clear all history?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear history", role: .destructive) { store.history = [] }
        }
    }
}

struct DownloadsView: View {
    @EnvironmentObject var browser: Browser
    @Environment(\.pal) private var pal

    var body: some View {
        List {
            if browser.downloads.isEmpty {
                EmptyNote(symbol: "arrow.down.circle", title: "No downloads", text: "Files you download are saved in the Files app under On My iPhone › Browsery › Downloads.")
            }
            ForEach(browser.downloads, id: \.self) { file in
                HStack(spacing: 12) {
                    Image(systemName: "doc")
                        .foregroundStyle(pal.secondary)
                        .frame(width: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.lastPathComponent).font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink).lineLimit(1)
                        Text(size(of: file)).font(.system(size: 12)).foregroundStyle(pal.inkMuted)
                    }
                    Spacer(minLength: 0)
                    ShareLink(item: file) {
                        Image(systemName: "square.and.arrow.up").foregroundStyle(pal.ink)
                    }
                    .buttonStyle(.borderless)
                }
                .listRowBackground(Color.clear)
                .swipeActions {
                    Button(role: .destructive) { browser.deleteDownload(file) } label: { Label("Delete", systemImage: "trash") }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle("Downloads")
        .onAppear { browser.refreshDownloads() }
    }

    private func size(of url: URL) -> String {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

struct SiteRow: View {
    let title: String
    let url: String
    var time: String? = nil
    let open: () -> Void
    @Environment(\.pal) private var pal

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Text(siteLetter(url))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(pal.ink)
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(pal.surfaceMuted))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(pal.ink).lineLimit(1)
                    Text(URL(string: url)?.host ?? url).font(.system(size: 12)).foregroundStyle(pal.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                if let time { Text(time).font(.system(size: 12)).foregroundStyle(pal.inkMuted) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
    }
}

struct EmptyNote: View {
    let symbol: String
    let title: String
    let text: String
    @Environment(\.pal) private var pal

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 30, weight: .light)).foregroundStyle(pal.secondary)
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(pal.ink)
            Text(text).font(.system(size: 14)).foregroundStyle(pal.inkMuted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }
}
