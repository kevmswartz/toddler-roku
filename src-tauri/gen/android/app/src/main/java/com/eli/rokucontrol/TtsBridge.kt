package com.eli.rokucontrol

import android.app.Activity
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.util.Log
import android.webkit.JavascriptInterface
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

class TtsBridge(private val activity: Activity) : TextToSpeech.OnInitListener {
    @Volatile
    private var isReady = false
    private var textToSpeech: TextToSpeech? = null
    private val pendingQueue = ConcurrentLinkedQueue<String>()

    init {
        activity.runOnUiThread {
            textToSpeech = TextToSpeech(activity.applicationContext, this)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            isReady = true
            val result = textToSpeech?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "US English voice missing or not supported; falling back to default locale.")
            }
            flushQueue()
        } else {
            Log.e(TAG, "TextToSpeech initialization failed with status $status")
        }
    }

    @JavascriptInterface
    fun speak(text: String?): Boolean {
        val trimmed = text?.trim() ?: return false
        if (trimmed.isEmpty()) return false
        pendingQueue.offer(trimmed)
        activity.runOnUiThread { flushQueue() }
        return true
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread {
            textToSpeech?.stop()
        }
    }

    @JavascriptInterface
    fun isReady(): Boolean = isReady

    private fun flushQueue() {
        if (!isReady) return
        while (true) {
            val next = pendingQueue.poll() ?: break
            val uttId = "roku_control_${SystemClock.uptimeMillis()}"
            val result = textToSpeech?.speak(next, TextToSpeech.QUEUE_FLUSH, null, uttId)
            if (result == TextToSpeech.ERROR) {
                Log.e(TAG, "Failed to speak text: $next")
            }
        }
    }

    fun shutdown() {
        activity.runOnUiThread {
            textToSpeech?.stop()
            textToSpeech?.shutdown()
            textToSpeech = null
            pendingQueue.clear()
            isReady = false
        }
    }

    companion object {
        private const val TAG = "NativeTtsBridge"
    }
}
