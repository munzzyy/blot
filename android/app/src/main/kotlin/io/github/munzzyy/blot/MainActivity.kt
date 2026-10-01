package io.github.munzzyy.blot

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.setPadding
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.security.SecureRandom

// One screen: the bundled web app in a WebView on the fixed asset origin.
// The APK requests no permissions at all; photos come back from the system
// camera app, and shares stream in over one-shot asset-origin tokens.
class MainActivity : ComponentActivity() {

    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$ASSET_HOST/index.html"
        const val AUTHORITY = "io.github.munzzyy.blot.files"

        // The oldest WebView the open, ink and export flow was proven on; Chromium 66 cannot parse the page.
        const val MIN_WEBVIEW_MAJOR = 109
        private const val PREFS = "blot"
        private const val KEY_ANDROID9_NOTED = "android9_noted"
    }

    lateinit var webView: WebView
        private set

    private lateinit var assetLoader: WebViewAssetLoader

    // (token, uri) pairs for shared-in and captured files, RAM only, each
    // served exactly once.
    private val shared = mutableListOf<Pair<String, Uri>>()

    // The pending callback for an in-page <input type="file">, deliverable
    // exactly once: a second onShowFileChooser before this fires cancels it.
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
        )
    }

    // MediaStore.Downloads needs Android 10; below that, BlotBridge.saveFile asks the person
    // where to put the export through this picker instead. The bytes wait here for the result.
    private var pendingSave: ByteArray? = null

    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val bytes = pendingSave
        pendingSave = null
        val ok = uri != null && bytes != null && runCatching {
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
            true
        }.getOrDefault(false)
        Toast.makeText(this, if (ok) getString(R.string.saved_to_downloads) else getString(R.string.save_failed), Toast.LENGTH_SHORT).show()
    }

    fun saveThroughPicker(bytes: ByteArray, name: String) {
        pendingSave = bytes
        createDocument.launch(name)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun noteAndroid9Once() {
        if (Build.VERSION.SDK_INT != Build.VERSION_CODES.P) return
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(KEY_ANDROID9_NOTED, false)) return
        val noted = { prefs.edit().putBoolean(KEY_ANDROID9_NOTED, true).apply() }
        AlertDialog.Builder(this)
            .setTitle(R.string.android9_title)
            .setMessage(R.string.android9_body)
            .setPositiveButton(android.R.string.ok) { _, _ -> noted() }
            .setOnCancelListener { noted() }
            .show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The screen holds an evidence journal; the app switcher must not
        // thumbnail it.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // A version Android reports but cannot identify is let through rather than blocked,
        // since only a confirmed too-old WebView is one the page is known not to run on.
        val webViewMajor = webViewMajorVersion()
        if (webViewMajor != null && webViewMajor < MIN_WEBVIEW_MAJOR) {
            showWebViewOutdated()
            return
        }

        webView = WebView(this)
        setContentView(webView)
        noteAndroid9Once()

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/shared/") { path -> serveShared(path) }
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            textZoom = (resources.configuration.fontScale * 100).toInt()
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
        }

        webView.addJavascriptInterface(BlotBridge(this), "BlotNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (request.url.host == ASSET_HOST) return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme == "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                try {
                    chooseFile.launch(params.createIntent())
                } catch (e: ActivityNotFoundException) {
                    filePathCallback = null
                    callback.onReceiveValue(null)
                }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        runCatching { File(cacheDir, "shared_out").deleteRecursively() }

        takeShared(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (takeShared(intent)) {
            webView.evaluateJavascript(
                "globalThis.__blotShared && __blotShared(${sharedTokensJson()})",
                null,
            )
        }
    }

    fun sharedTokensJson(): String =
        shared.joinToString(prefix = "[", postfix = "]", separator = ",") { "\"${it.first}\"" }

    private fun addShared(uri: Uri): String? {
        val raw = ByteArray(16)
        SecureRandom().nextBytes(raw)
        val token = raw.joinToString("") { "%02x".format(it) }
        shared.add(token to uri)
        return token
    }

    private fun takeShared(intent: Intent?): Boolean {
        val uris: List<Uri> = when (intent?.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(
                    androidx.core.content.IntentCompat.getParcelableExtra(
                        intent, Intent.EXTRA_STREAM, Uri::class.java,
                    ),
                )
            Intent.ACTION_SEND_MULTIPLE ->
                androidx.core.content.IntentCompat.getParcelableArrayListExtra(
                    intent, Intent.EXTRA_STREAM, Uri::class.java,
                )?.filterNotNull() ?: emptyList()
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            else -> emptyList()
        }
        // One document at a time: a new share-in supersedes anything
        // still queued, so a stale leftover can never open later instead
        // of the file the user just sent. content:// only, never our own
        // provider.
        shared.clear()
        val safe = uris.filter { it.scheme == "content" && it.authority != "io.github.munzzyy.blot.files" }
        if (safe.isEmpty()) return false
        for (uri in safe.take(50)) addShared(uri)
        return true
    }

    // One-shot: a successful serve removes the entry. The capture provider
    // is our own authority, which is exactly the case where serving must
    // still work, so only foreign shared_out-style paths are refused above.
    private fun serveShared(path: String): WebResourceResponse? {
        val idx = shared.indexOfFirst { it.first == path }
        if (idx == -1) return null
        val (_, uri) = shared[idx]
        return runCatching {
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            val stream = contentResolver.openInputStream(uri)
            shared.removeAt(idx)
            WebResourceResponse(mime, null, stream)
        }.getOrNull()
    }

    /** The Chromium major version of the WebView Android has picked, or null when it will not say. */
    private fun webViewMajorVersion(): Int? =
        runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull()
            ?.substringBefore('.')?.toIntOrNull()

    /** A plain native screen, since the page itself cannot run to say this on its own. */
    private fun showWebViewOutdated() {
        val packageName = runCatching { WebView.getCurrentWebViewPackage()?.packageName }.getOrNull()
            ?: "com.google.android.webview"
        val pad = (32 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad)
        }
        val title = TextView(this).apply {
            text = getString(R.string.webview_outdated_title)
            textSize = 20f
            gravity = Gravity.CENTER
        }
        val message = TextView(this).apply {
            text = getString(R.string.webview_outdated_message)
            gravity = Gravity.CENTER
            setPadding(0, pad / 2, 0, pad)
        }
        val button = Button(this).apply {
            text = getString(R.string.webview_update_button)
            setOnClickListener { openWebViewUpdate(packageName) }
        }
        layout.addView(title)
        layout.addView(message)
        layout.addView(button)
        setContentView(layout)
    }

    /** The store page for [packageName] where one is installed, else the system's own app-info page for it. */
    private fun openWebViewUpdate(packageName: String) {
        val store = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
        val opened = runCatching { startActivity(store) }.isSuccess
        if (!opened) {
            runCatching {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }
        }
    }

    override fun onDestroy() {
        shared.clear()
        super.onDestroy()
    }
}
