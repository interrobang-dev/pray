package dev.interrobang.pray

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PullRefreshTest {
    @Test
    fun blockedWhenWebHidden() {
        assertTrue(PullRefresh.isBlocked(isWebVisible = false, isDispatchingDown = true, pageBlocks = false, webCanScrollUp = false))
        assertTrue(PullRefresh.isBlocked(isWebVisible = false, isDispatchingDown = false, pageBlocks = false, webCanScrollUp = false))
    }

    @Test
    fun downIsNeverBlockedSoStartIsRecorded() {
        assertFalse(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = true, pageBlocks = null, webCanScrollUp = false))
        assertFalse(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = true, pageBlocks = true, webCanScrollUp = true))
    }

    @Test
    fun moveWaitsForPageAnswer() {
        assertTrue(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = false, pageBlocks = null, webCanScrollUp = false))
    }

    @Test
    fun moveFollowsPageAnswer() {
        assertFalse(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = false, pageBlocks = false, webCanScrollUp = false))
        assertTrue(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = false, pageBlocks = true, webCanScrollUp = false))
    }

    @Test
    fun documentScrollAlsoBlocks() {
        assertTrue(PullRefresh.isBlocked(isWebVisible = true, isDispatchingDown = false, pageBlocks = false, webCanScrollUp = true))
    }

    @Test
    fun scriptUsesBridgeName() {
        assertTrue(PullRefresh.SCRIPT.contains("window.${PullRefresh.BRIDGE_NAME}.report("))
        assertFalse(PullRefresh.SCRIPT.contains("\$BRIDGE_NAME"))
    }
}
