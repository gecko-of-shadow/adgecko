package adgecko.shield.ui

import adgecko.shield.core.DnsMessage
import adgecko.shield.core.DnsPolicy
import adgecko.shield.vpn.ShieldState
import android.net.DnsResolver
import android.os.CancellationSignal
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Self-test (docs/android/PLAN.md section 6.6). It asks the system resolver
 * of the app's default network, which is the Shield VPN when the shield is
 * on (the own package is not excluded in M1):
 *  1. self-test.adgecko.test, type A: expected NOERROR, no answer, one SOA
 *     with MNAME blocked.adgecko.invalid -> "blocked".
 *  2. example.com, type A: expected one or more addresses -> "resolved".
 * UNVERIFIED on a phone. Runs on a background thread.
 */
object SelfTest {
    data class Answer(val rcode: Int, val bytes: ByteArray?, val error: String?)

    fun query(name: String, type: Int): Answer {
        val done = CountDownLatch(1)
        var result = Answer(-1, null, "timeout")
        val exec = Executors.newSingleThreadExecutor()
        val cancel = CancellationSignal()
        try {
            DnsResolver.getInstance().rawQuery(
                null, name, DnsResolver.CLASS_IN, type,
                DnsResolver.FLAG_NO_CACHE_LOOKUP,
                exec, cancel,
                object : DnsResolver.Callback<ByteArray> {
                    override fun onAnswer(answer: ByteArray, rcode: Int) {
                        result = Answer(rcode, answer, null)
                        done.countDown()
                    }

                    override fun onError(error: DnsResolver.DnsException) {
                        result = Answer(-1, null, "error ${error.code}")
                        done.countDown()
                    }
                },
            )
            if (!done.await(6, TimeUnit.SECONDS)) cancel.cancel()
        } finally {
            exec.shutdown()
        }
        return result
    }

    /** One line for each step. */
    fun run(): String {
        val on = ShieldState.status == ShieldState.Status.ON || ShieldState.status == ShieldState.Status.PAUSED
        if (!on) return "Shield is off. Turn it on, then run the Self-test again."
        val out = StringBuilder()
        val a = query(DnsPolicy.SELF_TEST_HOST, DnsResolver.TYPE_A)
        val r = a.bytes?.let { DnsMessage.parseResponse(it) }
        val blocked = r != null && r.rcode == 0 && r.ancount == 0 && r.soaMname == DnsMessage.MNAME
        out.append("1. ${DnsPolicy.SELF_TEST_HOST}: ")
        out.append(
            when {
                blocked -> "blocked"
                a.error != null -> "no answer (${a.error})"
                else -> "not blocked (rcode ${r?.rcode}, answers ${r?.ancount}, SOA ${r?.soaMname})"
            },
        )
        out.append('\n')
        val b = query("example.com", DnsResolver.TYPE_A)
        val rb = b.bytes?.let { DnsMessage.parseResponse(it) }
        val resolved = rb != null && rb.rcode == 0 && rb.answerTypes.contains(DnsMessage.TYPE_A)
        out.append("2. example.com: ")
        out.append(if (resolved) "resolved" else "not resolved (${b.error ?: "rcode " + rb?.rcode})")
        out.append('\n')
        if (!blocked) out.append("The query did not reach the Shield (Private DNS or another path).\n")
        // The Self-test name works also before the lists load, so say if they are active.
        val d = ShieldState.data
        out.append(
            when {
                d != null -> "3. Lists: active (${"%,d".format(d.listCount)} list hosts, ${"%,d".format(d.threatCount)} threat names).\n"
                ShieldState.dataError != null -> "3. Lists: NOT active (${ShieldState.dataError}). Only the Self-test name is blocked.\n"
                else -> "3. Lists: still loading. Run the Self-test again in a few seconds.\n"
            },
        )
        return out.toString()
    }
}
