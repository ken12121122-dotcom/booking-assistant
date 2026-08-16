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
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("booking_assistant", MODE_PRIVATE) }
    private var updateDownloadId: Long = -1L

    companion object {
        private const val UPDATE_URL = "https://github.com/ken12121122-dotcom/booking-assistant/releases/download/android-latest/BookingAssistant-latest.apk"
        private const val KEY_ALIAS = "booking_assistant_secret_key"
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
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)
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

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private fun saveEncrypted(name: String, value: String) {
        if (value.isBlank()) {
            prefs.edit().remove(name).apply()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val payload = JSONObject()
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
            .toString()
        prefs.edit().putString(name, payload).apply()
    }

    private fun readEncrypted(name: String): String {
        val payload = prefs.getString(name, null) ?: return ""
        return try {
            val obj = JSONObject(payload)
            val iv = Base64.decode(obj.getString("iv"), Base64.NO_WRAP)
            val data = Base64.decode(obj.getString("data"), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(data), Charsets.UTF_8)
        } catch (_: Exception) { "" }
    }

    private fun requestJson(url: String, method: String = "GET", bearer: String = "", body: String? = null): JSONObject {
        val result = JSONObject()
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10000
                readTimeout = 10000
                setRequestProperty("Content-Type", "application/json")
                if (bearer.isNotBlank()) setRequestProperty("Authorization", "Bearer $bearer")
                if (body != null) doOutput = true
            }
            if (body != null) conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            result.put("ok", code in 200..299).put("status", code)
            if (text.isNotBlank()) {
                try { result.put("body", JSONObject(text)) } catch (_: Exception) { result.put("raw", text) }
            }
            conn.disconnect()
            result
        } catch (e: Exception) {
            result.put("ok", false).put("error", e.javaClass.simpleName).put("message", e.message ?: "")
        }
    }

    private fun lineRequest(method: String, path: String, token: String, body: String? = null): JSONObject {
        if (token.isBlank()) return JSONObject().put("ok", false).put("error", "missing_token")
        return requestJson("https://api.line.me$path", method, token, body)
    }

    private fun deviceId(): String {
        val existing = prefs.getString("device_id", "") ?: ""
        if (existing.isNotBlank()) return existing
        val created = "BA-" + UUID.randomUUID().toString().replace("-", "").take(12).uppercase()
        prefs.edit().putString("device_id", created).apply()
        return created
    }

    inner class AppBridge {
        @JavascriptInterface fun isInitialized(): Boolean = prefs.getBoolean("initialized", false)
        @JavascriptInterface fun getBusinessName(): String = prefs.getString("business_name", "") ?: ""
        @JavascriptInterface fun getVersion(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun getDeviceId(): String = deviceId()

        @JavascriptInterface
        fun saveSetup(businessName: String, adminPin: String): Boolean {
            if (businessName.isBlank() || adminPin.length < 4) return false
            prefs.edit().putString("business_name", businessName.trim()).putString("admin_pin", adminPin)
                .putBoolean("initialized", true).apply()
            return true
        }

        @JavascriptInterface
        fun resetSetup(): Boolean {
            prefs.edit().remove("initialized").remove("business_name").remove("admin_pin").apply()
            return true
        }

        @JavascriptInterface
        fun getLineConfig(): String = JSONObject()
            .put("secretSet", readEncrypted("line_secret").isNotBlank())
            .put("tokenSet", readEncrypted("line_token").isNotBlank())
            .put("webhook", prefs.getString("line_webhook", "") ?: "")
            .put("botName", prefs.getString("line_bot_name", "") ?: "")
            .put("basicId", prefs.getString("line_basic_id", "") ?: "")
            .put("deviceId", deviceId())
            .toString()

        @JavascriptInterface
        fun saveLineConfig(secret: String, token: String, webhook: String): String {
            if (token.isBlank() && readEncrypted("line_token").isBlank()) {
                return JSONObject().put("ok", false).put("error", "token_required").toString()
            }
            if (webhook.isNotBlank() && !webhook.startsWith("https://")) {
                return JSONObject().put("ok", false).put("error", "https_required").toString()
            }
            if (secret.isNotBlank()) saveEncrypted("line_secret", secret.trim())
            if (token.isNotBlank()) saveEncrypted("line_token", token.trim())
            prefs.edit().putString("line_webhook", webhook.trim()).apply()
            return JSONObject().put("ok", true).toString()
        }

        @JavascriptInterface
        fun testLineToken(): String {
            val result = lineRequest("GET", "/v2/bot/info", readEncrypted("line_token"))
            if (result.optBoolean("ok")) {
                val body = result.optJSONObject("body")
                prefs.edit().putString("line_bot_name", body?.optString("displayName", "") ?: "")
                    .putString("line_basic_id", body?.optString("basicId", "") ?: "").apply()
            }
            return result.toString()
        }

        @JavascriptInterface
        fun configureLineWebhook(): String {
            val endpoint = prefs.getString("line_webhook", "") ?: ""
            if (!endpoint.startsWith("https://")) return JSONObject().put("ok", false).put("error", "https_required").toString()
            return lineRequest("PUT", "/v2/bot/channel/webhook/endpoint", readEncrypted("line_token"), JSONObject().put("endpoint", endpoint).toString()).toString()
        }

        @JavascriptInterface
        fun testLineWebhook(): String {
            val endpoint = prefs.getString("line_webhook", "") ?: ""
            val body = if (endpoint.startsWith("https://")) JSONObject().put("endpoint", endpoint).toString() else "{}"
            return lineRequest("POST", "/v2/bot/channel/webhook/test", readEncrypted("line_token"), body).toString()
        }

        @JavascriptInterface
        fun pollLineGateway(): String {
            val endpoint = prefs.getString("line_webhook", "") ?: ""
            val secret = readEncrypted("line_secret")
            if (!endpoint.startsWith("https://")) return JSONObject().put("ok", false).put("error", "webhook_required").toString()
            if (secret.isBlank()) return JSONObject().put("ok", false).put("error", "secret_required").toString()
            val separator = if (endpoint.contains("?")) "&" else "?"
            val url = endpoint + separator + "mode=poll&device_id=" + URLEncoder.encode(deviceId(), "UTF-8")
            return requestJson(url, "GET", secret).toString()
        }

        @JavascriptInterface
        fun startUpdate(): String {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply { data = Uri.parse("package:$packageName") })
                return "permission_required"
            }
            return try {
                val request = DownloadManager.Request(Uri.parse(UPDATE_URL))
                    .setTitle("Booking Assistant 更新")
                    .setDescription("正在下載最新版本…")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(this@MainActivity, null, "BookingAssistant-latest.apk")
                    .setAllowedOverMetered(true).setAllowedOverRoaming(false)
                updateDownloadId = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                "downloading"
            } catch (e: Exception) { "error:${e.javaClass.simpleName}" }
        }
    }
}
