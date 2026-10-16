package app.browsery.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONTokener
import java.text.DateFormat
import java.util.Date

class Tab(val id: Long, var url: String?, var title: String, val incognito: Boolean) {
    var web: WebView? = null
    var thumb: Bitmap? = null
    var blocked = 0
    var progress = 100
    var loading = false
    var desktop = false
    var night = false
}

private data class Tile(val icon: Int, val text: String, val action: () -> Unit)

class MainActivity : AppCompatActivity() {
    private lateinit var store: Store
    private lateinit var pal: Pal
    private val ui = Handler(Looper.getMainLooper())

    private val tabs = mutableListOf<Tab>()
    private var active = 0
    private var nextId = 1L
    private val closed = ArrayDeque<String>()
    private val tab: Tab? get() = tabs.getOrNull(active)

    // chrome
    private lateinit var root: FrameLayout
    private lateinit var column: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var progressFill: View
    private lateinit var progressTrack: FrameLayout
    private lateinit var addressWrap: LinearLayout
    private lateinit var addressField: EditText
    private lateinit var lockIcon: ImageView
    private lateinit var shieldChip: TextView
    private lateinit var navBack: View
    private lateinit var navForward: View
    private lateinit var navCenter: FrameLayout
    private lateinit var tabCount: TextView
    private lateinit var suggestions: LinearLayout
    private var findBar: View? = null
    private var overlay: View? = null
    private var newTabView: View? = null
    private var clock: TextView? = null
    private var newTabSearch: EditText? = null
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null

    // Hey Groq
    private val chat = mutableListOf<Pair<String, String>>()
    private var groqBusy = false

