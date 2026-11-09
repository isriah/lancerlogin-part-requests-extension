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

## Express addition (optional)

If you order often, turn on **Express addition** in settings. It's off until you turn it on. Save your team and Notion name first, because it needs both.

With it on, click the extension on a product page and the request is sent right away when everything was filled in from the page. It always sends **quantity 1** as a NORMAL request. You can close the popup while it sends.

If anything needs checking, nothing is sent and you get the form with the reason at the top. Fix what it lists and click **Create request**. A repeat from the last 7 days counts as needing a check, because nobody has looked at the page yet.

There's no undo. To change a request, or to ask for more than 1, click **Open in Notion to review** and change it there. To remove one, delete the page in Notion or ask your coach.

Clicking the extension again on a page you already sent shows that request and never sends it twice. Use **New request** only if you really want another one.

## Carts (optional)

Carts helps whoever places orders. It lists your team's open orders by store and adds the ones you tick to each store's cart. No AI places your orders. This extension doesn't use AI. It only helps add items to a store's cart, after you click Build carts. You review the cart and place every order yourself on the store's own site.

1. In **Settings**, turn on **Carts**. Chrome asks to use the stores' sites. Choose **Allow**, or say no and use it as a checklist.
2. Click **Carts** in the extension's popup, or **Open Carts** in Settings.
3. Check the ticks. NORMAL and RUSH start ticked. SLOW and Incomplete don't. If a row says **Can't add yet**, fix what it names in Notion. If it says **Already in someone's cart**, ask them first.
4. Click **Build carts** and keep that tab open. It goes one item at a time, so it takes a little while.
5. Read the results for each store, then open each cart and check it. **Flagged** means it's in the cart but needs a look. **Failed** means it isn't in the cart. **Add these yourself** means nothing was tried, so use the links.

If a store asks you to sign in or shows a robot check, Carts stops there and gives you the links. Sign in on the store's site and build again, because a second build only adds what's missing. Marking an order as ordered still happens in Notion.

## Light mode

The extension starts dark. Use the **Light mode** switch at the top of settings to change it. Once you pair, it uses your team's name and colors.

## If something goes wrong

| You see | Do this |
|---|---|
| Pair this device again | An Admin removed this device or you left the roster. Run `/ordering-pin` again and pair in settings. Your drafts are kept. |
| That PIN does not work | Run `/ordering-pin` again and use the newest PIN. |
| You chose Deny | Click **Pair this device** again and choose **Allow**. |
| You already have 5 paired devices | Click **Unpair this device** on one you still have, or ask an Admin to remove one. |
| Update available | Your extension is older than your team's site asks for. It keeps working. Follow the link, or ask your team for the new zip, when you have a moment. |
| Unpaired on this computer, and an Admin may need to remove it | The site couldn't be reached or didn't accept the key. If `/ordering-pin` says you have too many devices, ask an Admin to remove this one. |
| The site is updating | Wait. It tries again by itself. |
| **Check Notion before retrying** or **Not sure it was created** | Your request may already exist, and it won't be sent again by itself. Click **Check ordering database** to look first. Only if it isn't there, tick the box and retry. |
| Not sent yet. This needs your review | Express addition stopped before sending. Do what the list says, then click **Create request**. If it says to select options, you can select them on the store page and click the extension again. |
| Your name isn't in the list | Ask an Admin to refresh the recipient list. |
| Open a supported store | This store or page isn't supported. Open one specific product on a store from the list. |

**Replacing a computer?** On the old one, click **Unpair this device** in settings, which removes it from your team's site and frees one of your 5 device slots. Then run `/ordering-pin` and pair the new one. Tell an Admin if a computer is lost, because only an Admin can remove a device you no longer have.
