# Setup and troubleshooting

## Coach: create the connection

1. In Notion's developer portal, create an **internal connection** for the team's workspace. A workspace owner must arrange the connection and access. Use a dedicated connection for this personal pilot.
2. Enable **Read content**, **Insert content**, and **Read user information without email addresses**. The extension does not need Update content or comment capabilities.
3. Open the original ordering database in Notion. In its **Connections** menu, add the connection. Share a test copy with matching schema first.
4. On the student's computer, open the extension's Options page. Enter the connection token directly there and paste the original database URL. Do not put the token into a source file, command, screenshot, or chat.
5. Choose **Test connection and save**. If the database has several data sources, choose the ordering source and test again. This action reads access and schema; it does not create pages or change properties.

Notion explains connection access in its [authorization guide](https://developers.notion.com/guides/get-started/authorization). The extension sends API version `2026-03-11` and resolves the URL's database ID to a data source. The `v` query parameter is a view ID and is never used as the write destination.


## Required existing schema

Initial mapping uses the exact property names below. Successful setup saves the property IDs, so later property renames remain mapped when refreshing the same data source. The extension never adds options, properties, or templates.

| Property | Accepted type | Requirements |
|---|---|---|
| Item Description | Title | Request description |
| Status | Status or Select | Existing `NORMAL Request` and `Incomplete Request` options |
| Vendor | Select | All 20 exact labels in the [vendor matrix](VENDORS.md) |
| Team | Select or Multi-select | At least one existing choice; one choice per request |
| Orderer/Recipient | People | A Notion person |
| SKU | Rich text | Optional on requests |
| Product URL | URL | A supported store |
| Qty | Number | Positive quantity |
| Unit Price | Number | USD; use dollar display formatting in Notion |
| Extension | Formula or Rollup | Read-only; calculated by Notion |

An incompatible property or missing option produces a setup error naming the problem. Verify the correct original database and ask the coach to correct its schema. The code does not assume the public page's IDs or types before authenticated setup.

## Student: choose defaults and import a guest

Select your team and your Orderer/Recipient, then **Save defaults**. You can override either field for an individual request.

The recipient list combines workspace members with everyone already named as an Orderer/Recipient on a request in this database, so guests who have requested parts before appear automatically. It refreshes each time you open this page. If the lookup fails, the page shows why, and workspace members and the manual import below still work.

If your name is still missing, you have no requests yet:

1. Find an existing request in the configured database with you set in Orderer/Recipient. If necessary, ask the coach to make one in Notion first.
2. Copy that request's full page URL into **Existing request URL**.
3. Choose **Find recipients in request**. The extension reads only that page's mapped people property and resolves the names.
4. Select the correct person from the resulting list and save defaults.

Notion's [user-list endpoint excludes guests](https://developers.notion.com/reference/get-users), so the guest flow does not depend on appearing in the workspace member list. Imported people IDs and names are stored locally; emails are not retained.

## Security and local data

The manifest requests `activeTab`, `scripting`, `storage`, and access to `https://api.notion.com/*`. The reader runs in the clicked tab's isolated world. There are no persistent product-site host permissions, content scripts, automatic browsing monitors, telemetry, external scripts, or remote code.

The token is saved in `chrome.storage.local`. On every service-worker start, storage access is restricted to `TRUSTED_CONTEXTS`. Only the service worker reads the stored token and sends it to Notion. Product-page code receives only the vendor's public extraction configuration. Runtime messages are accepted only from this extension's popup and settings page. Chrome Sync is not used.

Local extension storage is not an encrypted credential vault. Anyone with access to the Chrome profile, its backups, extension debugging tools, or the local machine may be able to recover the token and saved drafts. Use a trusted personal browser profile. See [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).

**Disconnect** removes the token and configured people/schema/defaults. It leaves draft and submission history in place to preserve duplicate-submit protection. Revoke the connection in Notion when it is no longer needed. Uninstalling the extension removes its local data; check uncertain submissions in Notion before reinstalling or clearing storage.

## Troubleshooting

| Message or behavior | What to do |
|---|---|
| Token invalid or expired | Replace the token in Options. Existing tokens are never displayed again. |
| Connection lacks permission | Have the coach check read, insert, and user-information capabilities. |
| Database/page inaccessible | Connect the original database to the integration. Check that the URL belongs to the right workspace. A public Notion link alone does not grant API access. |
| Multiple data sources | Select the ordering source and test again. |
| Missing/incompatible field | Confirm the schema above. No automatic schema changes are made. |
| Person missing | Import from an existing request in the same database. |
| Product price/SKU blank | Choose all product options and reopen. If a draft already exists, Discard to recapture, then correct the exact values manually. |
| Open one specific product | Leave search, category, cart, or multi-product pages. WCP requires one checked part. McMaster requires an individual part-number page. |
| Foreign or unknown currency | Enter the price in USD and check the confirmation box. No conversion is performed. |
| Unsupported URL | Use a fixed allowlisted store. Redirect shortened links by opening them normally first. BambuLab is US-only and CTRE uses its store subdomain. |
| Access check | Complete it yourself in the product tab; reopen the extension afterward. No bypass is attempted. |
| Notion rejected request | Review the fields, then refresh the connection/schema in Options. Use Review and retry after fixing it. |
| Rate limited | Wait the displayed interval before an explicit retry. There is no automatic retry. |
| Check Notion before retrying | A timeout, conflict, server error, worker interruption, or lost response may conceal a successful create. Check the linked database. Only confirm the checkbox if the request does not exist. |
| Form locked while pending | Wait for the result. After 30 seconds without confirmation, the popup offers the explicit check-and-retry flow. |
| Browser says extension APIs unavailable | Load `dist` through `chrome://extensions`, then use the toolbar popup. A regular web tab is only a layout preview. |

If a request already exists after an uncertain result, leave the saved submission alone and continue in Notion. Do not check the retry confirmation. Nothing automatically creates another request when you close the popup.
