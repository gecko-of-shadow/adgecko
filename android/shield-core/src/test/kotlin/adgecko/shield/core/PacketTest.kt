package adgecko.shield.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.Random

/** Plan A7: hand-made packets. Addresses are documentation ranges only. */
class PacketTest {
    private val client4 = byteArrayOf(192.toByte(), 0, 2, 1)
    private val alias4 = byteArrayOf(192.toByte(), 0, 2, 2)
    private val client6 = ByteArray(16).also { it[0] = 0x20; it[1] = 0x01; it[2] = 0x0d; it[3] = 0xb8.toByte(); it[15] = 1 }
    private val alias6 = ByteArray(16).also { it[0] = 0x20; it[1] = 0x01; it[2] = 0x0d; it[3] = 0xb8.toByte(); it[15] = 2 }

    private val policy = DnsPolicy(
        PolicyData(HostSet.of(listOf("threat.test")), NeverBlock(listOf("stream.example"), emptyList()), HostSet.of(listOf("ads.example"))),
        Mode.ADS_AND_THREAT, false, emptyList(),
    )
    private val decisions = mutableListOf<Decision>()
    private val handler = PacketHandler(listOf(alias4, alias6), { policy }, 2026111422) { _, d -> decisions += d }

    private fun queryPacket(client: ByteArray, alias: ByteArray, name: String, qtype: Int, edns: Boolean = true, id: Int = 0x1234) =
        IpPacket.buildUdp(client, alias, 40000, 53, DnsMessage.query(id, name, qtype, edns))

    @Test
    fun blockedNameGivesNodataWithSoaForEachTypeAndFamily() {
        for ((client, alias) in listOf(client4 to alias4, client6 to alias6)) {
            for (qtype in listOf(DnsMessage.TYPE_A, DnsMessage.TYPE_AAAA, DnsMessage.TYPE_HTTPS, DnsMessage.TYPE_SVCB)) {
                for (name in listOf("ads.example", "x.threat.test", "self-test.adgecko.test")) {
                    val pkt = queryPacket(client, alias, name, qtype)
                    val out = handler.handle(pkt, pkt.size)
                    assertTrue("$name $qtype: $out", out is Outcome.Reply)
                    val reply = IpPacket.parse((out as Outcome.Reply).bytes)!!
                    assertArrayEquals(alias, reply.src)
                    assertArrayEquals(client, reply.dst)
                    assertEquals(53, reply.srcPort())
                    assertEquals(40000, reply.dstPort())
                    assertTrue("UDP checksum", IpPacket.transportChecksumOk(reply))
                    val (off, len) = reply.udpData()!!
                    val r = DnsMessage.parseResponse(reply.buf, off, len)!!
                    assertEquals(0x1234, r.id)
                    assertTrue("QR", r.flags and 0x8000 != 0)
                    assertEquals(0, r.rcode)
                    assertEquals(1, r.qdcount)
                    assertEquals(0, r.ancount)
                    assertEquals(1, r.nscount)
                    assertEquals(0, r.arcount)
                    assertEquals(DnsMessage.MNAME, r.soaMname)
                    assertEquals(60L, r.soaTtl)
                    assertEquals(60L, r.soaMinimum)
                    val q = DnsMessage.parseQuery(DnsMessage.query(1, name, qtype))!!
                    val rq = DnsMessage.readName(reply.buf, off, len, 12)!!
                    assertEquals(q.name, DnsMessage.nameText(rq.labels))
                }
            }
        }
    }

