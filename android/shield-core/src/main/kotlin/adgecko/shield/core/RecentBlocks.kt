package adgecko.shield.core

/**
 * The last blocked names (docs/android/PLAN.md section 6.1): a ring buffer
 * in memory only (OD-12). No host name goes to a file.
 */
class RecentBlocks(private val capacity: Int = 200) {
    data class Entry(val timeMillis: Long, val host: String, val layer: Layer, val qtype: Int)

    private val items = arrayOfNulls<Entry>(capacity)
    private var next = 0
    private var count = 0

    @Synchronized
    fun add(entry: Entry) {
        items[next] = entry
        next = (next + 1) % capacity
        if (count < capacity) count++
    }

    /** Newest first. */
    @Synchronized
    fun snapshot(): List<Entry> {
        val out = ArrayList<Entry>(count)
        for (k in 1..count) out += items[(next - k + capacity) % capacity]!!
        return out
    }

    @Synchronized
    fun clear() {
        items.fill(null)
        next = 0
        count = 0
    }
}
