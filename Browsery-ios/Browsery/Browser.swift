import SwiftUI
import WebKit

/// All open tabs, the privacy shield, downloads and the saved session.
final class Browser: ObservableObject {
    let store: Store
    @Published var tabs: [Tab] = []
    @Published var currentID: UUID?
    @Published var toast: String?
    @Published var closed: [URL] = []
    @Published var downloads: [URL] = []

    private(set) var ruleList: WKContentRuleList?
    private var privateStore = WKWebsiteDataStore.nonPersistent()
    private var toastTask: DispatchWorkItem?

    var current: Tab? { tabs.first { $0.id == currentID } ?? tabs.first }

    init(store: Store) {
        self.store = store
        restoreSession()
        if tabs.isEmpty { newTab() }
        compileShield()
        refreshDownloads()
    }

    // MARK: Tabs

    @discardableResult
    func newTab(url: URL? = nil, isPrivate: Bool = false, select: Bool = true, configuration: WKWebViewConfiguration? = nil) -> Tab {
        let tab = Tab(browser: self, isPrivate: isPrivate)
        if let configuration { tab.makeWebView(configuration: configuration) }
        if let i = tabs.firstIndex(where: { $0.id == currentID }) {
            tabs.insert(tab, at: i + 1)
        } else {
            tabs.append(tab)
        }
        if select { currentID = tab.id }
        if let url { tab.load(url) }
        saveSession()
        return tab
    }

    func select(_ tab: Tab) {
        currentID = tab.id
    }

    func close(_ tab: Tab) {
        guard let i = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        if !tab.isPrivate, let u = tab.url { closed.append(u) }
        let wasCurrent = tab.id == current?.id
        tab.tearDown()
        tabs.remove(at: i)
        if !tabs.contains(where: { $0.isPrivate }) { privateStore = WKWebsiteDataStore.nonPersistent() }
        if tabs.isEmpty {
            newTab()
        } else if wasCurrent {
            let same = tabs.filter { $0.isPrivate == tab.isPrivate }
            currentID = (same.last ?? tabs[min(i, tabs.count - 1)]).id
        }
        saveSession()
    }

    func closeAll(isPrivate: Bool) {
        for t in tabs where t.isPrivate == isPrivate { close(t) }
    }

    func reopenClosed() {
        guard let u = closed.popLast() else { return }
        newTab(url: u)
    }

    /// Opens what was typed in the current tab.
    func go(_ input: String) {
        guard let url = store.resolve(input), let tab = current else { return }
        tab.load(url)
    }

    // MARK: Web views

    func configuration(isPrivate: Bool) -> WKWebViewConfiguration {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = isPrivate ? privateStore : .default()
        c.allowsInlineMediaPlayback = true
        c.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1"
        c.defaultWebpagePreferences.allowsContentJavaScript = true
        if store.shield, let r = ruleList { c.userContentController.add(r) }
        return c
    }

    private func compileShield() {
        WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: Shield.identifier, encodedContentRuleList: Shield.json) { [weak self] list, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error { print("Shield rules failed: \(error)") }
                self.ruleList = list
                self.applyShield()
            }
        }
    }

    func setShield(_ on: Bool) {
        store.shield = on
        applyShield()
        show(on ? "Privacy shield is on" : "Privacy shield is off")
    }

    func applyShield() {
        for t in tabs {
            guard let ucc = t.webView?.configuration.userContentController else { continue }
            ucc.removeAllContentRuleLists()
            if store.shield, let r = ruleList { ucc.add(r) }
        }
    }

    func clearBrowsingData() {
        store.history = []
        closed = []
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        show("Browsing data cleared")
    }

    // MARK: Downloads

    var downloadsDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func uniqueDownloadURL(_ name: String) -> URL {
        let clean = name.replacingOccurrences(of: "/", with: "-")
        let base = (clean as NSString).deletingPathExtension
        let ext = (clean as NSString).pathExtension
        var url = downloadsDir.appendingPathComponent(clean.isEmpty ? "download" : clean)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = downloadsDir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
            n += 1
        }
        return url
    }

    func refreshDownloads() {
        let fm = FileManager.default
        let files = (try? fm.contentsOfDirectory(at: downloadsDir, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])) ?? []
        downloads = files.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a > b
        }
    }

    func deleteDownload(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
        refreshDownloads()
    }

    // MARK: Session

    func saveSession() {
        let urls = tabs.filter { !$0.isPrivate }.compactMap { $0.url?.absoluteString }
        UserDefaults.standard.set(urls, forKey: "session")
    }

    private func restoreSession() {
        if ProcessInfo.processInfo.arguments.contains("-freshSession") { return }
        let urls = UserDefaults.standard.stringArray(forKey: "session") ?? []
        for s in urls.prefix(20) {
            if let u = URL(string: s) { newTab(url: u, select: true) }
        }
    }

    // MARK: Toast

    func show(_ message: String) {
        toastTask?.cancel()
        withAnimation(.spring(duration: 0.3)) { toast = message }
        let task = DispatchWorkItem { [weak self] in withAnimation(.easeOut(duration: 0.25)) { self?.toast = nil } }
        toastTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6, execute: task)
    }
}

