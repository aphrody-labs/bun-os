package com.aphrody.android

import android.net.Uri
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class GalleryTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun nativeBridgeAndStateSurviveNavigation() {
        compose.onNodeWithTag("native-result").assertIsDisplayed()
        compose.onNodeWithText("Java + Rust JNI : 20 + 22 = 42").assertIsDisplayed()
        compose.onNodeWithTag("name-field").performTextReplacement("Yoyo")
        compose.onNodeWithTag("greet-button").performScrollTo().performClick()
        compose.onNodeWithText("Bonjour Yoyo").assertIsDisplayed()
        compose.onNodeWithTag("nav-SETTINGS").performClick()
        compose.onNodeWithTag("theme-DARK").performClick().assertIsSelected()
        compose.onNodeWithTag("dynamic-color").assertIsOff().performClick().assertIsOn()
        compose.onNodeWithTag("nav-COMPONENTS").performClick()
        compose.onNodeWithText("Yoyo").assertIsDisplayed()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("Yoyo").assertIsDisplayed()
        compose.onNodeWithText("Java + Rust JNI : 20 + 22 = 42").assertIsDisplayed()
        compose.onNodeWithTag("show-dialog").performClick()
        compose.onNodeWithText("Votre espace Android").assertIsDisplayed()
        compose.onNodeWithText("Fermer").performClick()
        compose.onNodeWithTag("nav-BUN").performClick()
        compose.onNodeWithTag("nav-BUN").assertIsSelected()
        val status = AtomicReference("")
        compose.waitUntil(10_000) {
            compose.activityRule.scenario.onActivity { activity ->
                findWebView(activity.window.decorView)?.evaluateJavascript(
                    "document.getElementById('status')?.textContent || ''",
                ) { value -> status.set(value) }
            }
            status.get().contains("Interface Bun chargée.")
        }
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findWebView(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }

    @Test
    fun navigationAdaptsToAvailableWindow() {
        assertAdaptiveNavigation()
        try {
            compose.activityRule.scenario.onActivity {
                it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            compose.waitUntil(10_000) {
                compose.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            }
            compose.waitForIdle()
            assertAdaptiveNavigation()
            compose.onNodeWithTag("nav-SETTINGS").performClick()
            compose.onNodeWithText("Apparence").assertIsDisplayed()
        } finally {
            compose.activityRule.scenario.onActivity {
                it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }

    private fun assertAdaptiveNavigation() {
        val window = compose.activity.resources.configuration
        val first = compose.onNodeWithTag("nav-COMPONENTS").fetchSemanticsNode().boundsInRoot
        val second = compose.onNodeWithTag("nav-BUN").fetchSemanticsNode().boundsInRoot
        val rail = window.screenWidthDp >= 600 && window.screenHeightDp >= 480
        if (rail) {
            assertTrue("Rail destinations must be arranged vertically", second.top > first.top)
            assertTrue("Rail destinations must share a horizontal position", kotlin.math.abs(second.left - first.left) < 2f)
        } else {
            assertTrue("Compact navigation must be horizontal", second.left > first.left)
            assertTrue("Compact destinations must share a vertical position", kotlin.math.abs(second.top - first.top) < 2f)
        }
        android.util.Log.i("AphrodyComposeTest", "Adaptive ${window.screenWidthDp}x${window.screenHeightDp}dp rail=$rail")
    }

    @Test
    fun webAssetPolicyRejectsRemoteAndTraversalUrls() {
        assertTrue(isAllowedAssetUrl(Uri.parse("https://appassets.androidplatform.net/assets/index.html")))
        assertFalse(isAllowedAssetUrl(Uri.parse("https://example.com/assets/index.html")))
        assertFalse(isAllowedAssetUrl(Uri.parse("file:///assets/index.html")))
        assertFalse(isAllowedAssetUrl(Uri.parse("https://appassets.androidplatform.net/assets/%2e%2e/secret")))
        assertFalse(isAllowedAssetUrl(Uri.parse("https://appassets.androidplatform.net:1234/assets/index.html")))
    }
}
