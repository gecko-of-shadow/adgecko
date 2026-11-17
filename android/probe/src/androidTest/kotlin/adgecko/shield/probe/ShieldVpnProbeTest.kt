package adgecko.shield.probe

import adgecko.shield.core.DnsMessage
import android.content.Context
import android.net.ConnectivityManager
import android.net.DnsResolver
import android.net.Network
import android.net.NetworkCapabilities
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.FileInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * VPN end-to-end test on the CI emulator (docs/android/PLAN.md section 6.8,
 * E3). It runs in the probe app, which is another app than the Shield, so
 * its DNS goes through the Shield VPN.
 *
 * 1. VPN consent: appops set adgecko.shield ACTIVATE_VPN allow (fallback:
 *    UI Automator presses OK in the consent dialog).
 * 2. Start through DebugStartActivity, wait for a network with TRANSPORT_VPN.
 * 3. DnsResolver.rawQuery for self-test.adgecko.test (A, AAAA, HTTPS): NODATA
 *    with the SOA MNAME blocked.adgecko.invalid. Fallback when the resolver
 *    does not send the name to the VPN DNS: a raw UDP query to the alias.
 * 4. example.org resolves. 5. A TCP connect to the alias on port 853 fails
 *    fast. 6. Logcat has "decision=block layer=SELF_TEST".
 */
