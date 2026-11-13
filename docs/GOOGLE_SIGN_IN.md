# Sign in with Google: setup (about 10 minutes)

The code is ready on the website and in the Android app. It stays **hidden until the server has a Google client id**,
so nothing breaks before you finish these steps.

## How it works (for the defense)

1. The person taps **Continue with Google** (website: Google's button; Android: Credential Manager account sheet).
2. Google checks their password (SkillSwap never sees it) and returns an **ID token**: a short document *signed by Google*
   saying "this is user `sub` with email `x`, issued for client id `Y`".
3. The page / app sends the token to our server (`POST /api/auth/google` for the website, `POST /api/mobile/google` for the app).
4. `src/google.js` verifies Google's signature and that the token is for **our** client id (`google-auth-library`).
   Unverified emails are refused.
5. The account is found by `users.google_sub`, else by the same verified email (then Google is linked to it),
   else a new account is created (no password, `password_hash` = NULL) with a profile and 5 welcome credits.
   All in one transaction. Then the normal session starts (cookie for the website, bearer token for the app).

One web client id is used for both: the Android app asks Google for a token *for the web client id* (`serverClientId`).

## 1. Google Cloud project

1. Open https://console.cloud.google.com and create a project, e.g. **SkillSwap**.
2. **Google Auth Platform → Branding** (the consent screen): app name *SkillSwap*, your support email, developer email. Save.
3. **Audience**: *External*. While the app is in **Testing**, only the **test users** you add here can sign in.
   Add your team's Gmail addresses (and your professor's for the demo), or press *Publish app*.

## 2. Web client (website + server)

1. **Clients → Create client → Web application**, name *SkillSwap web*.
2. **Authorized JavaScript origins**:
   - `https://skillswap-vqt7.onrender.com`
   - `http://localhost:3000` and `http://localhost` (for local testing)
3. No redirect URI is needed (the button uses a popup). Create, and copy the **Client ID**
   (`....apps.googleusercontent.com`).
4. Render → your service → **Environment** → add `GOOGLE_CLIENT_ID` = that id → Save (it redeploys).
   Locally: put the same line into `.env`.

## 3. Android client (the app)

The Android client is never typed into the code; Google only needs it to recognise the app.

1. Get the SHA-1 fingerprint of the key that signs the app. In Android Studio's Terminal:
   ```
   keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
   ```
   (Debug *and* the current release builds are signed with this debug key. For the final APK signed with your own
   keystore, run the same command on that `.jks` file and add a second Android client with its SHA-1.)
2. **Clients → Create client → Android**: package name `uz.skillswap.app`, paste the **SHA-1**. Create.
3. Done. The app asks the server for the web client id (`GET /api/mobile/config`), so no rebuild is needed when it changes.

## Check

- Website: open `/login`. The Google button appears above the form.
- App: the login screen shows **Continue with Google**.
- An existing email/password account that signs in with the same Gmail address is linked, not duplicated.

Common errors: *"origin not allowed"* → the site address is missing from step 2.2.
On Android *"No credentials available"* / *"developer console is not set up correctly"* → wrong package name or SHA-1 in step 3,
or the Google account is not a test user (step 1.3).
