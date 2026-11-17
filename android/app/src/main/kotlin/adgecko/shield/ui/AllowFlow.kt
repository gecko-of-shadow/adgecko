package adgecko.shield.ui

import adgecko.shield.ShieldApp
import adgecko.shield.core.DomainRules
import adgecko.shield.store.AllowListCodec
import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent

/**
 * "Allow this domain" (docs/android/PLAN.md section 6.3). DomainRules (port
 * of userDomainReason()) checks the name. A threat name needs a second
 * confirmation. If the name is refused, the dialog shows the reason and
 * offers "Pause 10 min" and "Exclude an app".
 */
object AllowFlow {
    fun validator(): (String) -> AllowListCodec.Check {
        val rules = DomainRules(ShieldState.data?.psl)
        return { s -> rules.userDomainReason(s).let { AllowListCodec.Check(it.domain, it.reason) } }
    }

    fun allow(a: Activity, name: String, threat: Boolean, done: () -> Unit) {
        val check = validator()(name)
        val domain = check.domain
        if (domain == null) {
            AlertDialog.Builder(a)
                .setTitle("Cannot allow $name")
                .setMessage("Reason: ${check.reason}.\n\nYou can pause the list layer for 10 minutes, or exclude the app that needs this name.")
                .setPositiveButton("Pause 10 min") { _, _ -> ShieldVpnService.command(a, ShieldVpnService.ACTION_PAUSE); done() }
                .setNeutralButton("Exclude an app") { _, _ -> a.startActivity(Intent(a, AppExclusionsActivity::class.java)) }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        val first = AlertDialog.Builder(a)
            .setTitle("Allow $domain?")
            .setMessage("The Shield will not block $domain and its subdomains. The change works within about 1 minute.")
            .setNegativeButton("Cancel", null)
        if (!threat) {
            first.setPositiveButton("Allow") { _, _ -> add(a, domain, done) }.show()
            return
        }
        first.setPositiveButton("Next") { _, _ ->
            AlertDialog.Builder(a)
                .setTitle("$domain is on a malware list")
                .setMessage("Allow it only if you are sure that it is safe. Allow it anyway?")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Allow anyway") { _, _ -> add(a, domain, done) }
                .show()
        }.show()
    }

    private fun add(a: Activity, domain: String, done: () -> Unit) {
        val store = (a.application as ShieldApp).store
        val r = AllowListCodec.merge(store.allowDomains(), listOf(domain), validator())
        if (r.overLimit > 0) {
            AlertDialog.Builder(a).setMessage("The allow list is full (${AllowListCodec.MAX_ENTRIES} entries).").setPositiveButton("OK", null).show()
            return
        }
        store.setAllowDomains(r.domains)
        ShieldState.rebuildPolicy(store)
        ShieldVpnService.command(a, ShieldVpnService.ACTION_RELOAD)
        done()
    }
}