    @Test
    fun allowedNameIsForwardedToAStubUpstreamAndComesBackWithSwappedAddresses() {
        DatagramSocket(0, InetAddress.getLoopbackAddress()).use { stub ->
            stub.soTimeout = 5000
            for ((client, alias) in listOf(client4 to alias4, client6 to alias6)) {
                val pkt = queryPacket(client, alias, "www.stream.example", DnsMessage.TYPE_A, edns = true, id = 0x4321)
                val out = handler.handle(pkt, pkt.size)
                assertTrue(out is Outcome.Forward)
                val fwd = out as Outcome.Forward
                assertEquals(if (alias === alias4) 0 else 1, fwd.upstreamIndex)
                // The payload goes unchanged to the upstream (EDNS size stays).
                assertTrue(DnsMessage.parseResponse(fwd.query)!!.opt)
                DatagramSocket(0, InetAddress.getLoopbackAddress()).use { up ->
                    up.soTimeout = 5000
                    up.send(DatagramPacket(fwd.query, fwd.query.size, stub.localSocketAddress))
                    val buf = ByteArray(1500)
                    val got = DatagramPacket(buf, buf.size)
                    stub.receive(got)
                    val asked = got.data.copyOf(got.length)
                    assertArrayEquals(fwd.query, asked)
                    // The stub answers with QR set and the same EDNS record.
                    val answer = asked.copyOf()
                    answer[2] = (answer[2].toInt() or 0x80).toByte()
                    answer[3] = (answer[3].toInt() or 0x80).toByte()
                    stub.send(DatagramPacket(answer, answer.size, got.socketAddress))
                    val back = DatagramPacket(ByteArray(1500), 1500)
                    up.receive(back)
                    val reply = handler.forwardReply(fwd.ret, back.data.copyOf(back.length))
                    val p = IpPacket.parse(reply)!!
                    assertArrayEquals(alias, p.src)
                    assertArrayEquals(client, p.dst)
                    assertEquals(53, p.srcPort())
                    assertEquals(40000, p.dstPort())
                    assertTrue(IpPacket.transportChecksumOk(p))
                    val (off, len) = p.udpData()!!
                    val r = DnsMessage.parseResponse(p.buf, off, len)!!
                    assertEquals(0x4321, r.id)
                    assertTrue("EDNS record unchanged", r.opt)
                    assertArrayEquals(answer, p.buf.copyOfRange(off, off + len))
                }
                val sf = handler.servfailReply(fwd.ret, fwd.query)!!
                val sp = IpPacket.parse(sf)!!
                val (so, sl) = sp.udpData()!!
                assertEquals(2, DnsMessage.parseResponse(sp.buf, so, sl)!!.rcode)
            }
        }
    }

    @Test
    fun tcpSynToAnAliasOnPort53Or853GivesRstAck() {
        for ((client, alias) in listOf(client4 to alias4, client6 to alias6)) {
            for (port in listOf(53, 853)) {
                val syn = tcpSyn(client, alias, 41000, port, 0x01020304L)
                val out = handler.handle(syn, syn.size)
                assertTrue("port $port", out is Outcome.Reply)
                val p = IpPacket.parse((out as Outcome.Reply).bytes)!!
                assertArrayEquals(alias, p.src)
                assertArrayEquals(client, p.dst)
                assertEquals(port, p.srcPort())
                assertEquals(41000, p.dstPort())
                assertEquals(IpPacket.TCP_RST or IpPacket.TCP_ACK, p.tcpFlags())
                val ack = ((p.buf[p.l4Offset + 8].toLong() and 0xff) shl 24) or ((p.buf[p.l4Offset + 9].toLong() and 0xff) shl 16) or
                    ((p.buf[p.l4Offset + 10].toLong() and 0xff) shl 8) or (p.buf[p.l4Offset + 11].toLong() and 0xff)
                assertEquals(0x01020305L, ack)
                assertTrue("TCP checksum", IpPacket.transportChecksumOk(p))
            }
            val other = tcpSyn(client, alias, 41000, 443, 1)
            assertTrue(handler.handle(other, other.size) === Outcome.Drop)
        }
    }

    private fun tcpSyn(src: ByteArray, dst: ByteArray, sport: Int, dport: Int, seq: Long): ByteArray {
        // Build an RST+ACK shape with the builder, then turn it into a SYN with a correct checksum.
        val p = IpPacket.buildTcpRstAck(src, dst, sport, dport, seq - 1)
        val t = if (src.size == 4) 20 else 40
        for (i in 8..11) p[t + i] = 0
        p[t + 4] = (seq shr 24).toByte(); p[t + 5] = (seq shr 16).toByte(); p[t + 6] = (seq shr 8).toByte(); p[t + 7] = seq.toByte()
        p[t + 13] = IpPacket.TCP_SYN.toByte()
        p[t + 16] = 0; p[t + 17] = 0
        val parsed = IpPacket.parse(p)!!
        var sum = 0L
        for (a in arrayOf(src, dst)) for (i in a.indices step 2) sum += ((a[i].toInt() and 0xff) shl 8) or (a[i + 1].toInt() and 0xff)
        sum += 6 + 20
        val c = IpPacket.checksum(p, parsed.l4Offset, 20, sum)
        p[t + 16] = (c shr 8).toByte(); p[t + 17] = c.toByte()
        return p
    }

