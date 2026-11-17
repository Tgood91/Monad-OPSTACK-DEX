package io.github.tgood91.bushidodapp

import java.net.URI

/**
 * Decides which page the app opens. Plain Kotlin on java.net.URI (no Android classes), so it is
 * unit-tested on the JVM without an emulator.
 *
 * Rules:
 * - Only pages on our own site are opened. Anything else (another host, http://, a custom scheme,
 *   a user-info trick like https://evil@our-host) falls back to the home page, so a crafted intent
 *   cannot make the app show a foreign site full-screen under the Bushido name.
 * - Every launch carries `source=pwa`, which the site uses to open the right tab for the
 *   Swap / Bridge shortcuts and to tell installed traffic from the plain website.
 */
object LaunchUrl {
    private const val SOURCE = "source=pwa"

    fun home(host: String): String = "https://$host/?$SOURCE"

    /** [requested] if it is on [host] (with `source=pwa` added when missing), otherwise the home page. */
    fun resolve(requested: String?, host: String): String {
        val uri = requested?.let { runCatching { URI(it) }.getOrNull() } ?: return home(host)
        if (!isOurs(uri, host)) return home(host)
        if (hasSource(uri)) return requested

        val fragment = uri.rawFragment?.let { "#$it" } ?: ""
        val path = uri.rawPath.ifEmpty { "/" }
        val query = uri.rawQuery
        val joined = if (query.isNullOrEmpty()) SOURCE else "$query&$SOURCE"
        return "https://${uri.rawAuthority}$path?$joined$fragment"
    }

    fun isOurs(uri: URI, host: String): Boolean =
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(host, ignoreCase = true) &&
            uri.rawUserInfo == null

    private fun hasSource(uri: URI): Boolean =
        uri.rawQuery?.split('&')?.any { it == SOURCE } == true
}
