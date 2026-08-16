package com.bookingassistant.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("booking_assistant", MODE_PRIVATE) }
    private var updateDownloadId: Long = -1L

    companion object {
        private const val UPDATE_URL = "https://github.com/ken12121122-dotcom/booking-assistant/releases/download/android-latest/BookingAssistant-latest.apk"
    }

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (id != updateDownloadId) return
            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            val uri = manager.getUriForDownloadedFile(id) ?: run {
                Toast.makeText(this@MainActivity, "更新檔下載失敗", Toast.LENGTH_LONG).show()
                return
            }
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(installIntent)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }

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
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.addJavascriptInterface(AppBridge(), "BookingNative")
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onDestroy() {
        unregisterReceiver(downloadReceiver)
        webView.removeJavascriptInterface("BookingNative")
        webView.destroy()
        super.onDestroy()
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

        @JavascriptInterface
        fun startUpdate(): String {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(settingsIntent)
                return "permission_required"
            }

            return try {
                val request = DownloadManager.Request(Uri.parse(UPDATE_URL))
                    .setTitle("Booking Assistant 更新")
                    .setDescription("正在下載最新版本…")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(this@MainActivity, null, "BookingAssistant-latest.apk")
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(false)

                val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                updateDownloadId = manager.enqueue(request)
                "downloading"
            } catch (e: Exception) {
                "error:${e.javaClass.simpleName}"
            }
        }
    }
}
