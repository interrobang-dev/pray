package dev.interrobang.pray

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MachinesTest {
    private val office = Machine("2-office", "http://2-office.tailda52be.ts.net:4710")
    private val home = Machine("1-home", "http://1-home.tailda52be.ts.net:4710")

    @Test
    fun normalizeAddressAddsSchemeAndPort() {
        assertEquals("http://2-office:4710", Machines.normalizeAddress("2-office"))
        assertEquals("http://2-office:4710", Machines.normalizeAddress("  http://2-Office:4710/  "))
        assertEquals("http://100.64.1.2:4710", Machines.normalizeAddress("100.64.1.2"))
        assertEquals("http://2-office:8080", Machines.normalizeAddress("2-office:8080/api"))
        assertEquals("https://pc.example:4710", Machines.normalizeAddress("https://pc.example"))
    }

    @Test
    fun normalizeAddressRejectsBadInput() {
        assertNull(Machines.normalizeAddress(""))
        assertNull(Machines.normalizeAddress("   "))
        assertNull(Machines.normalizeAddress("ftp://2-office"))
        assertNull(Machines.normalizeAddress("http://two words"))
        assertNull(Machines.normalizeAddress("http://2-office:99999"))
    }

    @Test
    fun nameOfTakesFirstLabelButKeepsIp() {
        assertEquals("2-office", Machines.nameOf("http://2-office.tailda52be.ts.net:4710"))
        assertEquals("2-office", Machines.nameOf("http://2-office:4710"))
        assertEquals("100.64.1.2", Machines.nameOf("http://100.64.1.2:4710"))
    }

    @Test
    fun parsePayloadReadsMachinesFromServerShape() {
        val json = """{"tailscale":"ready","machines":[
            {"name":"2-office","hostName":"DESKTOP-R7FM8CI","url":"http://2-office.tailda52be.ts.net:4710","isSelf":true,"isOnline":true,"hasPray":true},
            {"name":"1-home","hostName":"DESKTOP-U8JGUV7","url":"http://1-home.tailda52be.ts.net:4710","isSelf":false,"isOnline":true,"hasPray":true},
            {"name":"3-mobile","hostName":"S26","url":null,"isSelf":false,"isOnline":true,"hasPray":false}]}"""
        val listed = Machines.parsePayload(json)!!
        assertEquals(3, listed.size)
        assertEquals(ListedMachine("2-office", "http://2-office.tailda52be.ts.net:4710", isSelf = true, hasPray = true), listed[0])
        assertNull(listed[2].url)
    }

    @Test
    fun parsePayloadRejectsNonPray() {
        assertNull(Machines.parsePayload("<html>"))
        assertNull(Machines.parsePayload("""{"message":"Not found"}"""))
        assertEquals(emptyList<ListedMachine>(), Machines.parsePayload("""{"tailscale":"stopped","machines":[]}"""))
    }

    @Test
    fun mergeKeepsPrayPcsAndKnownOnesSortedByName() {
        val listed = listOf(
            ListedMachine("2-office", office.url, isSelf = true, hasPray = true),
            ListedMachine("1-home", home.url, isSelf = false, hasPray = false),
            ListedMachine("3-mobile", "http://3-mobile.tailda52be.ts.net:4710", isSelf = false, hasPray = false),
            ListedMachine("4-laptop", null, isSelf = false, hasPray = true),
        )
        // 1-home 은 지금 Pray 를 못 찾았지만 전에 알던 PC 라 남긴다. 3-mobile 은 처음부터 Pray 없음, 4-laptop 은 주소 없음
        assertEquals(listOf(home, office), Machines.merge(listOf(home), listed))
        assertEquals(listOf(office), Machines.merge(emptyList(), listed))
    }

    @Test
    fun mergeKeepsPreviousWhenListIsEmpty() {
        assertEquals(listOf(office), Machines.merge(listOf(office), emptyList()))
    }

    @Test
    fun mergeReplacesEnteredShortAddressWithFullUrl() {
        val entered = Machine("2-office", "http://2-office:4710")
        val listed = listOf(ListedMachine("2-office", office.url, isSelf = true, hasPray = true))
        assertEquals(listOf(office), Machines.merge(listOf(entered), listed))
    }

    @Test
    fun machineForMatchesFullAndShortNames() {
        val machines = listOf(office, home)
        assertEquals(office, Machines.machineFor("http://2-office.tailda52be.ts.net:4710/#session=abc", machines))
        assertEquals(office, Machines.machineFor("http://2-office:4710/", machines))
        assertEquals(home, Machines.machineFor("http://1-HOME.tailda52be.ts.net:4710", machines))
        assertNull(Machines.machineFor("http://2-office.tailda52be.ts.net:4711/", machines))
        assertNull(Machines.machineFor("http://2-office-old:4710/", machines))
        assertNull(Machines.machineFor("https://claude.ai/artifact/x", machines))
        val short = listOf(Machine("2-office", "http://2-office:4710"))
        assertEquals(short[0], Machines.machineFor("http://2-office.tailda52be.ts.net:4710/", short))
    }

    @Test
    fun machineForDoesNotMatchIpPrefixes() {
        val byIp = listOf(Machine("100.64.1.2", "http://100.64.1.2:4710"))
        assertEquals(byIp[0], Machines.machineFor("http://100.64.1.2:4710/", byIp))
        assertNull(Machines.machineFor("http://100.64.1.3:4710/", byIp))
        assertNull(Machines.machineFor("http://100:4710/", byIp))
    }

    @Test
    fun linkTargetKeepsPrayPcsInApp() {
        val machines = listOf(office, home)
        assertEquals(LinkTarget.IN_APP, Machines.linkTarget("http://1-home.tailda52be.ts.net:4710/", machines))
        assertEquals(LinkTarget.EXTERNAL, Machines.linkTarget("https://claude.ai/code/artifact/abc", machines))
        assertEquals(LinkTarget.EXTERNAL, Machines.linkTarget("http://5-unknown:4710/", machines))
        assertEquals(LinkTarget.EXTERNAL, Machines.linkTarget("mailto:a@b.c", machines))
        assertEquals(LinkTarget.EXTERNAL, Machines.linkTarget("intent://x#Intent;end", machines))
        assertEquals(LinkTarget.IN_APP, Machines.linkTarget("blob:http://2-office:4710/uuid", machines))
        assertEquals(LinkTarget.IN_APP, Machines.linkTarget("about:blank", machines))
    }

    @Test
    fun jsonRoundTrip() {
        val machines = listOf(home, office)
        assertEquals(machines, Machines.fromJson(Machines.toJson(machines)))
        assertEquals(emptyList<Machine>(), Machines.fromJson(null))
        assertEquals(emptyList<Machine>(), Machines.fromJson("not json"))
    }
}