    // activity results
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
        fileCallback = null
    }
    private var voiceTarget: ((String) -> Unit)? = null
    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val heard = res.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (res.resultCode == Activity.RESULT_OK && !heard.isNullOrBlank()) voiceTarget?.invoke(heard)
        voiceTarget = null
    }

    // ------------------------------------------------------------------ lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        store = Store(this)
        pal = palette()
        CookieManager.getInstance().setAcceptCookie(true)
        buildChrome()

        val (urls, idx) = if (store.restore) store.session() else (emptyList<String>() to 0)
        if (urls.isNotEmpty()) {
            urls.forEach { tabs.add(Tab(nextId++, it, hostOf(it), false)) }
            active = idx.coerceIn(0, tabs.lastIndex)
        } else {
            tabs.add(Tab(nextId++, null, "New tab", false))
        }
        showCurrent()
        handleIntent(intent)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!goBack()) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })
        ui.post(clockTick)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        saveSession()
        tabs.forEach { it.web?.onPause() }
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        tab?.web?.onResume()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        tabs.forEach { it.web?.destroy() }
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val next = palette()
        if (next != pal) { pal = next; rebuild() }
    }

    private fun palette(): Pal = when {
        !store.chill -> Pal.SPACE
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES -> Pal.CHILL_DARK
        else -> Pal.CHILL_LIGHT
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val target: String? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra("query")?.let { resolve(it) }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let { resolve(it) }
            else -> null
        }
        if (target != null) openInNewTab(target)
    }

    private fun saveSession() {
        if (!store.restore) return
        val keep = tabs.filter { !it.incognito && it.url != null }
        val activeUrl = tab?.url
        store.saveSession(keep.mapNotNull { it.url }, keep.indexOfFirst { it.url == activeUrl }.coerceAtLeast(0))
    }

    // ------------------------------------------------------------------ chrome

    private fun rebuild() {
        closeOverlay()
        tabs.forEach { t -> (t.web?.parent as? ViewGroup)?.removeView(t.web) }
        buildChrome()
        showCurrent()
    }

    private fun buildChrome() {
        root = FrameLayout(this).apply { setBackgroundColor(pal.void) }
        setContentView(root)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = !pal.dark
            isAppearanceLightNavigationBars = !pal.dark
        }
        column = column()
        root.addView(column, FrameLayout.LayoutParams(MATCH, MATCH))

        content = FrameLayout(this)
        column.addView(content, lp(MATCH, 0, 1f))

        suggestions = column().apply {
            visibility = View.GONE
            background = box(pal.surface, 16, pal.line)
            setPadding(dp(6), dp(6), dp(6), dp(6))
            if (pal.space) glow(pal.secondary, 18)
        }
        content.addView(suggestions, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM).apply { setMargins(dp(12), 0, dp(12), dp(8)) })

        progressTrack = FrameLayout(this).apply { setBackgroundColor(pal.canvas) }
        progressFill = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(pal.secondary, pal.accent))
        }
        progressTrack.addView(progressFill, FrameLayout.LayoutParams(0, MATCH))
        column.addView(progressTrack, lp(MATCH, dp(2)))

        buildAddressBar()
        buildNav()

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            column.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            overlay?.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }
    }

    private fun buildAddressBar() {
        addressWrap = column().apply {
            setPadding(dp(12), dp(10), dp(12), dp(6))
            background = if (pal.space) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(alpha(pal.surface, 0.98f), alpha(pal.canvas, 0.98f))) else box(pal.surface, 0)
        }
        val field = row(spacing = 6).apply {
            background = box(if (pal.space) pal.void else pal.canvas, 14, pal.lineStrong)
            setPadding(dp(14), 0, dp(4), 0)
        }
        lockIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_lock)
            imageTintList = ColorStateList.valueOf(pal.secondary)
            contentDescription = "Secure connection"
        }
        field.addView(lockIcon, lp(dp(16), dp(16)))
        addressField = EditText(this).apply {
            background = null
            setTextColor(pal.ink)
            setHintTextColor(pal.inkMuted)
            hint = "Search or type a web address"
            textSize = 15f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
            selectAllOnFocus = true
            setPadding(dp(6), 0, dp(6), 0)
            setOnEditorActionListener { v, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) {
                    go(v.text.toString()); true
                } else false
            }
            setOnFocusChangeListener { _, has ->
                if (has) setText(tab?.url ?: "") else { showAddress(); hideSuggestions() }
            }
            addTextChangedListener(watcher { if (hasFocus()) showSuggestions(it) })
        }
        field.addView(addressField, lp(0, dp(48), 1f))
        shieldChip = label("0", 12f, pal.secondaryInk, bold = true).apply {
            gravity = Gravity.CENTER
            background = ripple(box(pal.secondarySoft, 10), pal, 10)
            setPadding(dp(10), 0, dp(10), 0)
            contentDescription = "Privacy shield"
            setOnClickListener { shieldInfo() }
        }
        field.addView(shieldChip, lp(WRAP, dp(32)))
        field.addView(iconButton(R.drawable.ic_reload, "Reload", pal.inkMuted, pal, 44, 20) {
            val t = tab ?: return@iconButton
            if (t.loading) t.web?.stopLoading() else t.web?.reload()
        })
        addressWrap.addView(field, lp(MATCH, dp(48)))
        column.addView(addressWrap, lp(MATCH, WRAP))
    }

    private fun buildNav() {
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = if (pal.space) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(alpha(pal.surface, 0.97f), alpha(pal.canvas, 0.99f))) else box(pal.surface, 0)
        }
        fun cell(v: View): FrameLayout = FrameLayout(this).apply { addView(v, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER)) }
        navBack = iconButton(R.drawable.ic_back, "Back", pal.ink, pal) { goBack() }
        navForward = iconButton(R.drawable.ic_forward, "Forward", pal.ink, pal) { tab?.web?.goForward() }
        navCenter = FrameLayout(this)
        tabCount = label("1", 12f, pal.ink, bold = true).apply {
            gravity = Gravity.CENTER
            background = box(Color.TRANSPARENT, 6, pal.ink, 1.8)
        }
        val tabsButton = FrameLayout(this).apply {
            contentDescription = "Tabs"
            background = ripple(null, pal, 14)
            addView(tabCount, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
            setOnClickListener { it.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); openTabs() }
        }
        val menu = iconButton(R.drawable.ic_menu, "Menu", pal.ink, pal) { openMenu() }
        listOf(cell(navBack), cell(navForward), navCenter, cell(tabsButton), cell(menu)).forEach {
            nav.addView(it, lp(0, dp(64), 1f))
        }
        val top = View(this).apply { setBackgroundColor(pal.line) }
        column.addView(top, lp(MATCH, 1))
        column.addView(nav, lp(MATCH, dp(64)))
    }

    private fun setCenterButton(home: Boolean) {
        navCenter.removeAllViews()
        val b = if (home) {
            iconButton(R.drawable.ic_home, "Home", pal.ink, pal, 52, 22, box(pal.surfaceMuted, 16, pal.line)) { goHome() }
        } else {
            iconButton(R.drawable.ic_spark, "Hey Groq", pal.onAccent, pal, 52, 22, box(pal.accent, 16)) { openGroq() }.apply {
                if (pal.space) glow(pal.accent, 10)
            }
        }
        navCenter.addView(b, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER))
    }

    // ------------------------------------------------------------------ tabs and pages

    private fun showCurrent() {
        val t = tab ?: run { tabs.add(Tab(nextId++, null, "New tab", false)); active = 0; tab!! }
        content.removeAllViews()
        newTabView = null; clock = null; newTabSearch = null
        if (t.url == null) {
            newTabView = buildNewTab(t)
            content.addView(newTabView, FrameLayout.LayoutParams(MATCH, MATCH))
            addressWrap.visibility = View.GONE
            progressTrack.visibility = View.GONE
        } else {
            val web = t.web ?: createWebView(t).also { t.web = it; it.loadUrl(t.url!!) }
            (web.parent as? ViewGroup)?.removeView(web)
            content.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
            web.onResume()
            addressWrap.visibility = View.VISIBLE
            progressTrack.visibility = View.VISIBLE
        }
        content.addView(suggestions, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM).apply { setMargins(dp(12), 0, dp(12), dp(8)) })
        hideSuggestions()
        setCenterButton(home = t.url != null)
        refreshChrome()
    }

    private fun refreshChrome() {
        val t = tab ?: return
        tabCount.text = tabs.size.coerceAtMost(99).toString()
        navBack.alpha = if (t.web?.canGoBack() == true) 1f else 0.4f
        navForward.alpha = if (t.web?.canGoForward() == true) 1f else 0.4f
        if (!addressField.hasFocus()) showAddress()
        shieldChip.text = if (store.shield) t.blocked.toString() else "off"
        shieldChip.contentDescription = if (store.shield) "Privacy shield: ${t.blocked} blocked on this page" else "Privacy shield is off"
        val secure = t.url?.startsWith("https://") == true
        lockIcon.setImageResource(if (secure) R.drawable.ic_lock else R.drawable.ic_unlock)
        lockIcon.imageTintList = ColorStateList.valueOf(if (secure) pal.secondary else pal.danger)
        lockIcon.contentDescription = if (secure) "Secure connection" else "Not secure"
        val p = if (t.loading) t.progress.coerceIn(5, 100) else 0
        progressFill.layoutParams = (progressFill.layoutParams as FrameLayout.LayoutParams).apply { width = progressTrack.width * p / 100 }
        progressFill.requestLayout()
    }

    private fun showAddress() {
        val t = tab ?: return
        val host = t.url?.let { hostOf(it) } ?: ""
        addressField.setText(if (t.incognito) "Private · $host" else host)
    }

    private fun stashThumb(t: Tab?) {
        val web = t?.web ?: return
        if (web.width <= 0 || web.height <= 0) return
        runCatching {
            val scale = 0.4f
            val bmp = Bitmap.createBitmap((web.width * scale).toInt(), (web.height * scale).toInt(), Bitmap.Config.RGB_565)
            val c = Canvas(bmp)
            c.scale(scale, scale)
            c.translate(-web.scrollX.toFloat(), -web.scrollY.toFloat())
            web.draw(c)
            t.thumb = bmp
        }
    }

    private fun switchTo(index: Int) {
        if (index !in tabs.indices) return
        stashThumb(tab)
        tab?.web?.onPause()
        active = index
        showCurrent()
    }

    private fun newTab(incognito: Boolean = false, url: String? = null) {
        stashThumb(tab)
        tab?.web?.onPause()
        tabs.add(Tab(nextId++, url, if (url == null) "New tab" else hostOf(url), incognito))
        active = tabs.lastIndex
        showCurrent()
    }

    private fun openInNewTab(url: String) {
        val t = tab
        if (t != null && t.url == null && !t.incognito) { navigate(url) } else newTab(url = url)
    }

    private fun closeTab(index: Int) {
        val t = tabs.getOrNull(index) ?: return
        t.url?.takeIf { !t.incognito }?.let { closed.addFirst(it); while (closed.size > 24) closed.removeLast() }
        t.web?.let { w ->
            (w.parent as? ViewGroup)?.removeView(w)
            if (t.incognito) { w.clearHistory(); w.clearCache(true); w.clearFormData() }
            w.destroy()
        }
        tabs.removeAt(index)
        if (tabs.isEmpty()) tabs.add(Tab(nextId++, null, "New tab", false))
        if (active >= tabs.size) active = tabs.lastIndex
        else if (index < active) active--
        showCurrent()
    }

    private fun reopenClosed() {
        val url = closed.removeFirstOrNull() ?: run { toast("No closed tabs"); return }
        newTab(url = url)
    }

    private fun goHome() {
        val t = tab ?: return
        stashThumb(t)
        t.web?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        t.web = null; t.url = null; t.title = "New tab"; t.blocked = 0; t.loading = false; t.night = false
        showCurrent()
    }

    private fun goBack(): Boolean {
        if (customView != null) { customCallback?.onCustomViewHidden(); return true }
        if (overlay != null) { closeOverlay(); return true }
        if (findBar != null) { closeFind(); return true }
        if (suggestions.visibility == View.VISIBLE) { hideKeyboard(); addressField.clearFocus(); hideSuggestions(); return true }
        val t = tab ?: return false
        if (t.web?.canGoBack() == true) { t.web?.goBack(); return true }
        if (t.url != null) {
            if (tabs.size > 1) closeTab(active) else goHome()
            return true
        }
        return false
    }

    private fun resolve(input: String): String {
        val v = input.trim()
        if (v.isEmpty()) return ""
        if (Regex("^[a-zA-Z][a-zA-Z\\d+.-]*://").containsMatchIn(v)) return v
        if (!v.contains(' ') && Regex("^[^\\s]+\\.[a-zA-Z]{2,}(/.*)?(:\\d+)?$").matches(v)) return "https://$v"
        if (v.startsWith("localhost")) return "http://$v"
        return store.searchUrl(v)
    }

    private fun go(input: String) {
        val target = resolve(input)
        if (target.isEmpty()) return
        hideKeyboard()
        addressField.clearFocus()
        hideSuggestions()
        navigate(target)
    }

    private fun navigate(url: String) {
        var target = url
        if (store.httpsOnly && target.startsWith("http://") && !target.startsWith("http://localhost")) target = "https://" + target.removePrefix("http://")
        val t = tab ?: return
        t.url = target
        t.title = hostOf(target)
        if (t.web == null) showCurrent() else t.web?.loadUrl(target)
        refreshChrome()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(t: Tab): WebView {
        val web = WebView(this)
        web.setBackgroundColor(if (pal.dark) pal.canvas else Color.WHITE)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = if (t.incognito) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
            if (t.desktop) userAgentString = desktopAgent(userAgentString)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, store.thirdPartyCookies)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                return when (uri.scheme?.lowercase()) {
                    "https", "about", "data", "blob" -> false
                    "http" -> if (store.httpsOnly && request.isForMainFrame && uri.host != "localhost") {
                        view.loadUrl(uri.toString().replaceFirst("http://", "https://")); true
                    } else false
                    "intent" -> {
                        runCatching { startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).addCategory(Intent.CATEGORY_BROWSABLE).setComponent(null).setSelector(null)) }
                            .onFailure { runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }.getOrNull()?.takeIf { it.startsWith("https://") }?.let { view.loadUrl(it) } }
                        true
                    }
                    else -> {
                        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) } catch (_: ActivityNotFoundException) { toast("No app can open this link") }
                        true
                    }
                }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (!store.shield || request.isForMainFrame || !Shield.blocks(request.url)) return null
                ui.post {
                    t.blocked++
                    store.blockedTotal = store.blockedTotal + 1
                    if (t === tab) refreshChrome()
                }
                return Shield.empty()
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                t.url = url; t.loading = true; t.progress = 5; t.blocked = 0
                if (t === tab) refreshChrome()
            }

            override fun onPageFinished(view: WebView, url: String) {
                t.url = url; t.loading = false; t.progress = 100
                if (!t.incognito) store.addHistory(url, view.title ?: url)
                if (t.night) view.evaluateJavascript(NIGHT_ON, null)
                if (t === tab) refreshChrome()
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                t.url = url
                if (t === tab) refreshChrome()
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                toast("This site's security certificate isn't valid, so Browsery didn't open it.")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                t.progress = newProgress
                if (t === tab) refreshChrome()
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                t.title = title?.takeIf { it.isNotBlank() } ?: t.title
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                customView?.let { root.removeView(it) }
                customView = view
                customCallback = callback
                root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
                WindowInsetsControllerCompat(window, root).apply {
                    hide(WindowInsetsCompat.Type.systemBars())
                    systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            }

            override fun onHideCustomView() {
                customView?.let { root.removeView(it) }
                customView = null
                customCallback = null
                WindowInsetsControllerCompat(window, root).show(WindowInsetsCompat.Type.systemBars())
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { pickFiles.launch(params.createIntent()); true } catch (_: ActivityNotFoundException) { fileCallback = null; false }
            }
        }
        web.setDownloadListener { url, userAgent, disposition, mime, _ ->
            runCatching {
                val name = URLUtil.guessFileName(url, disposition, mime)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mime)
                    addRequestHeader("User-Agent", userAgent)
                    CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                    setTitle(name)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                toast("Downloading $name")
            }.onFailure { toast("Could not start that download") }
        }
        web.setFindListener { activeMatch, matches, _ -> (findBar?.tag as? TextView)?.text = if (matches == 0) "0/0" else "${activeMatch + 1}/$matches" }
        return web
    }

    private fun desktopAgent(mobile: String): String =
        mobile.replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)").replace(" Mobile", "").replace("; wv", "")

    // ------------------------------------------------------------------ new tab

    private val clockTick = object : Runnable {
        override fun run() {
            clock?.text = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
            ui.postDelayed(this, 60_000 - System.currentTimeMillis() % 60_000 + 50)
        }
    }

    private fun buildNewTab(t: Tab): View {
        val frame = FrameLayout(this)
        if (pal.space) {
            frame.addView(ImageView(this).apply {
                setImageResource(R.drawable.saturn)
                scaleType = ImageView.ScaleType.CENTER_CROP
                alpha = 0.85f
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, FrameLayout.LayoutParams(MATCH, dp(380)))
            frame.addView(View(this).apply {
                background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(alpha(pal.void, 0.15f), alpha(pal.void, 0.4f), pal.void))
            }, FrameLayout.LayoutParams(MATCH, dp(382)))
        }
        val scroll = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        val col = column().apply { setPadding(dp(20), dp(16), dp(20), dp(16)) }
        scroll.addView(col, FrameLayout.LayoutParams(MATCH, WRAP))
        frame.addView(scroll, FrameLayout.LayoutParams(MATCH, MATCH))

        // top row: brand + shield
        val top = row()
        if (pal.space) top.addView(ImageView(this).apply { setImageResource(R.drawable.brand) }, lp(dp(22), dp(22)).margins(this, r = 8))
        top.addView(label(if (t.incognito) "Private tab" else "Browsery", 15f, pal.ink, bold = true), lp(0, WRAP, 1f))
        top.addView(label(if (store.shield) "${store.blockedTotal} blocked" else "Shield off", 12f, pal.secondaryInk, bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            background = ripple(box(alpha(pal.secondarySoft, 0.85f), 16, alpha(pal.secondary, 0.3f)), pal, 16)
            setOnClickListener { shieldInfo() }
        }, lp(WRAP, dp(32)))
        col.addView(top, lp(MATCH, WRAP))

        col.addView(View(this), lp(MATCH, dp(if (pal.space) 140 else 110)))
        if (pal.space) col.addView(label("SPACE · BROWSERY SEARCH", 12f, pal.secondary, bold = true).apply { letterSpacing = 0.18f }, lp(WRAP, WRAP).margins(this, b = 8))
        clock = label("", if (pal.space) 64f else 56f, pal.ink, family = if (pal.space) Typeface.create("sans-serif-light", Typeface.NORMAL) else Typeface.SERIF).apply {
            letterSpacing = -0.03f
            if (pal.space) setShadowLayer(dpf(18), 0f, 0f, alpha(pal.secondary, 0.35f))
            text = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
            if (!pal.space) gravity = Gravity.CENTER_HORIZONTAL
        }
        col.addView(clock, lp(MATCH, WRAP))
        col.addView(label(if (t.incognito) "Nothing here is saved to history." else "Where do you want to go?", 16f, pal.inkMuted).apply {
            if (!pal.space) gravity = Gravity.CENTER_HORIZONTAL
        }, lp(MATCH, WRAP).margins(this, t = 6))

        // search
        val search = row(spacing = 4).apply {
            background = box(if (pal.space) alpha(pal.canvas, 0.92f) else pal.surface, 14, pal.lineStrong)
            setPadding(dp(16), 0, dp(6), 0)
            if (pal.space) glow(pal.secondary, 14) else elevation = dpf(2)
        }
        search.addView(ImageView(this).apply { setImageResource(R.drawable.ic_search); imageTintList = ColorStateList.valueOf(pal.inkMuted) }, lp(dp(20), dp(20)))
        val input = EditText(this).apply {
            background = null
            hint = "Search or type a web address"
            setHintTextColor(pal.inkMuted)
            setTextColor(pal.ink)
            textSize = 16f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
            setPadding(dp(10), 0, dp(4), 0)
            setOnEditorActionListener { v, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_GO || event?.keyCode == KeyEvent.KEYCODE_ENTER) { go(v.text.toString()); true } else false
            }
            addTextChangedListener(watcher { if (hasFocus()) showSuggestions(it) })
            setOnFocusChangeListener { _, has -> if (!has) hideSuggestions() }
        }
        newTabSearch = input
        search.addView(input, lp(0, dp(48), 1f))
        search.addView(iconButton(R.drawable.ic_mic, "Voice search", pal.secondary, pal, 44, 20) { listenFor { go(it) } })
        search.addView(iconButton(R.drawable.ic_arrow, "Go", pal.onAccent, pal, 44, 20, box(pal.accent, 10)) { go(input.text.toString()) })
        col.addView(search, lp(MATCH, dp(56)).margins(this, t = 22))

        // shortcuts
        val grid = column(spacing = 14)
        val items = store.shortcuts.map { it as Shortcut? } + listOf(null)
        items.chunked(4).forEach { rowItems ->
            val r = row()
            rowItems.forEach { s -> r.addView(shortcutTile(s), lp(0, WRAP, 1f)) }
            repeat(4 - rowItems.size) { r.addView(View(this), lp(0, 1, 1f)) }
            grid.addView(r, lp(MATCH, WRAP))
        }
        col.addView(grid, lp(MATCH, WRAP).margins(this, t = 26))

        col.addView(View(this), lp(MATCH, 0, 1f))
        if (!t.incognito) {
            val groq = row(spacing = 12).apply {
                background = ripple(box(pal.accentSoft, 14, alpha(pal.accent, 0.35f)), pal, 14)
                setPadding(dp(16), dp(14), dp(16), dp(14))
                setOnClickListener { openGroq() }
                contentDescription = "Hey Groq. Ask anything about the web or Browsery"
            }
            groq.addView(ImageView(this).apply { setImageResource(R.drawable.ic_spark); imageTintList = ColorStateList.valueOf(pal.accent) }, lp(dp(20), dp(20)))
            val txt = column(spacing = 2)
            txt.addView(label("Hey Groq", 14f, pal.accentInk, bold = true))
            txt.addView(label("Ask anything about the web or Browsery", 14f, pal.ink))
            groq.addView(txt, lp(0, WRAP, 1f))
            groq.addView(ImageView(this).apply { setImageResource(R.drawable.ic_forward); imageTintList = ColorStateList.valueOf(pal.accentInk) }, lp(dp(18), dp(18)))
            col.addView(groq, lp(MATCH, WRAP).margins(this, t = 24))
        }
        return frame
    }

    private fun shortcutTile(s: Shortcut?): View {
        val tile = column(spacing = 8).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            background = ripple(null, pal, 16)
            setPadding(0, dp(4), 0, dp(4))
        }
        val badge = label(s?.name?.take(1)?.uppercase() ?: "+", 18f, pal.ink, bold = true).apply {
            gravity = Gravity.CENTER
            background = if (pal.space) grad(intArrayOf(pal.surfaceMuted, pal.canvas), 16, pal.line, GradientDrawable.Orientation.TL_BR) else box(pal.surfaceMuted, 28, pal.line)
            if (pal.space) glow(Color.BLACK, 6)
        }
        tile.addView(badge, lp(dp(56), dp(56)))
        tile.addView(label(s?.name ?: "Add", 12f, pal.inkMuted).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; gravity = Gravity.CENTER }, lp(MATCH, WRAP))
        tile.contentDescription = s?.name ?: "Add shortcut"
        tile.setOnClickListener { if (s == null) editShortcut(null) else go(s.url) }
        tile.setOnLongClickListener { if (s != null) editShortcut(s); s != null }
        return tile
    }

    private fun editShortcut(s: Shortcut?) {
        val box = column(spacing = 8).apply { setPadding(dp(20), dp(8), dp(20), 0) }
        val name = EditText(this).apply { hint = "Name"; setText(s?.name ?: ""); isSingleLine = true }
        val url = EditText(this).apply { hint = "Website, like wikipedia.org"; setText(s?.url ?: ""); isSingleLine = true; inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT }
        box.addView(name); box.addView(url)
        val dialog = AlertDialog.Builder(this)
            .setTitle(if (s == null) "Add shortcut" else "Edit shortcut")
            .setView(box)
            .setPositiveButton(if (s == null) "Add" else "Save", null)
            .setNegativeButton("Cancel", null)
        if (s != null) dialog.setNeutralButton("Remove") { _, _ -> store.shortcuts = store.shortcuts.filterNot { it == s }; showCurrent() }
        val d = dialog.show()
        d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val target = resolve(url.text.toString())
            if (!target.startsWith("http") || target == store.searchUrl(url.text.toString().trim())) { url.error = "Enter a website address"; return@setOnClickListener }
            val shortcut = Shortcut(name.text.toString().trim().ifBlank { hostOf(target) }.take(24), target)
            store.shortcuts = if (s == null) store.shortcuts + shortcut else store.shortcuts.map { if (it == s) shortcut else it }
            d.dismiss()
            showCurrent()
        }
    }

    // ------------------------------------------------------------------ suggestions

    private fun showSuggestions(text: String) {
        val q = text.trim().lowercase()
        if (!store.suggestions || q.isEmpty()) { hideSuggestions(); return }
        val pool = (store.bookmarks + store.history).distinctBy { it.url }
        val hits = pool.filter { it.url.lowercase().contains(q) || it.title.lowercase().contains(q) }.take(4)
        suggestions.removeAllViews()
        fun item(icon: Int, title: String, sub: String, action: () -> Unit) {
            val r = row(spacing = 12).apply {
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = ripple(null, pal, 12)
                setOnClickListener { action() }
            }
            r.addView(ImageView(this).apply { setImageResource(icon); imageTintList = ColorStateList.valueOf(pal.secondary) }, lp(dp(18), dp(18)))
            val c = column(spacing = 2)
            c.addView(label(title, 15f, pal.ink).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
            if (sub.isNotBlank()) c.addView(label(sub, 12f, pal.inkMuted).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
            r.addView(c, lp(0, WRAP, 1f))
            suggestions.addView(r, lp(MATCH, WRAP))
        }
        hits.forEach { e -> item(if (store.isBookmarked(e.url)) R.drawable.ic_bookmark else R.drawable.ic_history, e.title, e.url) { go(e.url) } }
        item(R.drawable.ic_search, "Search for “${text.trim()}”", store.engine.let { if (it == "Browsery") "Browsery Search (Mojeek)" else it }) { go(store.searchUrl(text.trim())) }
        suggestions.visibility = View.VISIBLE
        suggestions.bringToFront()
    }

    private fun hideSuggestions() { suggestions.visibility = View.GONE }

    // ------------------------------------------------------------------ overlays

    private fun openOverlay(view: View, dim: Boolean, bottom: Boolean = false) {
        closeOverlay()
        val host = FrameLayout(this).apply {
            if (dim) setBackgroundColor(alpha(Color.BLACK, 0.55f))
            isClickable = true
            setOnClickListener { closeOverlay() }
        }
        host.addView(view, if (bottom) FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM) else FrameLayout.LayoutParams(MATCH, MATCH))
        overlay = host
        root.addView(host, FrameLayout.LayoutParams(MATCH, MATCH))
        ViewCompat.requestApplyInsets(root)
        view.alpha = 0f
        view.translationY = dpf(16)
        view.animate().alpha(1f).translationY(0f).setDuration(if (pal.space) 200 else 120).start()
    }

    private fun closeOverlay() {
        overlay?.let { root.removeView(it) }
        overlay = null
        hideKeyboard()
    }

    private fun sheet(): LinearLayout = column(spacing = 14).apply {
        isClickable = true
        setPadding(dp(16), dp(10), dp(16), dp(20))
        background = if (pal.space) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(pal.surface, pal.canvas)).apply {
            cornerRadii = floatArrayOf(dpf(24), dpf(24), dpf(24), dpf(24), 0f, 0f, 0f, 0f)
            setStroke(1, alpha(pal.secondary, 0.24f))
        } else GradientDrawable().apply {
            setColor(pal.surface)
            cornerRadii = floatArrayOf(dpf(24), dpf(24), dpf(24), dpf(24), 0f, 0f, 0f, 0f)
        }
        addView(View(context).apply { background = box(pal.lineStrong, 2) }, lp(dp(40), dp(4)).apply { gravity = Gravity.CENTER_HORIZONTAL })
    }

    private fun fullPage(title: String): Pair<LinearLayout, LinearLayout> {
        val page = column().apply { isClickable = true; setBackgroundColor(pal.void) }
        val head = row(spacing = 4).apply { setPadding(dp(4), dp(8), dp(16), dp(8)) }
        head.addView(iconButton(R.drawable.ic_back, "Back", pal.ink, pal) { closeOverlay() })
        head.addView(label(title, 22f, pal.ink, bold = true), lp(0, WRAP, 1f))
        page.addView(head, lp(MATCH, WRAP))
        val scroll = ScrollView(this)
        val body = column(spacing = 18).apply { setPadding(dp(16), dp(4), dp(16), dp(24)) }
        scroll.addView(body)
        page.addView(scroll, lp(MATCH, 0, 1f))
        return page to body
    }

    private fun switchView(on: Boolean, description: String, toggle: (Boolean) -> Unit): View {
        val track = FrameLayout(this).apply { contentDescription = description }
        val knob = View(this)
        track.addView(knob, FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER_VERTICAL))
        var state = on
        fun paint() {
            track.background = box(if (state) pal.accent else pal.surfaceMuted, 13, if (state) 0 else pal.lineStrong)
            knob.background = box(if (state) pal.onAccent else pal.inkMuted, 9)
            (knob.layoutParams as FrameLayout.LayoutParams).leftMargin = dp(if (state) 22 else 4)
            knob.requestLayout()
            track.contentDescription = "$description, ${if (state) "on" else "off"}"
            if (pal.space && state) track.glow(pal.accent, 6) else track.elevation = 0f
        }
        paint()
        track.setOnClickListener { state = !state; paint(); it.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); toggle(state) }
        track.accessibilityDelegate = object : View.AccessibilityDelegate() {
            override fun onInitializeAccessibilityNodeInfo(host: View, info: android.view.accessibility.AccessibilityNodeInfo) {
                super.onInitializeAccessibilityNodeInfo(host, info)
                info.className = "android.widget.Switch"
                info.isCheckable = true
                info.isChecked = state
            }
        }
        track.layoutParams = lp(dp(44), dp(26))
        return track
    }

    private fun group(title: String, rows: List<View>): View {
        val g = column(spacing = 8)
        g.addView(label(title.uppercase(), 12f, pal.secondary, bold = true).apply { letterSpacing = 0.16f; setPadding(dp(4), 0, 0, 0) })
        val card = column().apply {
            background = if (pal.space) grad(intArrayOf(pal.surface, pal.canvas), 16, pal.line, GradientDrawable.Orientation.TL_BR) else box(pal.surface, 16, pal.line)
            clipToOutline = true
        }
        rows.forEachIndexed { i, r ->
            if (i > 0) card.addView(View(this).apply { setBackgroundColor(pal.surfaceMuted) }, lp(MATCH, 1))
            card.addView(r, lp(MATCH, WRAP))
        }
        g.addView(card, lp(MATCH, WRAP))
        return g
    }

    private fun settingRow(title: String, sub: String, trailing: View?, onClick: (() -> Unit)? = null): View {
        val r = row(spacing = 12).apply {
            minimumHeight = dp(58)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            if (onClick != null) { background = ripple(null, pal, 0); setOnClickListener { onClick() } }
        }
        val c = column(spacing = 3)
        c.addView(label(title, 15f, pal.ink, bold = true))
        if (sub.isNotBlank()) c.addView(label(sub, 13f, pal.inkMuted))
        r.addView(c, lp(0, WRAP, 1f))
        trailing?.let { r.addView(it) }
        return r
    }

    private fun valueText(text: String) = label(text, 14f, pal.secondaryInk)

    // ---- tabs

    private fun openTabs(showPrivate: Boolean = tab?.incognito == true) {
        stashThumb(tab)
        val page = column().apply { isClickable = true; setBackgroundColor(pal.void) }
        val head = row().apply { setPadding(dp(16), dp(16), dp(16), dp(12)) }
        head.addView(label("Tabs", 22f, pal.ink, bold = true), lp(0, WRAP, 1f))
        val seg = row(spacing = 2).apply { background = box(pal.canvas, 12, pal.line); setPadding(dp(3), dp(3), dp(3), dp(3)) }
        fun segButton(text: String, selected: Boolean, click: () -> Unit) = label(text, 13f, if (selected) pal.ink else pal.inkMuted, bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            background = ripple(if (selected) box(pal.surfaceMuted, 9) else null, pal, 9)
            isSelected = selected
            setOnClickListener { click() }
        }
        val normalCount = tabs.count { !it.incognito }
        val privateCount = tabs.count { it.incognito }
        seg.addView(segButton("$normalCount open", !showPrivate) { openTabs(false) }, lp(WRAP, dp(36)))
        seg.addView(segButton("Private $privateCount", showPrivate) { openTabs(true) }, lp(WRAP, dp(36)))
        head.addView(seg)
        page.addView(head, lp(MATCH, WRAP))

        val scroll = ScrollView(this)
        val grid = column(spacing = 12).apply { setPadding(dp(16), dp(4), dp(16), dp(16)) }
        val shown = tabs.withIndex().filter { it.value.incognito == showPrivate }
        if (shown.isEmpty()) {
            grid.addView(label(if (showPrivate) "No private tabs. Private tabs aren't saved to history and are cleared when you close them." else "No open tabs.", 15f, pal.inkMuted).apply { setLineSpacing(0f, 1.3f) })
        }
        shown.chunked(2).forEach { pair ->
            val r = row(spacing = 12)
            pair.forEach { (index, t) -> r.addView(tabCard(index, t, showPrivate), lp(0, dp(236), 1f)) }
            if (pair.size == 1) r.addView(View(this), lp(0, 1, 1f))
            grid.addView(r, lp(MATCH, WRAP))
        }
        scroll.addView(grid)
        page.addView(scroll, lp(MATCH, 0, 1f))

        val bottom = row(spacing = 10).apply { setPadding(dp(16), dp(12), dp(16), dp(16)) }
        bottom.addView(label(if (showPrivate) "New private tab" else "New tab", 16f, pal.onAccent, bold = true).apply {
            gravity = Gravity.CENTER
            background = ripple(box(pal.accent, 14), pal, 14)
            if (pal.space) glow(pal.accent, 8)
            setOnClickListener { closeOverlay(); newTab(incognito = showPrivate) }
        }, lp(0, dp(52), 1f))
        bottom.addView(label("Reopen closed", 14f, pal.ink, bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(16), 0, dp(16), 0)
            background = ripple(box(Color.TRANSPARENT, 14, pal.lineStrong), pal, 14)
            setOnClickListener { closeOverlay(); reopenClosed() }
        }, lp(WRAP, dp(52)))
        page.addView(bottom, lp(MATCH, WRAP))
        openOverlay(page, dim = false)
    }

    private fun tabCard(index: Int, t: Tab, privateView: Boolean): View {
        val selected = index == active
        val card = column().apply {
            background = box(pal.canvas, 16, if (selected) pal.accent else pal.line, if (selected) 1.5 else 1)
            if (selected && pal.space) glow(pal.accent, 10)
            clipToOutline = true
            setOnClickListener { closeOverlay(); switchTo(index) }
            contentDescription = "${t.title}${if (selected) ", current tab" else ""}"
        }
        val head = row(spacing = 8).apply { setPadding(dp(10), 0, 0, 0) }
        head.addView(label((t.title.ifBlank { "New tab" }).take(1).uppercase(), 10f, pal.ink, bold = true).apply {
            gravity = Gravity.CENTER; background = box(pal.surfaceMuted, 5)
        }, lp(dp(18), dp(18)))
        head.addView(label(t.title.ifBlank { "New tab" }, 13f, pal.ink).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }, lp(0, WRAP, 1f))
        head.addView(iconButton(R.drawable.ic_close, "Close ${t.title}", pal.inkMuted, pal, 40, 14) {
            closeTab(index)
            if (tabs.any { it.incognito == privateView }) openTabs(privateView) else closeOverlay()
        })
        card.addView(head, lp(MATCH, dp(40)))
        card.addView(View(this).apply { setBackgroundColor(pal.line) }, lp(MATCH, 1))
        val preview = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            val bmp = t.thumb
            when {
                bmp != null && t.url != null -> setImageBitmap(bmp)
                t.url == null && pal.space -> { setImageResource(R.drawable.saturn); alpha = 0.7f }
                else -> setBackgroundColor(pal.surface)
            }
        }
        card.addView(preview, lp(MATCH, 0, 1f))
        return card
    }

    // ---- menu

    private fun openMenu() {
        val t = tab ?: return
        val s = sheet()
        if (t.url != null) {
            val head = row(spacing = 12)
            head.addView(label(t.title.take(1).uppercase(), 16f, pal.ink, bold = true, family = Typeface.SERIF).apply {
                gravity = Gravity.CENTER; background = box(pal.surfaceMuted, 12)
            }, lp(dp(40), dp(40)))
            val c = column(spacing = 2)
            c.addView(label(t.title, 15f, pal.ink, bold = true).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
            c.addView(label("${hostOf(t.url!!)} · ${if (t.url!!.startsWith("https")) "secure" else "not secure"}", 13f, pal.inkMuted))
            head.addView(c, lp(0, WRAP, 1f))
            val marked = store.isBookmarked(t.url)
            head.addView(iconButton(R.drawable.ic_bookmark, if (marked) "Remove bookmark" else "Bookmark this page", if (marked) pal.accent else pal.ink, pal, 44, 20,
                box(if (marked) pal.accentSoft else pal.surfaceMuted, 12)) {
                val on = store.toggleBookmark(t.url!!, t.title)
                toast(if (on) "Bookmarked" else "Bookmark removed")
                closeOverlay()
            })
            s.addView(head, lp(MATCH, WRAP))
        }
        val onPage = t.url != null
        val tiles = listOfNotNull(
            Tile(R.drawable.ic_bookmark, "Bookmarks") { closeOverlay(); openLibrary(bookmarks = true) },
            Tile(R.drawable.ic_history, "History") { closeOverlay(); openLibrary(bookmarks = false) },
            Tile(R.drawable.ic_download, "Downloads") { closeOverlay(); runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }.onFailure { toast("No downloads app found") } },
            if (onPage) Tile(R.drawable.ic_find, "Find") { closeOverlay(); openFind() } else null,
            if (onPage) Tile(R.drawable.ic_reader, "Reader") { closeOverlay(); t.web?.evaluateJavascript(READER, null) } else null,
            if (onPage) Tile(R.drawable.ic_moon, if (t.night) "Night off" else "Night Shift") {
                closeOverlay(); t.night = !t.night; t.web?.evaluateJavascript(if (t.night) NIGHT_ON else NIGHT_OFF, null)
            } else null,
            if (onPage) Tile(R.drawable.ic_desktop, if (t.desktop) "Mobile site" else "Desktop site") {
                closeOverlay(); t.desktop = !t.desktop
                t.web?.settings?.userAgentString = if (t.desktop) desktopAgent(WebSettings.getDefaultUserAgent(this)) else null
                t.web?.reload()
            } else null,
            if (onPage) Tile(R.drawable.ic_share, "Share") {
                closeOverlay()
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t.url), "Share link"))
            } else null,
            if (!onPage) Tile(R.drawable.ic_incognito, "Private tab") { closeOverlay(); newTab(incognito = true) } else null,
            if (!onPage) Tile(R.drawable.ic_reload, "Reopen tab") { closeOverlay(); reopenClosed() } else null,
        )
        val grid = column(spacing = 8)
        tiles.chunked(4).forEach { chunk ->
            val r = row(spacing = 8)
            chunk.forEach { (icon, text, action) ->
                val tile = column(spacing = 8).apply {
                    gravity = Gravity.CENTER
                    background = ripple(box(pal.canvas, 14, pal.line), pal, 14)
                    contentDescription = text
                    setOnClickListener { action() }
                }
                tile.addView(ImageView(this).apply { setImageResource(icon); imageTintList = ColorStateList.valueOf(pal.secondary) }, lp(dp(22), dp(22)))
                tile.addView(label(text, 12f, pal.ink).apply { gravity = Gravity.CENTER; maxLines = 1 }, lp(MATCH, WRAP))
                r.addView(tile, lp(0, dp(76), 1f))
            }
            repeat(4 - chunk.size) { r.addView(View(this), lp(0, 1, 1f)) }
            grid.addView(r, lp(MATCH, WRAP))
        }
        s.addView(grid, lp(MATCH, WRAP))
        s.addView(group("Quick settings", listOf(
            settingRow("Privacy shield", "Blocks ads and trackers on this phone", switchView(store.shield, "Privacy shield") { store.shield = it; refreshChrome() }),
            settingRow("Chill mode", "Plain look, no effects", switchView(store.chill, "Chill mode") { on -> store.chill = on; ui.postDelayed({ pal = palette(); rebuild() }, 160) }),
        )), lp(MATCH, WRAP))
        val settingsButton = row(Gravity.CENTER, spacing = 10).apply {
            background = ripple(box(Color.TRANSPARENT, 14, pal.lineStrong), pal, 14)
            contentDescription = "Settings"
            setOnClickListener { openSettings() }
        }
        settingsButton.addView(ImageView(this).apply { setImageResource(R.drawable.ic_settings); imageTintList = ColorStateList.valueOf(pal.ink) }, lp(dp(18), dp(18)))
        settingsButton.addView(label("Settings", 15f, pal.ink, bold = true))
        s.addView(settingsButton, lp(MATCH, dp(52)))
        if (pal.space) s.glow(pal.secondary, 24)
        openOverlay(s, dim = true, bottom = true)
    }

    // ---- library (bookmarks / history)

    private fun openLibrary(bookmarks: Boolean) {
        val (page, body) = fullPage(if (bookmarks) "Bookmarks" else "History")
        val entries = if (bookmarks) store.bookmarks else store.history
        if (entries.isEmpty()) {
            body.addView(label(if (bookmarks) "No bookmarks yet. Open a page, then tap the bookmark in the menu." else "No history yet. Pages you visit show up here.", 15f, pal.inkMuted).apply { setLineSpacing(0f, 1.3f) })
        } else {
            if (!bookmarks) {
                body.addView(label("Clear history", 14f, pal.danger, bold = true).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(4), 0, 0, 0)
                    setOnClickListener {
                        AlertDialog.Builder(this@MainActivity).setTitle("Clear all history?").setMessage("Every page in your Browsery history on this phone will be removed.")
                            .setPositiveButton("Clear history") { _, _ -> store.clearHistory(); closeOverlay(); openLibrary(false) }
                            .setNegativeButton("Cancel", null).show()
                    }
                }, lp(WRAP, dp(44)))
            }
            val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
            body.addView(group(if (bookmarks) "${entries.size} saved" else "Recent", entries.take(150).map { e ->
                settingRow(e.title, if (bookmarks) hostOf(e.url) else "${hostOf(e.url)} · ${fmt.format(Date(e.time))}",
                    iconButton(R.drawable.ic_trash, "Remove ${e.title}", pal.inkMuted, pal, 44, 18) {
                        if (bookmarks) store.removeBookmark(e.url) else store.removeHistory(e.url)
                        closeOverlay(); openLibrary(bookmarks)
                    }) { closeOverlay(); openInNewTab(e.url) }
            }))
        }
        openOverlay(page, dim = false)
    }

    // ---- find on page

    private fun openFind() {
        val web = tab?.web ?: return
        closeFind()
        val bar = row(spacing = 4).apply {
            background = box(pal.surface, 14, pal.line)
            setPadding(dp(12), 0, dp(4), 0)
            if (pal.space) glow(pal.secondary, 12)
        }
        val count = label("", 13f, pal.inkMuted)
        bar.tag = count
        val input = EditText(this).apply {
            hint = "Find on page"; background = null; isSingleLine = true; textSize = 15f
            setTextColor(pal.ink); setHintTextColor(pal.inkMuted)
            addTextChangedListener(watcher { web.findAllAsync(it) })
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setOnEditorActionListener { _, _, _ -> web.findNext(true); true }
        }
        bar.addView(input, lp(0, dp(48), 1f))
        bar.addView(count)
        bar.addView(iconButton(R.drawable.ic_up, "Previous match", pal.ink, pal, 44, 20) { web.findNext(false) })
        bar.addView(iconButton(R.drawable.ic_down, "Next match", pal.ink, pal, 44, 20) { web.findNext(true) })
        bar.addView(iconButton(R.drawable.ic_close, "Close find", pal.ink, pal, 44, 18) { closeFind() })
        findBar = bar
        content.addView(bar, FrameLayout.LayoutParams(MATCH, dp(52), Gravity.TOP).apply { setMargins(dp(12), dp(10), dp(12), 0) })
        input.requestFocus()
        showKeyboard(input)
    }

    private fun closeFind() {
        findBar?.let { content.removeView(it) }
        findBar = null
        tab?.web?.clearMatches()
        hideKeyboard()
    }

    // ---- Hey Groq

    private fun openGroq(prefill: String? = null) {
        val page = column().apply {
            isClickable = true
            background = if (pal.space) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(alpha(pal.accentSoft, 0.9f), pal.void, pal.void)) else box(pal.void, 0)
        }
        val head = row(spacing = 12).apply { setPadding(dp(16), dp(14), dp(8), dp(12)) }
        head.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_spark); imageTintList = ColorStateList.valueOf(pal.accent)
            background = box(pal.accentSoft, 12); setPadding(dp(10), dp(10), dp(10), dp(10))
        }, lp(dp(40), dp(40)))
        val hc = column(spacing = 2)
        hc.addView(label("Hey Groq", 17f, pal.ink, bold = true))
        hc.addView(label(tab?.url?.let { "Beside ${hostOf(it)}" } ?: "Ask about the web or Browsery", 13f, pal.inkMuted))
        head.addView(hc, lp(0, WRAP, 1f))
        head.addView(iconButton(R.drawable.ic_close, "Close Hey Groq", pal.ink, pal) { closeOverlay() })
        page.addView(head, lp(MATCH, WRAP))
        page.addView(View(this).apply { setBackgroundColor(pal.line) }, lp(MATCH, 1))

        val scroll = ScrollView(this)
        val list = column(spacing = 12).apply { setPadding(dp(16), dp(16), dp(16), dp(16)) }
        scroll.addView(list)
        page.addView(scroll, lp(MATCH, 0, 1f))

        fun bubble(role: String, text: String) {
            val mine = role == "user"
            val b = label(text, 15f, pal.ink).apply {
                setLineSpacing(0f, 1.3f)
                setTextIsSelectable(true)
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = if (mine) box(pal.surfaceMuted, 16) else box(pal.canvas, 16, alpha(pal.secondary, 0.22f))
            }
            list.addView(b, lp(WRAP, WRAP).apply { gravity = if (mine) Gravity.END else Gravity.START; setMargins(if (mine) dp(48) else 0, 0, if (mine) 0 else dp(24), 0) })
        }
        fun note(text: String) {
            list.addView(label(text, 13f, pal.secondaryInk).apply {
                setPadding(dp(12), dp(10), dp(12), dp(10)); background = box(pal.secondarySoft, 12)
            }, lp(MATCH, WRAP))
        }
        if (store.groqKey.isBlank()) {
            note("Hey Groq needs your own Groq API key. Get one free at console.groq.com/keys, then add it in Settings → Hey Groq. It's stored only on this phone.")
        } else if (chat.isEmpty()) {
            note(if (tab?.url != null) "Ask about this page, or ask Browsery to open, search or find something." else "Ask anything, or ask Browsery to open a site or run a search.")
        }
        chat.forEach { (role, text) -> bubble(role, text) }

        val input = EditText(this).apply {
            hint = if (tab?.url != null) "Ask about this page…" else "Ask Hey Groq…"
            background = null; textSize = 16f; isSingleLine = true
            setTextColor(pal.ink); setHintTextColor(pal.inkMuted)
            imeOptions = EditorInfo.IME_ACTION_SEND
            setPadding(dp(16), 0, dp(4), 0)
            prefill?.let { setText(it) }
        }

        fun send(question: String) {
            val q = question.trim()
            if (q.isEmpty() || groqBusy) return
            if (store.groqKey.isBlank()) { closeOverlay(); openSettings(); toast("Add your Groq API key first"); return }
            input.setText("")
            hideKeyboard()
            chat.add("user" to q)
            bubble("user", q)
            val thinking = label("Thinking…", 14f, pal.inkMuted)
            list.addView(thinking)
            groqBusy = true
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
            pageText { pageContext ->
                Groq.ask(store.groqKey, store.groqModel, chat.toList(), pageContext) { result ->
                    runOnUiThread {
                        groqBusy = false
                        list.removeView(thinking)
                        result.onSuccess { reply ->
                            val text = reply.text.ifBlank { "Done." }
                            chat.add("assistant" to text)
                            bubble("assistant", text)
                            reply.action?.let { a -> note(runAction(a)) }
                        }.onFailure { bubble("assistant", it.message ?: "Hey Groq couldn't answer. Check your connection and try again.") }
                        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
                    }
                }
            }
        }
        input.setOnEditorActionListener { v, _, _ -> send(v.text.toString()); true }

        val chips = row(spacing = 8)
        listOfNotNull(
            if (tab?.url != null) "Summarize this page" else null,
            if (tab?.url != null) "Explain it simpler" else "What can Browsery do?",
            "Search the web for…",
        ).forEach { c ->
            chips.addView(label(c, 14f, pal.ink).apply {
                gravity = Gravity.CENTER; setPadding(dp(14), 0, dp(14), 0)
                background = ripple(box(pal.canvas, 20, pal.line), pal, 20)
                setOnClickListener { if (c.endsWith("…")) { input.setText(c.removeSuffix("…") + " "); input.setSelection(input.text.length); input.requestFocus(); showKeyboard(input) } else send(c) }
            }, lp(WRAP, dp(40)))
        }
        page.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; setPadding(dp(16), 0, dp(16), dp(10)); clipToPadding = false; addView(chips) }, lp(MATCH, WRAP))

        val bottom = column(spacing = 12).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
            background = if (pal.space) GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(pal.surface, pal.canvas)) else box(pal.surface, 0)
        }
        val field = row(spacing = 4).apply { background = box(if (pal.space) pal.void else pal.canvas, 14, pal.lineStrong); setPadding(0, 0, dp(4), 0) }
        field.addView(input, lp(0, dp(48), 1f))
        field.addView(iconButton(R.drawable.ic_arrow, "Send", pal.ink, pal, 44, 18, box(pal.surfaceMuted, 10)) { send(input.text.toString()) })
        bottom.addView(field, lp(MATCH, dp(52)))
        val mic = iconButton(R.drawable.ic_mic, "Talk to Hey Groq", pal.onAccent, pal, 68, 28, box(pal.accent, 34)) { listenFor { send(it) } }
        if (pal.space) mic.glow(pal.accent, 16)
        bottom.addView(mic, lp(dp(68), dp(68)))
        bottom.addView(label("Tap to talk", 13f, pal.inkMuted))
        page.addView(bottom, lp(MATCH, WRAP))
        openOverlay(page, dim = false)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun pageText(done: (String?) -> Unit) {
        val t = tab
        val web = t?.web
        if (web == null || t.incognito) { done(null); return }
        web.evaluateJavascript("(function(){var b=document.body?document.body.innerText:'';return (document.title||'')+'\\n'+location.hostname+'\\n\\n'+b.slice(0,6000)})()") { value ->
            done(runCatching { JSONTokener(value).nextValue() as? String }.getOrNull())
        }
    }

    private fun runAction(a: Groq.Action): String = when (a.type) {
        "open_url" -> { closeOverlay(); openInNewTab(a.arg); "Opened ${hostOf(a.arg)}" }
        "web_search" -> { closeOverlay(); openInNewTab(store.searchUrl(a.arg)); "Searched for “${a.arg}”" }
        "find_in_page" -> if (tab?.web != null) { closeOverlay(); openFind(); tab?.web?.findAllAsync(a.arg); "Finding “${a.arg}”" } else "Open a page first to find words on it."
        "new_tab" -> { closeOverlay(); newTab(); "Opened a new tab" }
        else -> "Hey Groq can't do that."
    }

    // ---- settings

    private fun openSettings() {
        val (page, body) = fullPage("Settings")
        body.addView(group("Browsing", listOf(
            settingRow("Search engine", "Used for searches you type", valueText(engineLabel())) { chooseEngine() },
            settingRow("Search suggestions", "From your history and bookmarks", switchView(store.suggestions, "Search suggestions") { store.suggestions = it }),
            settingRow("Restore tabs", "Reopen your tabs when Browsery starts", switchView(store.restore, "Restore tabs") { store.restore = it }),
        )))
        body.addView(group("Privacy", listOf(
            settingRow("Privacy shield", "Blocks ads and trackers · ${store.blockedTotal} blocked so far", switchView(store.shield, "Privacy shield") { store.shield = it; refreshChrome() }),
            settingRow("HTTPS only", "Opens the secure version of pages", switchView(store.httpsOnly, "HTTPS only") { store.httpsOnly = it }),
            settingRow("Third-party cookies", "Off blocks cross-site tracking cookies", switchView(store.thirdPartyCookies, "Third-party cookies") { on ->
                store.thirdPartyCookies = on
                tabs.forEach { t -> t.web?.let { CookieManager.getInstance().setAcceptThirdPartyCookies(it, on) } }
            }),
            settingRow("Clear browsing data", "History, cookies, site storage and cache", valueText("Clear")) { confirmClear() },
        )))
        body.addView(group("Hey Groq", listOf(
            settingRow("Groq API key", if (store.groqKey.isBlank()) "Needed for Hey Groq · console.groq.com/keys" else "Saved on this phone only", valueText(if (store.groqKey.isBlank()) "Add" else "Change")) { editKey() },
            settingRow("Model", store.groqModel, valueText(if (store.groqModel.contains("120b")) "Smart" else "Fast")) {
                store.groqModel = if (store.groqModel.contains("120b")) "openai/gpt-oss-20b" else "openai/gpt-oss-120b"
                closeOverlay(); openSettings()
            },
        )))
        body.addView(group("Look", listOf(
            settingRow("Chill mode", "Plain look, no effects. Follows your phone's light or dark theme.", switchView(store.chill, "Chill mode") { on ->
                store.chill = on; ui.postDelayed({ pal = palette(); rebuild(); openSettings() }, 160)
            }),
            settingRow("Default browser", "Open links from other apps in Browsery", valueText("Set")) {
                runCatching { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }.onFailure { toast("Open your phone's Settings › Apps › Default apps") }
            },
        )))
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: ""
        body.addView(label("Browsery for Android $version", 12f, pal.inkMuted).apply { gravity = Gravity.CENTER }, lp(MATCH, WRAP))
        openOverlay(page, dim = false)
    }

    private fun engineLabel() = if (store.engine == "Browsery") "Browsery" else store.engine

    private fun chooseEngine() {
        val names = arrayOf("Browsery", "DuckDuckGo", "Bing")
        val labels = arrayOf("Browsery Search (Mojeek, independent)", "DuckDuckGo", "Bing")
        AlertDialog.Builder(this).setTitle("Search engine")
            .setSingleChoiceItems(labels, names.indexOf(store.engine).coerceAtLeast(0)) { d, which -> store.engine = names[which]; d.dismiss(); closeOverlay(); openSettings() }
            .setNegativeButton("Cancel", null).show()
    }

    private fun editKey() {
        val input = EditText(this).apply {
            hint = "gsk_…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }
        val wrap = FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(input) }
        val d = AlertDialog.Builder(this).setTitle("Groq API key")
            .setMessage("Paste the key that starts with gsk_. It stays in Browsery's private storage on this phone and is only sent to Groq.")
            .setView(wrap)
            .setPositiveButton("Save key", null)
            .setNegativeButton("Cancel", null)
            .apply { if (store.groqKey.isNotBlank()) setNeutralButton("Remove key") { _, _ -> store.groqKey = ""; closeOverlay(); openSettings() } }
            .show()
        d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val key = input.text.toString().trim()
            if (!Regex("^gsk_\\S{20,}$").matches(key)) { input.error = "Groq keys start with gsk_"; return@setOnClickListener }
            store.groqKey = key
            d.dismiss(); closeOverlay(); openSettings(); toast("Key saved on this phone")
        }
    }

    private fun confirmClear() {
        AlertDialog.Builder(this).setTitle("Clear browsing data?")
            .setMessage("This removes your history, cookies, site storage and cache on this phone. You'll be signed out of websites. Bookmarks and shortcuts stay.")
            .setPositiveButton("Clear data") { _, _ ->
                store.clearHistory()
                CookieManager.getInstance().removeAllCookies(null)
                WebStorage.getInstance().deleteAllData()
                tabs.forEach { it.web?.clearCache(true) }
                toast("Browsing data cleared")
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun shieldInfo() {
        val t = tab
        AlertDialog.Builder(this).setTitle("Privacy shield")
            .setMessage(
                if (!store.shield) "The shield is off. Turn it on to block ads and trackers."
                else "Blocked ${t?.blocked ?: 0} ads and trackers on this page and ${store.blockedTotal} in total. Blocking happens on your phone; pages themselves are never blocked."
            )
            .setPositiveButton(if (store.shield) "Turn off" else "Turn on") { _, _ -> store.shield = !store.shield; t?.web?.reload(); if (t?.url == null) showCurrent() else refreshChrome() }
            .setNegativeButton("Close", null).show()
    }

    // ------------------------------------------------------------------ helpers

    private fun listenFor(target: (String) -> Unit) {
        voiceTarget = target
        try {
            listen.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak now"))
        } catch (_: ActivityNotFoundException) {
            voiceTarget = null
            toast("Voice input isn't available on this phone")
        }
    }

    private fun watcher(onChange: (String) -> Unit) = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) { onChange(s?.toString() ?: "") }
    }

    private fun hostOf(url: String): String = runCatching { Uri.parse(url).host?.removePrefix("www.") }.getOrNull()?.takeIf { it.isNotBlank() } ?: url

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun hideKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(root.windowToken, 0)
    }

    private fun showKeyboard(v: View) {
        v.post { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(v, InputMethodManager.SHOW_IMPLICIT) }
    }

    companion object {
        const val NIGHT_ON = "(function(){if(document.getElementById('browsery-night'))return;var s=document.createElement('style');s.id='browsery-night';s.textContent='html{filter:invert(.92) hue-rotate(180deg)!important;background:#fff!important}img,video,picture,canvas,iframe,svg image{filter:invert(1) hue-rotate(180deg)!important}';document.documentElement.appendChild(s)})()"
        const val NIGHT_OFF = "(function(){var s=document.getElementById('browsery-night');if(s)s.remove()})()"
        const val READER = "(function(){function e(s){return String(s).replace(/[&<>\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})}var a=document.querySelector('article')||document.querySelector('main')||document.body;var h='';a.querySelectorAll('h1,h2,h3,p,li,blockquote,pre,img').forEach(function(n){var t=n.tagName.toLowerCase();if(t==='img'){if(n.naturalWidth>200&&/^https?:/.test(n.src))h+='<img src=\"'+e(n.src)+'\">';return}var s=(n.innerText||'').trim();if(s)h+='<'+t+'>'+e(s)+'</'+t+'>'});var title=e(document.title);document.documentElement.innerHTML='<head><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>'+title+'</title><style>body{margin:0 auto;max-width:42rem;padding:24px 20px 96px;font:19px/1.65 Georgia,serif;background:#f7f5f0;color:#202622}h1,h2,h3{font-family:sans-serif;line-height:1.2}img{max-width:100%;height:auto;border-radius:14px}pre{white-space:pre-wrap}</style></head><body><h1>'+title+'</h1>'+h+'</body>'})()"
    }
}