    @Test
    fun malformedShortFragmentedAndRandomInputGivesDrop() {
        val good = queryPacket(client4, alias4, "ads.example", DnsMessage.TYPE_A)
        val cases = mutableListOf<ByteArray>()
        cases += ByteArray(0)
        cases += byteArrayOf(0x45)
        for (n in 1 until good.size) cases += good.copyOf(n) // truncated
        cases += good.copyOf().also { it[6] = 0x20 } // MF flag
        cases += good.copyOf().also { it[7] = 0x08 } // fragment offset
        cases += good.copyOf().also { it[10] = (it[10].toInt() xor 0xff).toByte() } // IPv4 header checksum
        cases += good.copyOf().also { it[0] = 0x55 } // version 5
        cases += IpPacket.buildUdp(client4, alias4, 40000, 54, DnsMessage.query(1, "ads.example", 1)) // port
        cases += IpPacket.buildUdp(client4, client4, 40000, 53, DnsMessage.query(1, "ads.example", 1)) // not an alias
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, ByteArray(5)) // short DNS
        val v6 = queryPacket(client6, alias6, "ads.example", DnsMessage.TYPE_A)
        cases += v6.copyOf().also { it[6] = 44 } // IPv6 fragment header
        cases += v6.copyOf().also { it[6] = 0 } // hop-by-hop
        // Response bit set, opcode 1, two questions.
        val q = DnsMessage.query(1, "ads.example", 1)
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, q.copyOf().also { it[2] = 0x81.toByte() })
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, q.copyOf().also { it[2] = 0x09 })
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, q.copyOf().also { it[5] = 2 })
        // Compression loop: the name points at itself.
        val loop = ByteArray(18).also { it[1] = 1; it[2] = 1; it[5] = 1; it[12] = 0xc0.toByte(); it[13] = 12; it[15] = 1; it[17] = 1 }
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, loop)
        // Pointer chain longer than 32 jumps.
        val chain = ByteArray(12 + 2 * 40 + 4).also { it[1] = 1; it[5] = 1 }
        for (k in 0 until 40) { chain[12 + 2 * k] = 0xc0.toByte(); chain[13 + 2 * k] = (12 + 2 * (k + 1)).toByte() }
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, chain)
        // A label with a 0x40 length type.
        cases += IpPacket.buildUdp(client4, alias4, 40000, 53, q.copyOf().also { it[12] = 0x41 })
        for (c in cases) {
            val out = handler.handle(c, c.size)
            assertTrue("expected Drop, got $out", out === Outcome.Drop)
        }
        val rnd = Random(20261117)
        repeat(20_000) {
            val b = ByteArray(rnd.nextInt(120))
            rnd.nextBytes(b)
            if (b.isNotEmpty() && rnd.nextBoolean()) b[0] = if (rnd.nextBoolean()) 0x45 else 0x60
            handler.handle(b, b.size) // no exception
        }
        // Random DNS payloads in valid UDP packets: Drop, Reply or Forward, never an exception.
        repeat(20_000) {
            val b = ByteArray(12 + rnd.nextInt(80))
            rnd.nextBytes(b)
            b[2] = (b[2].toInt() and 0x07).toByte()
            b[4] = 0; b[5] = 1
            val pkt = IpPacket.buildUdp(client4, alias4, 40000, 53, b)
            handler.handle(pkt, pkt.size)
        }
        assertEquals(0L, handler.errors)
    }

    @Test
    fun aNameWithADotInALabelOrABadByteIsForwarded() {
        val q = DnsMessage.query(7, "abc.example", 1)
        q[13] = '.'.code.toByte() // "a.c" as one label
        val pkt = IpPacket.buildUdp(client4, alias4, 40000, 53, q)
        assertTrue(handler.handle(pkt, pkt.size) is Outcome.Forward)
        assertNull(DnsMessage.parseQuery(q)!!.name)
        assertNotNull(DnsMessage.parseQuery(DnsMessage.query(7, "abc.example", 1))!!.name)
    }

    @Test
    fun aPolicyErrorForwardsTheQuery() {
        val broken = PacketHandler(listOf(alias4), { throw IllegalStateException("broken policy") })
        val pkt = queryPacket(client4, alias4, "ads.example", DnsMessage.TYPE_A)
        assertTrue(broken.handle(pkt, pkt.size) is Outcome.Forward)
        assertEquals(1L, broken.errors)
    }

    @Test
    fun recentBlocksKeepsTheLast200NewestFirst() {
        val r = RecentBlocks()
        for (i in 0 until 250) r.add(RecentBlocks.Entry(i.toLong(), "h$i.test", Layer.LIST, 1))
        val s = r.snapshot()
        assertEquals(200, s.size)
        assertEquals("h249.test", s.first().host)
        assertEquals("h50.test", s.last().host)
    }
}
