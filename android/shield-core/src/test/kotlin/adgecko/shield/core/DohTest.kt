package adgecko.shield.core

import com.sun.net.httpserver.Headers
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** DoH code of the Shield (docs/android/shield.md section 7). The server is on the loopback address. */
class DohTest {
    private val secret = "PRIVATE-PROFILE-ID"
    private val dohUrl = DohUrl.parse("https://dns.example.test/$secret")!!
    private val query = DnsMessage.query(0x1234, "ads.example", DnsMessage.TYPE_A, edns = true)

    // ---- DohUrl

    @Test
    fun validUrlWithPathIsAccepted() {
        val u = DohUrl.parse("  https://dns.example.test/$secret  ")
        assertNotNull(u)
        assertEquals("https://dns.example.test/$secret", u!!.text)
        assertEquals("dns.example.test", u.host)
        assertNotNull(DohUrl.parse("https://dns.example.test:8443/x?a=b"))
        assertNotNull(DohUrl.parse("https://dns.example.test"))
    }

    @Test
    fun uppercaseSchemeIsStoredInLowerCase() {
        val u = DohUrl.parse("HTTPS://DNS.Example.Test/Path")!!
        assertEquals("https://DNS.Example.Test/Path", u.text)
        assertEquals("dns.example.test", u.host)
    }

    @Test
    fun badUrlsAreRejected() {
        assertNull("http", DohUrl.parse("http://dns.example.test/x"))
        assertNull("no scheme", DohUrl.parse("dns.example.test/x"))
        assertNull("empty", DohUrl.parse("   "))
        // Built at run time, so that no e-mail like text is in this file.
        assertNull("user info", DohUrl.parse("https://" + "user" + "@" + "dns.example.test/x"))
        assertNull("user info and password", DohUrl.parse("https://" + "user:pw" + "@" + "dns.example.test/x"))
        assertNull("fragment", DohUrl.parse("https://dns.example.test/x#frag"))
        assertNull("space", DohUrl.parse("https://dns.example.test/a b"))
        assertNull("tab", DohUrl.parse("https://dns.example.test/a\tb"))
        assertNull("control", DohUrl.parse("https://dns.example.test/a\u0001b"))
        assertNull("non-ASCII", DohUrl.parse("https://dns.example.test/é"))
        assertNull("empty host", DohUrl.parse("https:///x"))
        assertNull("empty host with port", DohUrl.parse("https://:443/x"))
        assertNull("port 0", DohUrl.parse("https://dns.example.test:0/x"))
        assertNull("port too large", DohUrl.parse("https://dns.example.test:70000/x"))
        assertNull("port not a number", DohUrl.parse("https://dns.example.test:abc/x"))
    }

    @Test
    fun lengthLimitIs512() {
        val prefix = "https://dns.example.test/"
        assertNotNull(DohUrl.parse(prefix + "a".repeat(512 - prefix.length)))
        assertNull(DohUrl.parse(prefix + "a".repeat(513 - prefix.length)))
    }

    @Test
    fun toStringIsTheHostOnly() {
        val u = DohUrl.parse("https://dns.example.test/$secret")!!
        assertEquals("dns.example.test", u.toString())
        assertFalse("$u".contains(secret))
        assertFalse("DoH $u".contains(secret))
    }

    // ---- DohClient

    private class TestServer(handler: (HttpExchange) -> Unit) {
        val release = CountDownLatch(1)
        private val executor = Executors.newCachedThreadPool()
        private val server: HttpServer = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        val hits = AtomicInteger()
        @Volatile var method: String? = null
        @Volatile var path: String? = null
        @Volatile var headers: Headers = Headers()
        @Volatile var body: ByteArray = ByteArray(0)

        /** The connection that the client opener returned last. */
        @Volatile var lastConnection: HttpURLConnection? = null

