# Google AdSense setup — everything in one place

Goal: ads on our own website (landing page + guide pages), paid by Google.
The games stay ad-free inside the canvas; ads sit on the pages around them
(Google requires at least 150 px between an ad and a game).

Facts that decide the plan:

- AdSense only accepts a **root domain you own** (example: `handfighter.com`).
  It refuses `qw4hd2.github.io` because that is a subdomain of GitHub's domain.
  So step 1 is buying a domain — about $10 per year.
- Approval takes a few days up to 2–4 weeks. Google reviews the site for
  "sufficient original content", working pages, a privacy policy, and a real
  contact address.
- You must be 18+, and the payment address must match your ID. Google mails a
  PIN to that address once earnings reach $10. Payouts start at $100.

---

## Step 1 — Buy a domain (you, 10 minutes)

1. Go to one registrar: **porkbun.com** (cheapest, simple) or **namecheap.com**
   or **cloudflare.com** → Domain Registration.
2. Search a short `.com` name. Ideas: `handfightergame.com`, `playhandfighter.com`,
   `handfighter.games`, `doodlegames.fun`. Avoid hyphens and numbers.
3. Buy it for 1 year. Turn on **WHOIS privacy** (free at all three).
4. Send me the exact domain name. I will connect it to the site.

## Step 2 — Point the domain at the website (you, 5 minutes; me, 2 minutes)

In the registrar's **DNS** settings for the domain, add these records
(delete any default "parking" A/CNAME records first):

| Type  | Name | Value                  |
|-------|------|------------------------|
| A     | @    | 185.199.108.153        |
| A     | @    | 185.199.109.153        |
| A     | @    | 185.199.110.153        |
| A     | @    | 185.199.111.153        |
| CNAME | www  | qw4hd2.github.io       |

Then tell me it is done. I will add the domain to the repository (a `CNAME`
file) and enable **Enforce HTTPS** in GitHub → repo `hand-fighter` → Settings
→ Pages → Custom domain. After that the site answers at
`https://yourdomain.com` (the old github.io address keeps working and
redirects).

## Step 3 — Create the AdSense account (you, 10 minutes)

1. Open **https://adsense.google.com** and sign in with your Google account.
2. Click **Get started**.
   - Your site: `https://yourdomain.com` (no `www`, no path).
   - Email preferences: your choice.
   - Country: your country of residence (this cannot be changed later, and
     it must match your ID and bank).
3. Accept the terms. You land on the AdSense home page with three tasks:
   **Payments**, **Ads**, **Sites**.

## Step 4 — Payments info (you, 5 minutes)

- Enter your **legal name and postal address** exactly as on your ID.
  Google will mail a paper PIN to this address later; you must type it in
  within 4 months or ads stop.
- Bank details are asked only after you reach $100. Tax info: fill in the
  form when it appears (most non-US publishers just declare no US activity).

## Step 5 — Connect the site (you 2 minutes, me 5 minutes)

1. In AdSense → **Sites** → **Add site** → enter the domain → **Save**.
2. AdSense shows an **AdSense code snippet** like this:

   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"
        crossorigin="anonymous"></script>
   ```

   Copy the whole line **or just the `ca-pub-…` number** and send it to me.
3. I add it to every content page, fill in `ads.txt`
   (`google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0`), and push.
4. Back in AdSense, tick **"I've placed the code"** → **Verify** → then
   **Request review**.

## Step 6 — Wait for the review (Google, days to a few weeks)

Status shows under Sites as **Getting ready** → **Ready** (approved) or
**Needs attention** (rejected, with a reason). If rejected, send me the reason
text; the usual fixes are more content pages or removing placeholder text.
Do not click your own ads, ever — that closes accounts permanently.

## Step 7 — Turn ads on (after approval; you 2 minutes, me 5 minutes)

1. AdSense → **Ads** → **By site** → your domain → **Edit** → turn on
   **Auto ads** → Apply. This alone starts showing ads on the landing and
   guide pages within an hour.
2. Optional, better revenue: AdSense → **Ads** → **By ad unit** → **Display ads**
   → name it `landing-top`, responsive → Create → send me the `data-ad-slot`
   number. I put manual units in the two prepared ad spots on the landing page
   and one under each guide article.

## Step 8 — Consent message for Europe (you, 3 minutes)

AdSense → **Privacy & messaging** → **European regulations** → **Create
message** → choose the default look → **Publish**. Google injects the consent
popup automatically through the same script; nothing else to install.
Without it, ads are not served to visitors in the EU/UK.

---

## What is already prepared in the site

- Privacy policy with the AdSense/cookie disclosure (privacy.html).
- About, Contact and three guide pages with real content (Google's reviewers
  reject sites that are "only a game plus a menu").
- Two ad spots on the landing page (`.ad-slot`) placed away from the games.
- `ads.txt` placeholder at the site root.
- The AdSense script placeholder is in the `<head>` of every content page,
  ready for your `ca-pub` ID.

## What you still need to send me

1. The domain name you bought.
2. The `ca-pub-…` ID from AdSense.
3. The public contact email to show on the site (contact.html still says
   `hello@example.com`, which reviewers dislike).
