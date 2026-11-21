package adgecko.shield.core

enum class Action { BLOCK, FORWARD }

enum class Layer { SELF_TEST, USER_ALLOW, THREAT, NEVER_BLOCK, LIST, NONE }

enum class Mode(val id: String) {
    ADS_AND_THREAT("ads+threat"),
    THREAT_ONLY("threat-only");

    companion object {
        fun of(id: String): Mode = entries.firstOrNull { it.id == id } ?: throw IllegalArgumentException("unknown mode $id")
    }
}

data class Decision(val action: Action, val layer: Layer, val matched: String?)

/** The data layers of the policy. The sets are read-only after the load. */
class PolicyData(
    val threat: HostSet,
    val neverBlock: NeverBlock,
    val list: HostSet,
) {
    companion object {
        /**
         * No list, threat or never-block data: the policy before the bundled
         * data has loaded, or after a failed load. Only the Self-test marker
         * (and the user allow list) can match, so all other names are
         * forwarded (fail-open), and the Self-test still proves the VPN path.
         * CI emulator run of 2026-11-17: the data load took about 1.1 to
         * 1.3 s after a process start, and the Self-test name was forwarded
         * in that time.
         */
        val EMPTY = PolicyData(HostSet.EMPTY, NeverBlock(emptyList(), emptyList()), HostSet.EMPTY)
    }
}

/**
 * The DNS policy of the Shield (docs/android/PLAN.md section 3). The layer
 * order follows the DNR priorities 2,000,020 > 2,000,010 > 2,000,000 > 1:
 * SELF_TEST, USER_ALLOW, THREAT, NEVER_BLOCK, LIST, NONE. Each layer matches
 * the host and each parent domain. The state is immutable: a change of the
 * mode, the pause or the allow list makes a new DnsPolicy object.
 * Port of dnsDecision() of scripts/lib/android-dns-policy.mjs.
 */
class DnsPolicy(
    val data: PolicyData,
    val mode: Mode,
    val paused: Boolean,
    userAllow: Collection<String>,
) {
    private val userAllow: Set<String> = HashSet(userAllow)

    fun withState(mode: Mode = this.mode, paused: Boolean = this.paused, userAllow: Collection<String> = this.userAllow): DnsPolicy =
        DnsPolicy(data, mode, paused, userAllow)

    /** [host] is a raw query name; it is normalized here. */
    fun decide(host: String): Decision {
        val h = HostName.normalize(host) ?: return NONE
        return decideNormalized(h)
    }

    fun decideNormalized(h: String): Decision {
        NeverBlock.suffixMatch(h, SELF_TEST_SET)?.let { return Decision(Action.BLOCK, Layer.SELF_TEST, it) }
        NeverBlock.suffixMatch(h, userAllow)?.let { return Decision(Action.FORWARD, Layer.USER_ALLOW, it) }
        data.threat.matchSuffix(h)?.let { return Decision(Action.BLOCK, Layer.THREAT, it) }
        data.neverBlock.match(h)?.let { return Decision(Action.FORWARD, Layer.NEVER_BLOCK, it) }
        if (mode == Mode.ADS_AND_THREAT && !paused) {
            data.list.matchSuffix(h)?.let { return Decision(Action.BLOCK, Layer.LIST, it) }
        }
        return NONE
    }

    companion object {
        const val SELF_TEST_HOST = "self-test.adgecko.test"
        private val SELF_TEST_SET = setOf(SELF_TEST_HOST)
        val NONE = Decision(Action.FORWARD, Layer.NONE, null)
    }
}
