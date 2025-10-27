package com.eli.rokucontrol

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var ttsBridge: TtsBridge? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    ttsBridge = TtsBridge(this)
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    ttsBridge?.let { bridge ->
      webView.addJavascriptInterface(bridge, "NativeTts")
    }
  }

  override fun onDestroy() {
    ttsBridge?.shutdown()
    ttsBridge = null
    super.onDestroy()
  }
}
