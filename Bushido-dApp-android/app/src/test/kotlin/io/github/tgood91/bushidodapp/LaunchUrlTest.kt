package io.github.tgood91.bushidodapp

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchUrlTest {
    private val host = "bushido-dapp.onrender.com"
    private val home = "https://$host/?source=pwa"

    @Test
    fun `isOurs accepts only https on our host`() {
        assertTrue(LaunchUrl.isOurs(URI("https://$host/"), host))
        assertTrue(LaunchUrl.isOurs(URI("HTTPS://${host.uppercase()}/x"), host))
        assertFalse(LaunchUrl.isOurs(URI("http://$host/"), host))
        assertFalse(LaunchUrl.isOurs(URI("https://evil.example/"), host))
        assertFalse(LaunchUrl.isOurs(URI("https://$host.evil.example/"), host))
        assertFalse(LaunchUrl.isOurs(URI("https://evil.example@$host/"), host))
        assertFalse(LaunchUrl.isOurs(URI("bushido://swap"), host))
    }

    @Test
    fun `no link, a broken link or a foreign link opens the home page`() {
        assertEquals(home, LaunchUrl.resolve(null, host))
        assertEquals(home, LaunchUrl.resolve("", host))
        assertEquals(home, LaunchUrl.resolve("not a url ://", host))
        assertEquals(home, LaunchUrl.resolve("https://evil.example/?source=pwa", host))
        assertEquals(home, LaunchUrl.resolve("http://$host/", host))
    }

    @Test
    fun `a link on our site keeps path, query and fragment and gets source=pwa`() {
        assertEquals("https://$host/?source=pwa#bridge", LaunchUrl.resolve("https://$host/#bridge", host))
        assertEquals("https://$host/?source=pwa", LaunchUrl.resolve("https://$host", host))
        assertEquals(
            "https://$host/claim?ref=abc&source=pwa#rewards",
            LaunchUrl.resolve("https://$host/claim?ref=abc#rewards", host),
        )
    }

    @Test
    fun `source=pwa is not added twice`() {
        val once = "https://$host/?source=pwa#swap"
        assertEquals(once, LaunchUrl.resolve(once, host))
        assertEquals("https://$host/?a=1&source=pwa", LaunchUrl.resolve("https://$host/?a=1&source=pwa", host))
    }
}
