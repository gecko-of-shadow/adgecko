const p = JSON.parse(Deno.readTextFileSync("docs/review-2026-11-16/repros/payloads.json"));
const plats = ["github.io","pages.dev","workers.dev","blogspot.com","netlify.app","vercel.app","herokuapp.com","web.app","firebaseapp.com","azurewebsites.net","amazonaws.com","s3.amazonaws.com","cloudfront.net","appspot.com","wordpress.com","wixsite.com","weebly.com","glitch.me","onrender.com","fly.dev","r2.dev","googleusercontent.com","sharepoint.com","000webhostapp.com","ngrok.io","ngrok-free.app","duckdns.org","no-ip.org","ddns.net","myshopify.com","translate.goog","b-cdn.net","surge.sh","repl.co","replit.dev","gitbook.io","notion.site","framer.app","webflow.io","carrd.co","linktr.ee","sites.google.com","docs.google.com","forms.gle","bit.ly","t.co","tinyurl.com","dropbox.com","drive.google.com","1drv.ms","mediafire.com","discord.gg","telegra.ph","ipfs.io","dweb.link","cloudflare-ipfs.com"];
for (const [n, q] of Object.entries(p)) {
  for (const d of q.domains) if (plats.includes(d)) console.log(n, "WHOLE", d);
  for (const [d,k] of q.scoped) if (plats.includes(d)) console.log(n, "SCOPED", d, k);
  for (const d of q.popup||[]) if (plats.includes(d)) console.log(n, "POPUP", d);
}
