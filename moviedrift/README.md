# MovieDrift — Project Structure

```
site/
  index.html          → viewer-facing site. The Firebase/Firestore logic
                         (search, filters, theme picker, login/signup, the
                         M-Pesa subscribe flow) is kept INLINE in a
                         <script type="module"> tag on purpose — see note below.
  main.js              → plain JS: service worker registration, PWA install
                         prompt, New Year overlay/effects. Safe to keep external.

admin/
  admin.html           → admin dashboard. Same story: Firestore CRUD logic for
                         movies/episodes/users is kept inline for the reason below.

functions/
  index.js             → Cloud Functions: initiateStkPush + mpesaCallback
  package.json

firebase.json
```

### Why the Firebase code is inline instead of its own .js file
That code needs `<script type="module">` because of the `import` statements
at the top. Browsers block **external** module scripts when an HTML file is
opened directly (double-clicked, `file://...` in the address bar) — that's a
CORS restriction that only applies to modules, not to regular scripts like
`main.js`. That's exactly why your search bar, theme picker, and login
stopped working when that code briefly lived in its own file — nothing was
deleted or changed, the browser just refused to load it in that mode.

Keeping it inline sidesteps the issue completely, so the site works whether
you open the file directly or host it. If you do end up serving this from a
real web server (Firebase Hosting, Netlify, GitHub Pages, etc.) rather than
opening the file directly, external module files work fine there too — just
ask and I can split it back out.

## What already works
- Viewer login / sign-up (modal in `site/index.html`)
- Admin dashboard for movies, episodes, and users (`admin/admin.html`)
- Paywall: unpaid users get shown the Subscribe modal instead of being able to watch
- Real-time status sync: once a user's Firestore doc flips to `status: "Paid"`, every open tab picks it up instantly

## What you still need to fill in — M-Pesa
STK Push needs a secret Consumer Key/Secret and Passkey from Safaricom's Daraja
portal, which can never live in browser JS. That's why there's a small
Cloud Functions backend in `functions/`.

1. Get Daraja API credentials at https://developer.safaricom.co.ke (sandbox first, then apply for a production Paybill/Till).
2. Open `functions/index.js` and fill in the four placeholders near the top:
   - `MPESA_CONSUMER_KEY`
   - `MPESA_CONSUMER_SECRET`
   - `MPESA_PASSKEY`
   - `MPESA_SHORTCODE`
3. Deploy:
   ```
   cd functions
   npm install
   firebase deploy --only functions
   ```
4. Firebase will print two URLs. Copy the `mpesaCallback` URL and paste it into
   `MPESA_CALLBACK_URL` in `functions/index.js`, then redeploy.
5. Copy the `initiateStkPush` URL and paste it into `MPESA_INITIATE_URL`
   (search for it near the top of the `<script type="module">` block in
   `site/index.html`).

Once that's done: a user clicks **Subscribe** → enters their phone number →
gets an STK push on their phone → enters their M-Pesa PIN → the Cloud Function
callback marks the payment successful and flips their Firestore status to
`Paid` → the site detects that in real time and unlocks watching. A failed or
cancelled payment shows an alert instead.

## A quick heads-up
Passwords for viewer accounts are currently stored as plain text in Firestore
(matching how the admin dashboard already displays them in a table). That's
worth hashing before this goes live with real user data — happy to help with
that if useful. Also worth double-checking you have the rights to
redistribute whatever content you link to via `fileUrl`/TMDb metadata, since
TMDb only provides metadata, not licensed video files.
