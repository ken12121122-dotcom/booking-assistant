package com.bookingassistant.app

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("booking_assistant", MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }

        webView.settings.javaScriptEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.addJavascriptInterface(AppBridge(), "BookingNative")
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    inner class AppBridge {
        @JavascriptInterface
        fun isInitialized(): Boolean = prefs.getBoolean("initialized", false)

        @JavascriptInterface
        fun getBusinessName(): String = prefs.getString("business_name", "") ?: ""

        @JavascriptInterface
        fun getVersion(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun saveSetup(businessName: String, adminPin: String): Boolean {
            if (businessName.isBlank() || adminPin.length < 4) return false
            prefs.edit()
                .putString("business_name", businessName.trim())
                .putString("admin_pin", adminPin)
                .putBoolean("initialized", true)
                .apply()
            return true
        }

        @JavascriptInterface
        fun resetSetup(): Boolean {
            prefs.edit().clear().apply()
            return true
        }
    }
}