        init {
            server.executor = executor
            server.createContext("/") { ex ->
                try {
                    hits.incrementAndGet()
                    method = ex.requestMethod
                    path = ex.requestURI.toString()
                    headers = ex.requestHeaders
                    body = ex.requestBody.readBytes()
                    handler(ex)
                } catch (e: IOException) {
                    // The client closed the connection early.
                } finally {
                    ex.close()
                }
            }
            server.start()
        }

        private val port = server.address.port

        /**
         * The test opener. It maps scheme, host and port of the https URL to the
         * loopback server. It keeps the path and the query (url.file), as the
         * real opener does, so a test can check the request line.
         */
        val opener: (URL) -> HttpURLConnection = { u ->
            (URL("http", server.address.address.hostAddress, port, u.file).openConnection() as HttpURLConnection)
                .also { lastConnection = it }
        }

        val client = DohClient(opener)

        fun stop() {
            release.countDown()
            server.stop(0)
            executor.shutdownNow()
        }
    }

    private fun reply(ex: HttpExchange, code: Int, type: String?, bytes: ByteArray, chunked: Boolean = false) {
        if (type != null) ex.responseHeaders.add("Content-Type", type)
        ex.sendResponseHeaders(code, if (chunked) 0 else if (bytes.isEmpty()) -1 else bytes.size.toLong())
        if (bytes.isNotEmpty()) ex.responseBody.write(bytes)
    }

    /** The request body as a DNS answer: the same bytes with the QR flag, id 0. */
    private fun answerOf(request: ByteArray): ByteArray = request.copyOf().also { it[2] = (it[2].toInt() or 0x80).toByte() }

    private fun <T> withServer(handler: (HttpExchange) -> Unit, block: (TestServer) -> T): T {
        val s = TestServer(handler)
        try {
            return block(s)
        } finally {
            s.stop()
        }
    }

    private fun assertFailed(reason: String, r: DohResult) {
        assertTrue("expected Failed, got $r", r is DohResult.Failed)
        assertEquals(reason, (r as DohResult.Failed).reason)
        assertFalse("reason holds the path", r.reason.contains(secret))
    }