/// One tab. The web view is made the first time the tab loads a page, so a fresh tab costs nothing.
final class Tab: NSObject, ObservableObject, Identifiable {
    let id = UUID()
    let isPrivate: Bool
    weak var browser: Browser?

    @Published private(set) var webView: WKWebView?
    @Published var url: URL?
    @Published var title = "New tab"
    @Published var progress = 0.0
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var snapshot: UIImage?
    @Published var night = false
    @Published var desktop = false
    @Published var failure: String?
    @Published var isSecure = false

    private var observations: [NSKeyValueObservation] = []
    private var upgradedHosts: Set<String> = []
    private var allowHTTP: Set<String> = []
    private var lastFailedURL: URL?

    init(browser: Browser, isPrivate: Bool) {
        self.browser = browser
        self.isPrivate = isPrivate
        super.init()
    }

    var host: String {
        guard let h = url?.host else { return url?.absoluteString ?? "" }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    var displayTitle: String {
        if url == nil { return isPrivate ? "Private tab" : "New tab" }
        return title.isEmpty ? host : title
    }

    @discardableResult
    func makeWebView(configuration: WKWebViewConfiguration? = nil) -> WKWebView {
        if let w = webView { return w }
        guard let browser else { fatalError("Tab without a browser") }
        let w = WKWebView(frame: .zero, configuration: configuration ?? browser.configuration(isPrivate: isPrivate))
        w.navigationDelegate = self
        w.uiDelegate = self
        w.allowsBackForwardNavigationGestures = true
        w.allowsLinkPreview = true
        w.isFindInteractionEnabled = true
        if #available(iOS 16.4, *) { w.isInspectable = true }
        w.scrollView.keyboardDismissMode = .interactive
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulledToRefresh(_:)), for: .valueChanged)
        w.scrollView.refreshControl = refresh

        observations = [
            w.observe(\.estimatedProgress) { [weak self] w, _ in self?.progress = w.estimatedProgress },
            w.observe(\.title) { [weak self] w, _ in if let t = w.title, !t.isEmpty { self?.title = t } },
            w.observe(\.url) { [weak self] w, _ in
                guard let self, let u = w.url else { return }
                self.url = u
                self.isSecure = u.scheme == "https"
            },
            w.observe(\.isLoading) { [weak self] w, _ in self?.isLoading = w.isLoading },
            w.observe(\.canGoBack) { [weak self] w, _ in self?.canGoBack = w.canGoBack },
            w.observe(\.canGoForward) { [weak self] w, _ in self?.canGoForward = w.canGoForward },
            w.observe(\.hasOnlySecureContent) { [weak self] w, _ in self?.isSecure = w.hasOnlySecureContent || w.url?.scheme == "https" },
        ]
        webView = w
        return w
    }

    @objc private func pulledToRefresh(_ control: UIRefreshControl) {
        webView?.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { control.endRefreshing() }
    }

    func load(_ url: URL) {
        failure = nil
        self.url = url
        makeWebView().load(URLRequest(url: url))
    }

    func reloadOrStop() {
        guard let w = webView else { return }
        if w.isLoading { w.stopLoading() } else if failure != nil, let u = lastFailedURL ?? url { load(u) } else { w.reload() }
    }

    func back() { webView?.goBack() }
    func forward() { webView?.goForward() }

    func toggleNight() {
        night.toggle()
        webView?.evaluateJavaScript(night ? PageScripts.nightOn : PageScripts.nightOff)
    }

    func reader() {
        webView?.evaluateJavaScript(PageScripts.reader)
    }

    func toggleDesktop() {
        desktop.toggle()
        guard let w = webView else { return }
        w.customUserAgent = desktop ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" : nil
        w.reload()
    }

    func find(_ text: String? = nil) {
        guard let w = webView else { return }
        if let text, !text.isEmpty {
            w.find(text, configuration: WKFindConfiguration()) { _ in }
        }
        w.findInteraction?.presentFindNavigator(showingReplace: false)
    }

    func pageText() async -> String? {
        guard let w = webView, url != nil else { return nil }
        return await withCheckedContinuation { cont in
            w.evaluateJavaScript(PageScripts.pageText) { value, _ in cont.resume(returning: value as? String) }
        }
    }

    func captureSnapshot(_ done: (() -> Void)? = nil) {
        guard let w = webView, w.bounds.width > 0 else { done?(); return }
        let cfg = WKSnapshotConfiguration()
        cfg.snapshotWidth = 360
        w.takeSnapshot(with: cfg) { [weak self] image, _ in
            if let image { self?.snapshot = image }
            done?()
        }
    }

    func tearDown() {
        observations.removeAll()
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.removeFromSuperview()
    }
}

