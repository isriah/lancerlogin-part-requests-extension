# Setup and troubleshooting

## Before students pair

An Admin installs and sets up the [Part Requests plugin](https://github.com/isriah/lancerlogin-part-requests) on the team's LancerLogin site. That is where the Notion connection and the database layout live, and its README lists both. Nothing about Notion is configured in the extension.

Each student must be on the active roster with a linked Discord account, because `/ordering-pin` requires both.

## Student: pair this device

The [student guide](STUDENT-GUIDE.md) is the short version.

1. In your team's Discord server, run `/ordering-pin`. The private reply gives a site address and a PIN that works once and expires in 10 minutes. Running it again cancels the earlier PIN. Devices you already paired stay paired, up to 5.
2. Open the extension's Options page. Paste the site address and the PIN, with or without its hyphen. Give the device a name so an Admin can tell your devices apart.
3. Click **Pair this device**. Chrome asks to allow that one site. Choose **Allow**.

The address can be pasted as you got it. The extension uses only its origin, requires `https://`, and adds `/api` to reach Core's Pages proxy.

If you choose **Deny**, nothing is paired, nothing is sent and your PIN still works. Click **Pair this device** again and choose **Allow**.

## Student: choose defaults

Select your team and your Notion name, then **Save defaults**. You can override either on an individual request. Your name is saved with the site through the plugin, so other devices you pair start with it. Your team is saved on this device only. If you skip this, the person on your first successful request becomes your default.

The team and recipient lists come from the plugin and refresh each time you open the popup or Options. The recipient list combines workspace members with everyone already named on an existing request, and the plugin refreshes it every six hours. If your name is missing, ask an Admin to refresh the list. A guest who has never been on a request needs someone to add them to one in Notion first.

## Unpairing and pairing again

**Unpair this device** forgets the key on this computer and removes Chrome's permission for the site. It does not end the key on the site, because the plugin has no route for a device to revoke itself: the device stays on the Admin page and counts toward your limit of 5 until an Admin removes it. Drafts on this computer are kept.

An Admin can revoke a device, and leaving the active roster ends access. The extension then forgets its key and asks you to pair again. Drafts are kept, and pairing again from the same member lets you send them. After a site restore, every device has to pair again.

## Security and local data

The manifest requests `activeTab`, `scripting` and `storage`, plus `optional_host_permissions` of `https://*/*`, from which it asks for one site, during your Pair click. Unpairing or pairing with another site gives the old one up. There are no persistent product-site permissions, content scripts, automatic browsing monitors, telemetry, external scripts, or remote code. The reader runs in the clicked tab's isolated world.

The device key is saved in `chrome.storage.local`. On every service-worker start, storage access is restricted to `TRUSTED_CONTEXTS`, so content scripts cannot read it. Only the service worker reads the key and sends it, as a bearer token and only to the paired site's address. Requests do not follow redirects and send no cookies. The popup and Options pages are never given the key. Runtime messages are accepted only from this extension's popup and settings page. Chrome Sync is not used.

Local extension storage is not an encrypted credential vault. Anyone with access to the Chrome profile, its backups, extension debugging tools, or the local machine may be able to recover the key and saved drafts. Use a trusted browser profile, and ask an Admin to revoke the device if a computer is lost. Uninstalling the extension removes its local data; check uncertain submissions in Notion before reinstalling or clearing storage.

## Troubleshooting

| Message or behavior | What to do |
|---|---|
| You chose Deny | Click **Pair this device** again and choose **Allow**. |
| That PIN does not work | Run `/ordering-pin` again and use the new PIN. Only the latest PIN works, once, for 10 minutes. |
| Pairing is paused | Too many wrong PINs were tried. Try again later. |
| You already have 5 paired devices | Ask an Admin to remove a device, then run `/ordering-pin` again. |
| Did not answer like a site with Part Requests | Check the address from the Discord reply. |
| The site address must start with https:// | Use the address from the Discord reply. Plain `http` is refused. |
| This device is no longer paired | Run `/ordering-pin` and pair again in Options. Your drafts are kept. |
| Chrome no longer has permission | The site's permission was removed in Chrome. Unpair in Options, then pair again. |
| The site is updating | Wait. The extension tries again by itself with the same request. If it gives up, your draft stays, so send it again later. |
| Not connected to Notion, or an Admin has to act | The plugin's Notion connection needs attention. Ask an Admin. Nothing was created. |
| Too many requests | Wait the time shown. The limit is per device. |
| Requested recently | Someone asked for the same product in the last 7 days. Check with them if you are not sure, or send anyway. |
| Person missing | See [Student: choose defaults](#student-choose-defaults). |
| Product price/SKU blank | Choose all product options and reopen. If a draft already exists, Discard to recapture, then correct the exact values manually. |
| Open one specific product | Leave search, category, cart, or multi-product pages. WCP requires one checked part. McMaster requires an individual part-number page. |
| Foreign or unknown currency | Enter the price in USD and check the confirmation box. No conversion is performed. |
| Unsupported URL | Use a fixed allowlisted store. Redirect shortened links by opening them normally first. BambuLab is US-only and CTRE uses its store subdomain. |
| Access check | Complete it yourself in the product tab; reopen the extension afterward. No bypass is attempted. |
| Request was not created | Notion refused it, or the site has no record of it. Review the fields and use **Review and retry**. |
| Check Notion before retrying | A timeout, conflict, server error, worker interruption, or lost response may conceal a successful create. Check your team's ordering database in Notion. Only confirm the checkbox if the request does not exist. |
| Form locked while pending | Wait for the result. After 30 seconds without confirmation, the popup offers the explicit check-and-retry flow. |
| Browser says extension APIs unavailable | Load the folder through `chrome://extensions`, then use the toolbar popup. A regular web tab is only a layout preview. |

If a request already exists after an uncertain result, leave the saved submission alone and continue in Notion. Do not check the retry confirmation. Nothing automatically creates another request when you close the popup.