    @Test
    fun postSendsIdZeroAndAnswerGetsTheClientId() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body)) }) { s ->
            server = s
            val r = s.client.exchange(dohUrl, query, 2000)
            assertTrue("$r", r is DohResult.Answer)
            assertEquals("POST", s.method)
            assertEquals("application/dns-message", s.headers.getFirst("Content-Type"))
            assertEquals("application/dns-message", s.headers.getFirst("Accept"))
            assertEquals(query.size, s.body.size)
            assertEquals(0, s.body[0].toInt())
            assertEquals(0, s.body[1].toInt())
            assertArrayEquals(query.copyOfRange(2, query.size), s.body.copyOfRange(2, s.body.size))
            val answer = (r as DohResult.Answer).bytes
            assertEquals(0x12, answer[0].toInt())
            assertEquals(0x34, answer[1].toInt())
            assertArrayEquals(answerOf(query).copyOfRange(2, query.size), answer.copyOfRange(2, answer.size))
            assertEquals("the query array is not changed", 0x12, query[0].toInt())
        }
    }

    @Test
    fun requestGoesToThePathOfTheUrlWithTheFixedUserAgent() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body)) }) { s ->
            server = s
            assertTrue(s.client.exchange(dohUrl, query, 2000) is DohResult.Answer)
            assertEquals("POST", s.method)
            // The path holds the private profile ID. The request must reach it.
            assertEquals("/$secret", s.path)
            assertEquals("adgecko-shield", s.headers.getFirst("User-Agent"))
            assertEquals(1, s.headers["User-Agent"]?.size)
            val c = s.lastConnection!!
            assertFalse("redirects", c.instanceFollowRedirects)
            assertFalse("cache", c.useCaches)
            assertEquals("POST", c.requestMethod)
        }
    }

    @Test
    fun queryOfTheUrlIsKept() {
        withServer({ ex -> reply(ex, 404, null, ByteArray(0)) }) { s ->
            s.client.exchange(DohUrl.parse("https://dns.example.test/$secret?a=b")!!, query, 2000)
            assertEquals("/$secret?a=b", s.path)
        }
    }

    @Test
    fun contentTypeWithParametersIsAccepted() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "Application/DNS-Message; charset=binary", answerOf(server.body)) }) { s ->
            server = s
            assertTrue(s.client.exchange(dohUrl, query, 2000) is DohResult.Answer)
        }
    }

    @Test
    fun httpErrorGivesFailedWithTheCode() {
        withServer({ ex -> reply(ex, 404, "text/plain", "no".toByteArray()) }) { s ->
            assertFailed("HTTP 404", s.client.exchange(dohUrl, query, 2000))
        }
        withServer({ ex ->
            ex.responseHeaders.add("Location", "https://other.example.test/x")
            reply(ex, 302, null, ByteArray(0))
        }) { s ->
            assertFailed("HTTP 302", s.client.exchange(dohUrl, query, 2000))
        }
    }

    @Test
    fun wrongContentTypeGivesFailed() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "text/html", answerOf(server.body)) }) { s ->
            server = s
            assertFailed("content type", s.client.exchange(dohUrl, query, 2000))
        }
        withServer({ ex -> reply(ex, 200, null, answerOf(server.body)) }) { s ->
            server = s
            assertFailed("content type", s.client.exchange(dohUrl, query, 2000))
        }
    }

    @Test
    fun answerIdThatIsNotZeroGivesFailed() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body).also { it[1] = 7 }) }) { s ->
            server = s
            assertFailed("bad id", s.client.exchange(dohUrl, query, 2000))
        }
    }

    @Test
    fun bodyLimitIs65535Bytes() {
        fun big(size: Int) = ByteArray(size).also { it[2] = 0x80.toByte() }
        withServer({ ex -> reply(ex, 200, "application/dns-message", big(65536)) }) { s ->
            assertFailed("too large", s.client.exchange(dohUrl, query, 2000))
        }
        // A chunked body has no length header: the byte limit stops the read.
        withServer({ ex -> reply(ex, 200, "application/dns-message", big(70000), chunked = true) }) { s ->
            assertFailed("too large", s.client.exchange(dohUrl, query, 2000))
        }
        withServer({ ex -> reply(ex, 200, "application/dns-message", big(65535), chunked = true) }) { s ->
            val r = s.client.exchange(dohUrl, query, 2000)
            assertTrue("$r", r is DohResult.Answer)
            assertEquals(65535, (r as DohResult.Answer).bytes.size)
        }
    }

    @Test
    fun shortBodyGivesFailed() {
        withServer({ ex -> reply(ex, 200, "application/dns-message", ByteArray(5)) }) { s ->
            assertFailed("too short", s.client.exchange(dohUrl, query, 2000))
        }
    }

    // ---- The total time limit

    /** A server that accepts and never sends a byte. */
    private fun silentServer(block: (port: Int) -> Unit) {
        val ss = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        val held = ArrayList<Socket>()
        val t = Thread {
            try {
                while (true) {
                    val c = ss.accept()
                    synchronized(held) { held += c }
                }
            } catch (e: IOException) {
                // The server socket is closed.
            }
        }
        t.isDaemon = true
        t.start()
        try {
            block(ss.localPort)
        } finally {
            ss.close()
            synchronized(held) { held.forEach { runCatching { it.close() } } }
        }
    }

    private fun assertTimeoutWithin(limitMs: Int, run: () -> DohResult) {
        val t0 = System.nanoTime()
        val r = run()
        val ms = (System.nanoTime() - t0) / 1_000_000
        assertFailed("timeout", r)
        assertTrue("took $ms ms for a limit of $limitMs ms", ms < limitMs + 700)
    }

    @Test
    fun serverThatNeverSendsHeadersGivesTimeoutInTime() {
        silentServer { port ->
            val client = DohClient({ u -> URL("http", "127.0.0.1", port, u.file).openConnection() as HttpURLConnection })
            assertTimeoutWithin(300) { client.exchange(dohUrl, query, 300) }
        }
    }

    @Test
    fun serverThatSendsHeadersAndStallsTheBodyGivesTimeoutInTime() {
        withServer({ ex ->
            ex.responseHeaders.add("Content-Type", "application/dns-message")
            ex.sendResponseHeaders(200, 100)
            ex.responseBody.write(ByteArray(20))
            ex.responseBody.flush()
            // 80 bytes are missing. The server waits.
            Thread.sleep(10_000)
        }) { s ->
            assertTimeoutWithin(300) { s.client.exchange(dohUrl, query, 300) }
        }
    }

    @Test
    fun serverThatDripsTheBodyIsStoppedByTheTotalLimit() {
        // One byte every 100 ms: no single read waits for the read timeout (300 ms).
        // Only the total limit stops this server. Without it the exchange takes 10 s.
        withServer({ ex ->
            ex.responseHeaders.add("Content-Type", "application/dns-message")
            ex.sendResponseHeaders(200, 100)
            repeat(100) {
                ex.responseBody.write(1)
                ex.responseBody.flush()
                Thread.sleep(100)
            }
        }) { s ->
            assertTimeoutWithin(300) { s.client.exchange(dohUrl, query, 300) }
        }
    }

    @Test
    fun hostLookupThatOutlastsTheLimitGivesTimeoutWhateverTheOutcome() {
        // The host lookup cannot be interrupted (known limit): the exchange ends
        // when it returns, but the reason is timeout, also when the lookup fails.
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body)) }) { s ->
            server = s
            val slow = DohClient({ u ->
                Thread.sleep(400)
                s.opener(u)
            })
            assertFailed("timeout", slow.exchange(dohUrl, query, 100))
            assertEquals("no request after the limit", 0, s.hits.get())
        }
        val slowFail = DohClient({
            Thread.sleep(300)
            throw IOException("failed for $secret")
        })
        assertFailed("timeout", slowFail.exchange(dohUrl, query, 100))
    }

    @Test
    fun limitThatEndsDuringConnectGivesTimeoutAndSendsNoBody() {
        // On Android, disconnect() does nothing before connect() made the engine,
        // so the client checks the state after connect() itself.
        val outputUsed = AtomicInteger()
        val fake = object : HttpURLConnection(URL("https://dns.example.test/x")) {
            override fun connect() {
                Thread.sleep(400)
            }

            override fun disconnect() {}
            override fun usingProxy() = false
            override fun getOutputStream(): java.io.OutputStream {
                outputUsed.incrementAndGet()
                return java.io.ByteArrayOutputStream()
            }
        }
        assertFailed("timeout", DohClient({ fake }).exchange(dohUrl, query, 100))
        assertEquals("no body after the limit", 0, outputUsed.get())
    }

    @Test
    fun watchdogThreadIsSharedAndLeavesTheQueueOnSuccess() {
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body)) }) { s ->
            server = s
            assertTrue(s.client.exchange(dohUrl, query, 2000) is DohResult.Answer)
            assertTrue(DohClient(s.opener).exchange(dohUrl, query, 2000) is DohResult.Answer)
            val threads = Thread.getAllStackTraces().keys.filter { it.name == "shield-doh-watchdog" }
            assertEquals(1, threads.size)
            assertTrue(threads[0].isDaemon)
            val own = ScheduledThreadPoolExecutor(1).also { it.removeOnCancelPolicy = true }
            try {
                assertTrue(DohClient(s.opener, own).exchange(dohUrl, query, 60_000) is DohResult.Answer)
                assertTrue("the watchdog task stays in the queue", own.queue.isEmpty())
            } finally {
                own.shutdownNow()
            }
        }
    }

    @Test
    fun connectionErrorGivesAnExceptionClassNameOnly() {
        val client = DohClient({ throw IOException("failed for $secret") })
        assertFailed("IOException", client.exchange(dohUrl, query, 100))
        val client2 = DohClient({ throw IllegalStateException("failed for $secret") })
        assertFailed("IllegalStateException", client2.exchange(dohUrl, query, 100))
    }

    @Test
    fun refusedConnectionGivesFailed() {
        val s = TestServer { }
        val client = DohClient(s.opener)
        s.stop()
        val r = client.exchange(dohUrl, query, 500)
        assertTrue("$r", r is DohResult.Failed)
        assertFalse((r as DohResult.Failed).reason.contains(secret))
    }

    @Test
    fun queryShorterThanAHeaderGivesFailed() {
        val client = DohClient({ throw AssertionError("must not connect") })
        assertTrue(client.exchange(dohUrl, ByteArray(5), 100) is DohResult.Failed)
    }

    // ---- DohBreaker

    private fun breaker() = DohBreaker(3, 30_000)

    @Test
    fun breakerStartsClosed() {
        val b = breaker()
        assertTrue(b.tryAcquire(0))
        assertTrue(b.tryAcquire(0))
    }

    @Test
    fun twoFailuresThenASuccessKeepTheBreakerClosed() {
        val b = breaker()
        b.failure(1)
        b.failure(2)
        assertTrue(b.tryAcquire(3))
        b.success()
        b.failure(4)
        b.failure(5)
        assertTrue("2 failures after a success", b.tryAcquire(6))
        b.failure(7)
        assertFalse("3 failures in a row", b.tryAcquire(8))
    }

    @Test
    fun threeFailuresOpenTheBreakerForThirtySeconds() {
        val b = breaker()
        b.failure(1000)
        b.failure(1001)
        assertTrue(b.tryAcquire(1002))
        b.failure(1002)
        assertFalse(b.tryAcquire(1003))
        assertFalse(b.tryAcquire(31_001))
        assertTrue("at the end of the pause", b.tryAcquire(31_002))
    }

    @Test
    fun onlyOneCallerGetsTheHalfOpenProbe() {
        val b = breaker()
        repeat(3) { b.failure(0) }
        assertFalse(b.tryAcquire(29_999))
        assertTrue(b.tryAcquire(30_000))
        assertFalse(b.tryAcquire(30_000))
        assertFalse(b.tryAcquire(99_000))
    }

    @Test
    fun manyThreadsGetExactlyOneProbe() {
        val b = breaker()
        repeat(3) { b.failure(0) }
        val granted = AtomicInteger()
        val go = CountDownLatch(1)
        val threads = List(16) {
            Thread {
                go.await()
                if (b.tryAcquire(40_000)) granted.incrementAndGet()
            }.also { it.start() }
        }
        go.countDown()
        threads.forEach { it.join() }
        assertEquals(1, granted.get())
    }

    @Test
    fun probeFailureOpensTheBreakerAgain() {
        val b = breaker()
        repeat(3) { b.failure(0) }
        assertTrue(b.tryAcquire(30_000))
        b.failure(31_000)
        assertFalse(b.tryAcquire(60_999))
        assertTrue(b.tryAcquire(61_000))
        assertFalse(b.tryAcquire(61_000))
    }

    @Test
    fun probeSuccessClosesTheBreaker() {
        val b = breaker()
        repeat(3) { b.failure(0) }
        assertTrue(b.tryAcquire(30_000))
        b.success()
        assertTrue(b.tryAcquire(30_001))
        assertTrue(b.tryAcquire(30_001))
        b.failure(30_002)
        b.failure(30_003)
        assertTrue("the failure count started again at 0", b.tryAcquire(30_004))
    }

    @Test
    fun failureWhileOpenDoesNotMoveTheEnd() {
        val b = breaker()
        repeat(3) { b.failure(0) }
        b.failure(20_000)
        assertTrue(b.tryAcquire(30_000))
    }

    // ---- DohRoute

    /** A query with the UDP size 65,535 in its OPT record. */
    private val bigQuery = DnsMessage.query(0x1234, "ads.example", DnsMessage.TYPE_A, edns = true).also {
        it[it.size - 8] = 0xff.toByte()
        it[it.size - 7] = 0xff.toByte()
    }

    private fun answerBytes(size: Int) = ByteArray(size).also { it[2] = 0x80.toByte() }

    private class Clock {
        val t = AtomicLong(1_000_000)
        fun now() = t.get()
    }

    private fun route(client: DohClient, clock: Clock, stats: DohStats = DohStats(dohUrl.host)) =
        DohRoute(dohUrl, client, stats, clock::now)

    private fun failing(calls: AtomicInteger) = DohClient({
        calls.incrementAndGet()
        throw IOException("failed for $secret")
    })

    @Test
    fun answerLargerThanTheClientLimitUsesThePlainPathAndIsADohSuccess() {
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerBytes(1233)) }) { s ->
            val clock = Clock()
            val stats = DohStats(dohUrl.host)
            val r = route(s.client, clock, stats)
            // Four times in a row: a DoH success each time, so the breaker never opens.
            repeat(4) { assertNull(r.resolve(query, clock.now() + 5000, true)) }
            assertEquals(4, s.hits.get())
            assertEquals(0, stats.answers.get())
            assertEquals(4, stats.plain.get())
            assertEquals("answer larger than client limit", stats.lastReason)
        }
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerBytes(1232)) }) { s ->
            val clock = Clock()
            val stats = DohStats(dohUrl.host)
            assertEquals(1232, route(s.client, clock, stats).resolve(query, clock.now() + 5000, true)!!.size)
            assertEquals(1, stats.answers.get())
            assertEquals(0, stats.plain.get())
        }
    }

    @Test
    fun answerOfMoreThan65507BytesNeverReachesTheUdpPacketBuilder() {
        // The client sends the UDP size 65,535, so the client limit alone does not stop the answer.
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerBytes(65_508)) }) { s ->
            val clock = Clock()
            val stats = DohStats(dohUrl.host)
            assertNull(route(s.client, clock, stats).resolve(bigQuery, clock.now() + 5000, true))
            assertEquals("answer larger than client limit", stats.lastReason)
            assertEquals(1, stats.plain.get())
        }
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerBytes(65_535)) }) { s ->
            val clock = Clock()
            assertNull(route(s.client, clock).resolve(bigQuery, clock.now() + 5000, true))
        }
        // 65,507 is the largest answer that one IPv4 UDP packet holds.
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerBytes(65_507)) }) { s ->
            val clock = Clock()
            val a = route(s.client, clock).resolve(bigQuery, clock.now() + 5000, true)!!
            assertEquals(65_507, a.size)
            val p = IpPacket.buildUdp(byteArrayOf(10, 0, 0, 1), byteArrayOf(10, 0, 0, 2), 53, 40000, a)
            assertEquals(65_535, p.size)
        }
    }

    @Test
    fun theUdpPacketBuilderCannotHoldMoreThan65507Bytes() {
        val src = byteArrayOf(10, 0, 0, 1)
        val dst = byteArrayOf(10, 0, 0, 2)
        assertEquals(65_507, DohRoute.MAX_UDP_PAYLOAD)
        assertEquals(65_535, IpPacket.buildUdp(src, dst, 53, 1, ByteArray(65_507)).size)
        assertTrue("an IPv4 packet is at most 65,535 bytes", IpPacket.buildUdp(src, dst, 53, 1, ByteArray(65_508)).size > 65_535)
        assertThrows(IllegalArgumentException::class.java) { IpPacket.buildUdp(src, dst, 53, 1, ByteArray(65_535)) }
    }

    @Test
    fun threeFailuresPauseDohAndOneProbeTriesAgain() {
        val calls = AtomicInteger()
        val clock = Clock()
        val stats = DohStats(dohUrl.host)
        val r = route(failing(calls), clock, stats)
        repeat(3) { assertNull(r.resolve(query, clock.now() + 5000, true)) }
        assertEquals(3, calls.get())
        assertEquals("IOException", stats.lastReason)
        assertNull(r.resolve(query, clock.now() + 5000, true))
        assertEquals("no try while the breaker is open", 3, calls.get())
        assertEquals("paused after failures", stats.lastReason)
        assertEquals("the real failure code stays visible", "IOException", stats.lastFailure)
        assertEquals(4, stats.plain.get())
        clock.t.addAndGet(29_999)
        assertNull(r.resolve(query, clock.now() + 5000, true))
        assertEquals(3, calls.get())
        clock.t.addAndGet(1)
        assertNull(r.resolve(query, clock.now() + 5000, true))
        assertEquals("one probe", 4, calls.get())
        assertEquals("IOException", stats.lastReason)
        assertNull(r.resolve(query, clock.now() + 5000, true))
        assertEquals("the probe failed: paused again", 4, calls.get())
        assertEquals("paused after failures", stats.lastReason)
        assertEquals("IOException", stats.lastFailure)
    }

    @Test
    fun successAfterTwoFailuresResetsTheCount() {
        val clock = Clock()
        var fail = true
        lateinit var server: TestServer
        withServer({ ex -> reply(ex, 200, "application/dns-message", answerOf(server.body)) }) { s ->
            server = s
            val calls = AtomicInteger()
            val client = DohClient({ u ->
                calls.incrementAndGet()
                if (fail) throw IOException()
                s.opener(u)
            })
            val stats = DohStats(dohUrl.host)
            val r = route(client, clock, stats)
            repeat(2) { assertNull(r.resolve(query, clock.now() + 5000, true)) }
            fail = false
            assertNotNull(r.resolve(query, clock.now() + 5000, true))
            fail = true
            repeat(2) { assertNull(r.resolve(query, clock.now() + 5000, true)) }
            assertEquals(5, calls.get())
            fail = false
            assertNotNull("still closed after 2 failures", r.resolve(query, clock.now() + 5000, true))
            assertEquals(2, stats.answers.get())
            assertEquals(4, stats.plain.get())
        }
    }

    @Test
    fun dohHostNameAndTooLittleTimeMakeNoTryAndKeepTheProbe() {
        val calls = AtomicInteger()
        val clock = Clock()
        val stats = DohStats(dohUrl.host)
        val r = route(failing(calls), clock, stats)
        val hostQuery = DnsMessage.query(1, "dns.example.test", DnsMessage.TYPE_A, edns = true)
        assertNull(r.resolve(hostQuery, clock.now() + 5000, true))
        assertEquals("DoH host name", stats.lastReason)
        assertNull(r.resolve(ByteArray(12), clock.now() + 5000, true))
        assertEquals("DoH host name", stats.lastReason)
        assertEquals(0, calls.get())
        // 1,000 ms stay for the plain path: DoH needs at least 500 ms more.
        assertNull(r.resolve(query, clock.now() + 1499, true))
        assertEquals("too little time left", stats.lastReason)
        assertEquals(0, calls.get())
        assertEquals(3, stats.plain.get())
        repeat(3) { assertNull(r.resolve(query, clock.now() + 5000, true)) }
        clock.t.addAndGet(30_000)
        // A query with too little time must not use the probe.
        assertNull(r.resolve(query, clock.now() + 1499, true))
        assertEquals(3, calls.get())
        assertNull(r.resolve(query, clock.now() + 5000, true))
        assertEquals("the probe was still free", 4, calls.get())
    }

    @Test
    fun noPlainPathMeansNoPlainCountButTheReasonIsSet() {
        val clock = Clock()
        val stats = DohStats(dohUrl.host)
        val r = route(failing(AtomicInteger()), clock, stats)
        assertNull(r.resolve(query, clock.now() + 5000, false))
        assertEquals(0, stats.plain.get())
        assertEquals("IOException", stats.lastReason)
    }

    @Test
    fun dohTimeIsTheDeadlineMinusTheReserveAtMost2500Ms() {
        val clock = Clock()
        val stats = DohStats(dohUrl.host)
        withServer({ Thread.sleep(10_000) }) { s ->
            val r = route(s.client, clock, stats)
            // Left 1,800 ms, reserve 1,000 ms: 800 ms for DoH.
            val t0 = System.nanoTime()
            assertNull(r.resolve(query, clock.now() + 1800, true))
            val ms = (System.nanoTime() - t0) / 1_000_000
            assertEquals("timeout", stats.lastReason)
            assertTrue("took $ms ms", ms in 700..1500)
        }
    }

    @Test
    fun dohTimeIsCappedAt2500MsWhenTheDeadlineIsFarAway() {
        // The real clock. Deadline 5,000 ms away: the budget is 4,000 ms, the cap is 2,500 ms.
        val stats = DohStats(dohUrl.host)
        silentServer { port ->
            val client = DohClient({ u -> URL("http", "127.0.0.1", port, u.file).openConnection() as HttpURLConnection })
            val r = DohRoute(dohUrl, client, stats, { System.nanoTime() / 1_000_000 })
            val t0 = System.nanoTime()
            assertNull(r.resolve(query, System.nanoTime() / 1_000_000 + 5000, true))
            val ms = (System.nanoTime() - t0) / 1_000_000
            assertEquals("timeout", stats.lastFailure)
            assertEquals("timeout", stats.lastReason)
            assertTrue("took $ms ms", ms in 2300..3400)
        }
    }

    // ---- udpPayloadLimit, dohSkipsName

    @Test
    fun udpPayloadLimitReadsTheOptRecord() {
        assertEquals(1232, DnsMessage.udpPayloadLimit(DnsMessage.query(1, "a.example", 1, edns = true)))
        assertEquals(512, DnsMessage.udpPayloadLimit(DnsMessage.query(1, "a.example", 1, edns = false)))
        val small = DnsMessage.query(1, "a.example", 1, edns = true)
        // The OPT record ends the message: name (1), type (2), class (2), ttl (4), rdlen (2).
        small[small.size - 8] = 0
        small[small.size - 7] = 100
        assertEquals(512, DnsMessage.udpPayloadLimit(small))
        small[small.size - 8] = 0xff.toByte()
        small[small.size - 7] = 0xff.toByte()
        assertEquals(65535, DnsMessage.udpPayloadLimit(small))
        val q = DnsMessage.query(1, "a.example", 1, edns = true)
        assertEquals(512, DnsMessage.udpPayloadLimit(q.copyOf(q.size - 3)))
        assertEquals(512, DnsMessage.udpPayloadLimit(ByteArray(0)))
        assertEquals(512, DnsMessage.udpPayloadLimit(ByteArray(11)))
        assertEquals(512, DnsMessage.udpPayloadLimit(ByteArray(40) { 0xff.toByte() }))
    }

    @Test
    fun dohSkipsTheDohHostAndNamelessQueries() {
        val host = "dns.example.test"
        assertTrue(dohSkipsName("dns.example.test", host))
        assertTrue(dohSkipsName("DNS.Example.TEST", host))
        assertTrue(dohSkipsName("dns.example.test.", host))
        assertTrue(dohSkipsName("dns.example.test", "DNS.Example.Test"))
        assertTrue(dohSkipsName(null, host))
        assertTrue(dohSkipsName("", host))
        assertFalse(dohSkipsName("other.example.test", host))
        assertFalse(dohSkipsName("www.dns.example.test", host))
        assertFalse(dohSkipsName("example.test", host))
    }
}
