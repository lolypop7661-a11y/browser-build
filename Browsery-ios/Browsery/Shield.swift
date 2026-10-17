import Foundation

/// Privacy shield: blocks well-known ad and tracker hosts as WebKit content rules. Pages themselves are never blocked.
enum Shield {
    static let hosts = [
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
    ]

    static let identifier = "browsery-shield-v1"

    /// WebKit content-blocker JSON: one block rule per host, matching the host and any subdomain, third-party loads only.
    static var json: String {
        let rules: [[String: Any]] = hosts.map { host in
            let escaped = host.replacingOccurrences(of: ".", with: "\\.")
            return [
                "trigger": [
                    "url-filter": "^[^:]+://+([^:/]+\\.)?" + escaped + "[:/]",
                    "load-type": ["third-party"],
                ],
                "action": ["type": "block"],
            ]
        }
        let data = try! JSONSerialization.data(withJSONObject: rules)
        return String(data: data, encoding: .utf8)!
    }
}

/// Small scripts shared with Browsery for Android.
enum PageScripts {
    static let nightOn = "(function(){if(document.getElementById('browsery-night'))return;var s=document.createElement('style');s.id='browsery-night';s.textContent='html{filter:invert(.92) hue-rotate(180deg)!important;background:#fff!important}img,video,picture,canvas,iframe,svg image{filter:invert(1) hue-rotate(180deg)!important}';document.documentElement.appendChild(s)})()"

    static let nightOff = "(function(){var s=document.getElementById('browsery-night');if(s)s.remove()})()"

    static let reader = #"(function(){function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}var a=document.querySelector('article')||document.querySelector('main')||document.body;var h='';a.querySelectorAll('h1,h2,h3,p,li,blockquote,pre,img').forEach(function(n){var t=n.tagName.toLowerCase();if(t==='img'){if(n.naturalWidth>200&&/^https?:/.test(n.src))h+='<img src="'+e(n.src)+'">';return}var s=(n.innerText||'').trim();if(s)h+='<'+t+'>'+e(s)+'</'+t+'>'});var title=e(document.title);document.documentElement.innerHTML='<head><meta name=viewport content="width=device-width,initial-scale=1"><title>'+title+'</title><style>body{margin:0 auto;max-width:42rem;padding:24px 20px 96px;font:19px/1.65 Georgia,serif;background:#f7f5f0;color:#202622}h1,h2,h3{font-family:-apple-system,sans-serif;line-height:1.2}img{max-width:100%;height:auto;border-radius:14px}pre{white-space:pre-wrap}@media (prefers-color-scheme:dark){body{background:#151c19;color:#f1f3ec}}</style></head><body><h1>'+title+'</h1>'+h+'</body>'})()"#

    static let pageText = "(function(){var b=document.body?document.body.innerText:'';return (document.title||'')+'\\n'+location.hostname+'\\n\\n'+b.slice(0,6000)})()"
}