@RunWith(AndroidJUnit4::class)
class ShieldVpnProbeTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val context: Context = inst.targetContext
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    private fun shell(cmd: String): String {
        val pfd: ParcelFileDescriptor = inst.uiAutomation.executeShellCommand(cmd)
        return FileInputStream(pfd.fileDescriptor).use { String(it.readBytes()) }.also { pfd.close() }
    }

    private fun log(msg: String) = Log.i(TAG, msg)

    private fun vpnNetwork(): Network? {
        @Suppress("DEPRECATION")
        return cm.allNetworks.firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }

    private fun startShield(): Network {
        log("appops: " + shell("appops set $SHIELD ACTIVATE_VPN allow").trim())
        log("am start: " + shell("am start -W -n $SHIELD/.debug.DebugStartActivity").trim())
        var vpn = waitVpn(15_000)
        if (vpn == null) {
            // Fallback: DebugStartActivity (exported, debug only) opens the
            // VPN dialog when the consent is missing; UI Automator presses OK.
            log("no VPN after appops; trying the consent dialog")
            log("am start: " + shell("am start -W -n $SHIELD/.debug.DebugStartActivity").trim())
            val device = UiDevice.getInstance(inst)
            val ok = device.wait(Until.findObject(By.res("android:id/button1")), 10_000)
            ok?.click()
            vpn = waitVpn(15_000)
        }
        assertNotNull("no network with TRANSPORT_VPN", vpn)
        // Facts that explain a failure (resolver research of 2026-11-17): a
        // Strict-mode Private DNS hostname has no cleartext fallback, and a
        // process-bound network changes the path of rawQuery(null, ...).
        log("private_dns_mode=" + shell("settings get global private_dns_mode").trim() +
            " private_dns_specifier=" + shell("settings get global private_dns_specifier").trim())
        log("active network=${cm.activeNetwork} vpn=$vpn bound=${cm.boundNetworkForProcess} " +
            "vpn dns=${cm.getLinkProperties(vpn!!)?.dnsServers} privateDnsActive=${cm.getLinkProperties(vpn)?.isPrivateDnsActive}")
        return vpn
    }

    private fun waitVpn(ms: Long): Network? {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            vpnNetwork()?.let { n ->
                if (cm.getLinkProperties(n)?.dnsServers?.isNotEmpty() == true) return n
            }
            Thread.sleep(250)
        }
        return null
    }

    private class Raw(val bytes: ByteArray?, val rcode: Int, val error: String?, val ms: Long)

    private fun rawQuery(network: Network?, name: String, type: Int): Raw {
        val done = CountDownLatch(1)
        var out = Raw(null, -1, "timeout", 0)
        val exec = Executors.newSingleThreadExecutor()
        val t0 = System.nanoTime()
        DnsResolver.getInstance().rawQuery(
            network, name, DnsResolver.CLASS_IN, type, DnsResolver.FLAG_NO_CACHE_LOOKUP, exec, CancellationSignal(),
            object : DnsResolver.Callback<ByteArray> {
                override fun onAnswer(answer: ByteArray, rcode: Int) {
                    out = Raw(answer, rcode, null, (System.nanoTime() - t0) / 1_000_000)
                    done.countDown()
                }

                override fun onError(error: DnsResolver.DnsException) {
                    out = Raw(null, -1, "error ${error.code}", (System.nanoTime() - t0) / 1_000_000)
                    done.countDown()
                }
            },
        )
        done.await(8, TimeUnit.SECONDS)
        exec.shutdown()
        return out
    }

    /** Raw UDP query to the first VPN DNS alias, bound to the VPN network. */
    private fun udpToAlias(vpn: Network, name: String, type: Int): ByteArray? {
        val alias = cm.getLinkProperties(vpn)!!.dnsServers.first()
        DatagramSocket().use { s ->
            vpn.bindSocket(s)
            s.soTimeout = 3000
            val q = DnsMessage.query(0x5151, name, type)
            s.send(DatagramPacket(q, q.size, InetSocketAddress(alias, 53)))
            val buf = ByteArray(2048)
            val p = DatagramPacket(buf, buf.size)
            return try {
                s.receive(p)
                buf.copyOf(p.length)
            } catch (e: Exception) {
                null
            }
        }
    }

    @Test
    fun theShieldBlocksTheSelfTestNameForAnotherApp() {
        val vpn = startShield()
        val lp = cm.getLinkProperties(vpn)!!
        log("vpn dns servers: ${lp.dnsServers}")
        for (type in listOf(DnsMessage.TYPE_A, DnsMessage.TYPE_AAAA, DnsMessage.TYPE_HTTPS)) {
            val r = rawQuery(null, SELF_TEST, type)
            val parsed = r.bytes?.let { DnsMessage.parseResponse(it) }
            log("rawQuery $SELF_TEST type $type: rcode=${parsed?.rcode} an=${parsed?.ancount} soa=${parsed?.soaMname} ${r.ms} ms err=${r.error}")
            if (parsed != null && parsed.soaMname == DnsMessage.MNAME) {
                assertEquals(0, parsed.rcode)
                assertEquals(0, parsed.ancount)
                assertTrue("answer took ${r.ms} ms", r.ms < 200)
            } else {
                // Fallback (plan E3): the resolver did not send the name to the VPN DNS.
                val raw = udpToAlias(vpn, SELF_TEST, type)
                val p = raw?.let { DnsMessage.parseResponse(it) }
                log("fallback udp to alias type $type: rcode=${p?.rcode} an=${p?.ancount} soa=${p?.soaMname}")
                assertNotNull("no answer from the alias", p)
                assertEquals(0, p!!.rcode)
                assertEquals(0, p.ancount)
                assertEquals(DnsMessage.MNAME, p.soaMname)
            }
        }
    }

    @Test
    fun aNormalNameResolvesAndTcpToTheAliasFailsFast() {
        val vpn = startShield()
        val r = rawQuery(null, "example.org", DnsMessage.TYPE_A)
        val p = r.bytes?.let { DnsMessage.parseResponse(it) }
        log("rawQuery example.org: rcode=${p?.rcode} answers=${p?.answerTypes} ${r.ms} ms err=${r.error}")
        assertNotNull("no answer for example.org (${r.error})", p)
        assertTrue("example.org has no A record: ${p!!.answerTypes}", p.answerTypes.contains(DnsMessage.TYPE_A))

        val alias = cm.getLinkProperties(vpn)!!.dnsServers.first()
        val t0 = System.nanoTime()
        try {
            Socket().use { s ->
                vpn.bindSocket(s)
                s.connect(InetSocketAddress(alias, 853), 1000)
            }
            fail("TCP connect to the alias on port 853 succeeded")
        } catch (e: java.io.IOException) {
            val ms = (System.nanoTime() - t0) / 1_000_000
            log("tcp 853 to alias failed after $ms ms: ${e.javaClass.simpleName}")
            assertTrue("TCP fail took $ms ms", ms < 1000)
        }
    }

    /**
     * The real data path on a device: after the bundled data loads (about 1 s
     * after a process start on the CI emulator), a list host gets the NODATA
     * answer of the Shield. imasdk.googleapis.com is a list host and not a
     * never-block host (test/android-data.test.js pins this).
     */
    @Test
    fun aListHostIsBlockedAfterTheDataLoads() {
        startShield()
        val end = System.currentTimeMillis() + 20_000
        var last = "none"
        while (System.currentTimeMillis() < end) {
            val r = rawQuery(null, LIST_HOST, DnsMessage.TYPE_A)
            val p = r.bytes?.let { DnsMessage.parseResponse(it) }
            last = "rcode=${p?.rcode} an=${p?.ancount} soa=${p?.soaMname} err=${r.error}"
            if (p != null && p.soaMname == DnsMessage.MNAME) {
                log("list host $LIST_HOST blocked: $last ${r.ms} ms")
                assertEquals(0, p.rcode)
                assertEquals(0, p.ancount)
                return
            }
            Thread.sleep(500)
        }
        fail("list host $LIST_HOST was not blocked within 20 s: $last")
    }

    @Test
    fun logcatHasTheSelfTestBlockLine() {
        // Clear here, so that only a line from this test can pass the check.
        // emulator-run.sh streams the full log to a file, so nothing is lost.
        shell("logcat -c")
        val vpn = startShield()
        rawQuery(null, SELF_TEST, DnsMessage.TYPE_A)
        udpToAlias(vpn, SELF_TEST, DnsMessage.TYPE_A)
        Thread.sleep(500)
        val logs = shell("logcat -d -s AdgeckoShield:V")
        assertTrue("no block line in logcat:\n${logs.takeLast(2000)}", logs.contains("decision=block layer=SELF_TEST"))
    }

    companion object {
        const val TAG = "AdgeckoShieldProbe"
        const val SHIELD = "adgecko.shield"
        const val SELF_TEST = "self-test.adgecko.test"
        const val LIST_HOST = "imasdk.googleapis.com"
    }
}