extension Tab: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private static let webSchemes: Set<String> = ["http", "https", "about", "data", "blob", "file", "javascript"]

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        guard let u = navigationAction.request.url else { decisionHandler(.cancel, preferences); return }
        let scheme = u.scheme?.lowercased() ?? ""
        if navigationAction.shouldPerformDownload { decisionHandler(.download, preferences); return }
        if !Tab.webSchemes.contains(scheme) {
            UIApplication.shared.open(u)
            decisionHandler(.cancel, preferences)
            return
        }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if scheme == "http", mainFrame, browser?.store.httpsOnly == true, let host = u.host?.lowercased(),
           !allowHTTP.contains(host), !Tab.isLocal(host) {
            var c = URLComponents(url: u, resolvingAgainstBaseURL: false)
            c?.scheme = "https"
            if c?.port == 80 { c?.port = nil }
            if let secure = c?.url {
                upgradedHosts.insert(host)
                decisionHandler(.cancel, preferences)
                webView.load(URLRequest(url: secure))
                return
            }
        }
        preferences.preferredContentMode = desktop ? .desktop : .mobile
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"), disposition.lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
            return
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        failure = nil
        if night { webView.evaluateJavaScript(PageScripts.nightOn) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if night { webView.evaluateJavaScript(PageScripts.nightOn) }
        if !isPrivate, let u = webView.url { browser?.store.addVisit(url: u, title: webView.title ?? "") }
        browser?.saveSession()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error, in: webView)
    }

    private func handle(_ error: Error, in webView: WKWebView) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && (e.code == 102 || e.code == 204) { return } // download handoff, plug-in handled
        let failed = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        if let failed, failed.scheme == "https", let host = failed.host?.lowercased(), upgradedHosts.contains(host) {
            upgradedHosts.remove(host)
            allowHTTP.insert(host)
            var c = URLComponents(url: failed, resolvingAgainstBaseURL: false)
            c?.scheme = "http"
            if let insecure = c?.url {
                browser?.show("\(host) has no secure version. Opened it without HTTPS.")
                webView.load(URLRequest(url: insecure))
                return
            }
        }
        lastFailedURL = failed
        failure = e.localizedDescription
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let browser else { return nil }
        let tab = browser.newTab(isPrivate: isPrivate, select: true, configuration: configuration)
        return tab.webView
    }

    func webViewDidClose(_ webView: WKWebView) {
        browser?.close(self)
    }

    // JavaScript dialogs, so sites that ask "Are you sure?" still work.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        if !Tab.present(a) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        if !Tab.present(a) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: frame.request.url?.host, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        if !Tab.present(a) { completionHandler(nil) }
    }

    // Downloads land in Files › On My iPhone › Browsery › Downloads.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let browser else { completionHandler(nil); return }
        let dest = browser.uniqueDownloadURL(suggestedFilename)
        browser.show("Downloading \(dest.lastPathComponent)…")
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        browser?.refreshDownloads()
        browser?.show("Saved to Downloads")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        browser?.show("Download failed: \(error.localizedDescription)")
    }

    private static func isLocal(_ host: String) -> Bool {
        host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("127.") || host.hasPrefix("192.168.") || host.hasPrefix("10.")
    }

    @discardableResult
    static func present(_ vc: UIViewController) -> Bool {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene?.windows.first?.rootViewController else { return false }
        while let next = top.presentedViewController { top = next }
        top.present(vc, animated: true)
        return true
    }
}
