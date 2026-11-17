package io.github.tgood91.bushidodapp

import android.net.Uri
import com.google.androidbrowserhelper.trusted.LauncherActivity

/**
 * Opens https://bushido-dapp.onrender.com as a Trusted Web Activity: the page runs in the user's
 * Chrome (full-screen, no address bar once the site's assetlinks.json names this app's signing key),
 * so social login and wallet deep links work exactly as on the website.
 *
 * Google's android-browser-helper [LauncherActivity] does the Custom Tabs handshake, splash screen and fallback.
 * This subclass only chooses the URL: a tapped link or home-screen shortcut if it is on our site,
 * the home page otherwise.
 */
class BushidoLauncherActivity : LauncherActivity() {
    override fun getLaunchingUrl(): Uri =
        Uri.parse(LaunchUrl.resolve(intent?.dataString, BuildConfig.SITE_HOST))
}
