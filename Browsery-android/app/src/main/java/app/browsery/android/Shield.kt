package app.browsery.android

import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/** Privacy shield: blocks well-known ad and tracker hosts on the phone. Pages themselves are never blocked. */
object Shield {
    private val hosts = setOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com",
        "googletagmanager.com", "googletagservices.com", "adservice.google.com", "adnxs.com", "criteo.com",
        "criteo.net", "taboola.com", "outbrain.com", "scorecardresearch.com", "quantserve.com",
        "connect.facebook.net", "hotjar.com", "mixpanel.com", "cdn.segment.com", "api.segment.io",
        "amazon-adsystem.com", "adsrvr.org", "rubiconproject.com", "pubmatic.com", "openx.net",
        "casalemedia.com", "moatads.com", "yieldmo.com", "adform.net", "bidswitch.net", "smartadserver.com",
        "media.net", "2mdn.net", "serving-sys.com", "chartbeat.com", "chartbeat.net", "clarity.ms",
        "bat.bing.com", "ads.linkedin.com", "px.ads.linkedin.com", "analytics.tiktok.com", "ads-twitter.com",
        "static.ads-twitter.com", "ads.yahoo.com", "advertising.com", "teads.tv", "sharethrough.com",
        "33across.com", "indexww.com", "lijit.com", "sovrn.com", "contextweb.com", "spotxchange.com",
        "imasdk.googleapis.com", "fundingchoicesmessages.google.com", "branch.io", "app-measurement.com",
        "crashlytics.com", "adcolony.com", "applovin.com", "unityads.unity3d.com", "inmobi.com", "mopub.com",
        "zedo.com", "popads.net", "propellerads.com", "exoclick.com", "trafficjunky.net", "onesignal.com",
    )

    fun blocks(url: Uri?): Boolean {
        val host = url?.host?.lowercase() ?: return false
        var h: String = host
        while (true) {
            if (h in hosts) return true
            val dot = h.indexOf('.')
            if (dot < 0 || dot == h.lastIndexOf('.')) return false
            h = h.substring(dot + 1)
        }
    }

    fun empty(): WebResourceResponse = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
}
