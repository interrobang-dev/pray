package dev.interrobang.pray

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LandingTest {
    private val office = Machine("2-office", "http://2-office.tailda52be.ts.net:4710", "DESKTOP-R7FM8CI")

    @Test
    fun prayAnswerNeedsAppPray() {
        assertTrue(Landing.isPrayAnswer("""{"isAuthenticated":true,"isLocal":true,"email":null,"canLogin":true,"app":"pray"}"""))
        assertFalse(Landing.isPrayAnswer("""{"isAuthenticated":true}"""))
        assertFalse(Landing.isPrayAnswer("""{"app":"other"}"""))
        assertFalse(Landing.isPrayAnswer("<!doctype html><html></html>"))
        assertFalse(Landing.isPrayAnswer(""))
    }

    @Test
    fun bannerOffWhenNoVpn() {
        assertEquals(TailscaleBanner.OFF, Landing.banner(false, emptyList()))
        assertEquals(TailscaleBanner.OFF, Landing.banner(false, listOf(ProbeState.ANSWERS)))
    }

    @Test
    fun bannerNoPcAnswersOnlyWhenAllChecked() {
        assertEquals(TailscaleBanner.NO_PC_ANSWERS, Landing.banner(true, listOf(ProbeState.NO_ANSWER, ProbeState.NO_ANSWER)))
        assertEquals(TailscaleBanner.CONNECTED, Landing.banner(true, listOf(ProbeState.NO_ANSWER, ProbeState.CHECKING)))
        assertEquals(TailscaleBanner.CONNECTED, Landing.banner(true, listOf(ProbeState.NO_ANSWER, ProbeState.ANSWERS)))
        // PC 가 없으면 VPN 만 본다
        assertEquals(TailscaleBanner.CONNECTED, Landing.banner(true, emptyList()))
    }

    @Test
    fun bannerButton() {
        assertTrue(TailscaleBanner.OFF.hasButton)
        assertTrue(TailscaleBanner.NO_PC_ANSWERS.hasButton)
        assertFalse(TailscaleBanner.CONNECTED.hasButton)
        assertEquals("Open Tailscale", Landing.tailscaleButtonLabel(true))
        assertEquals("Get Tailscale", Landing.tailscaleButtonLabel(false))
    }

    @Test
    fun sortedByNameIgnoringCase() {
        val list = listOf(Machine("b-pc", "http://b:4710"), Machine("A-pc", "http://a:4710"), Machine("1-home", "http://h:4710"))
        assertEquals(listOf("1-home", "A-pc", "b-pc"), Landing.sorted(list).map { it.name })
    }

    @Test
    fun subtitleIsHostNameOrAddress() {
        assertEquals("DESKTOP-R7FM8CI", Landing.subtitle(office))
        assertEquals("2-office:4710", Landing.subtitle(Machine("2-office", "http://2-office:4710")))
        assertEquals("2-office:4710", Landing.subtitle(Machine("2-office", "http://2-office:4710", "2-OFFICE")))
        assertEquals("2-office:4710", Landing.subtitle(Machine("2-office", "http://2-office:4710", " ")))
    }

    @Test
    fun statusLine() {
        assertEquals("●", Landing.dot(ProbeState.ANSWERS))
        assertEquals("○", Landing.dot(ProbeState.NO_ANSWER))
        assertEquals("○", Landing.dot(ProbeState.CHECKING))
        assertEquals("Pray answers · Notifications connected", Landing.statusLine(ProbeState.ANSWERS, StreamState.CONNECTED))
        assertEquals("Checking… · Notifications not connected", Landing.statusLine(ProbeState.CHECKING, null))
        assertEquals("No answer · Notifications not connected", Landing.statusLine(ProbeState.NO_ANSWER, StreamState.DISCONNECTED))
        assertEquals("Notifications: update Pray", Landing.streamLabel(StreamState.OUTDATED))
        assertEquals("Notifications: sign in", Landing.streamLabel(StreamState.UNAUTHORIZED))
    }

    @Test
    fun backGoesToLandingBeforeClosing() {
        assertEquals(BackAction.CLOSE, Landing.back(Screen.LANDING, isErrorShown = false, canGoBack = true))
        assertEquals(BackAction.TO_LANDING, Landing.back(Screen.SETUP, isErrorShown = false, canGoBack = true))
        assertEquals(BackAction.WEB_BACK, Landing.back(Screen.WEB, isErrorShown = false, canGoBack = true))
        assertEquals(BackAction.TO_LANDING, Landing.back(Screen.WEB, isErrorShown = false, canGoBack = false))
        assertEquals(BackAction.TO_LANDING, Landing.back(Screen.WEB, isErrorShown = true, canGoBack = true))
    }
}
