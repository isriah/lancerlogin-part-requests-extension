# Part Requests: student guide

Click one button on a store's product page, check the details, and your part request lands in the team's Notion ordering database. You don't need a LancerLogin or Notion account for this.

## Set it up once

You need: a computer with Chrome, your own Chrome profile, and your Discord account linked to the team roster.

1. Get `robotics-part-requests-<version>.zip` from your team and unzip it somewhere you won't delete it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Pin **Robotics Part Requests** from Chrome's puzzle-piece menu. Its settings page is under the gear icon in the popup.
4. In your team's Discord server, run **`/ordering-pin`**. You get a private reply with a **site address** and a **PIN**. The PIN works once and only for 10 minutes.
5. In the settings page, paste the site address and the PIN, give the device a name like "Shop laptop", and click **Pair this device**.
6. Chrome asks to allow that one site. Choose **Allow**.
7. Choose your team and your Notion name, then click **Save defaults**.

## Request a part

1. Open one product on a supported store and pick its options (size, color and so on).
2. Click the extension.
3. Check every field against the page, especially the price, quantity and SKU.
4. Click **Create request** at the top.

Good to know:

- **Quantity** is how many units or packs are sold at that price. Quantity 1 of a pack of 50 is one pack.
- **Your edits are saved.** You can close the popup and come back.
- **"Requested recently"** means someone already asked for this in the last 7 days. Check with them if you aren't sure. You can still send it.
- **Incomplete request** is for when you don't know everything yet. It only needs a description and a link.

## If something goes wrong

| You see | Do this |
|---|---|
| Pair this device again | An Admin removed this device or you left the roster. Run `/ordering-pin` again and pair in settings. Your drafts are kept. |
| That PIN does not work | Run `/ordering-pin` again and use the newest PIN. |
| You chose Deny | Click **Pair this device** again and choose **Allow**. |
| You already have 5 paired devices | Ask an Admin to remove one. |
| The site is updating | Wait. It tries again by itself. |
| **Check Notion before retrying** | Your request may already exist. Look in the ordering database first. Only if it isn't there, tick the box and retry. |
| Your name isn't in the list | Ask an Admin to refresh the recipient list. |
| Open a supported store | This store or page isn't supported. Open one specific product on a store from the list. |

**Replacing a computer?** Run `/ordering-pin` and pair the new one. **Unpair this device** in settings only forgets the key on this computer, so ask an Admin to remove the old device too. Tell an Admin if a computer is lost.
