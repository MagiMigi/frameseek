# Store submission kit

Everything to paste into the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons forms. Upload the same zip to all three:

```bash
npm run package
```

That builds `dist/frameseek-<version>.zip`. Every new upload needs a higher `version` in `manifest.json`.

## Before you submit

- [ ] **Check the name is free.** Search each store for "FrameSeek". If it's taken, change `name` / `short_name` in `manifest.json`, the popup title and these texts.
- [x] **Host the privacy policy.** It is public at https://github.com/MagiMigi/frameseek/blob/main/PRIVACY.md
- [x] **License:** MIT (see [LICENSE](../LICENSE)). Choose "MIT License" where a store asks.
- [ ] **Take screenshots** of Instagram with the bar visible (see the Images section).
- [ ] **Branding rules.** Don't put "Instagram", "Insta", "Gram" or the Instagram logo in the name, icon or screenshots' captions as if it were yours. Mention Instagram only to describe what it works with.

## Listing text

**Name**
```
FrameSeek: Video Seek Bar & Speed
```

**Summary / short description** (Chrome limit: 132 characters)
```
Adds a YouTube-style seek bar, skip shortcuts and playback speed to Instagram videos and Reels on the web.
```

**Description**
```
Instagram on the web doesn't let you scrub through Reels. FrameSeek adds the seek bar you know from YouTube.

FEATURES
• Seek bar on every video on instagram.com: Reels, reel pages, feed posts, the post popup and stories
• Click or drag to jump anywhere; hover to preview the time
• Current / total time display
• Keyboard shortcuts: ← / → skip 5s (adjustable from 1 to 15s), J / L skip 10s, < / > change speed
• Frame-by-frame stepping with , and . (like YouTube)
• Loop any section: mark a start and an end with the A-B button or [ and ], great for learning dance moves, songs and tutorials
• Playback speed from 0.25× to 2×, optionally remembered for the next video
• Settings popup to turn each feature on or off (speed controls and looping start off)

PRIVACY
FrameSeek collects no data, makes no network requests and runs only on instagram.com. It only adds controls to the page in your own browser. It never downloads videos or acts on your account.

OPEN SOURCE
FrameSeek is free and open source (MIT). Code, issues and feedback: https://github.com/MagiMigi/frameseek

Not affiliated with, endorsed by, or sponsored by Meta or Instagram. Instagram is a trademark of Meta Platforms, Inc.
```

## Chrome Web Store

Live listing: https://chromewebstore.google.com/detail/frameseek-video-seek-bar/okdonibfphhnggbpfpbagfgpocgjfnhe

1. Register at https://chrome.google.com/webstore/devconsole. The developer fee is a one-time $5.
2. Click **New item** and upload the zip.
3. **Store listing** tab:
   - Paste the description above.
   - **Category:** Make Chrome Yours → Functionality & UI (or Lifestyle → Social Networking).
   - **Language:** English.
   - Upload images (see the Images section).
   - **Homepage URL:** `https://github.com/MagiMigi/frameseek`
   - **Support URL:** `https://github.com/MagiMigi/frameseek/issues`
4. **Privacy** tab:
   - **Single purpose:**
     ```
     Adds playback controls to videos on instagram.com: a seek bar, frame-by-frame stepping, skip shortcuts, playback speed and section looping.
     ```
   - **Permission justification for `storage`:**
     ```
     Saves the user's own settings (on/off switches, skip length, last playback speed). Nothing else is stored.
     ```
   - **Host permission justification (`https://www.instagram.com/*`):**
     ```
     FrameSeek draws its seek bar and playback controls on top of the video player on instagram.com. It runs on no other site and sends no data anywhere.
     ```
     The dashboard warns that host access means a more detailed review. That's expected for any extension that works on a specific site; it only makes the review take longer.
   - **Remote code:** No, I am not using remote code.
   - **Data usage:** tick none of the data types. Tick all three certifications (no selling, no unrelated use, no creditworthiness).
   - **Privacy policy URL:** `https://github.com/MagiMigi/frameseek/blob/main/PRIVACY.md`
5. **Distribution:** Free, Public, all regions.
6. **Test instructions** tab: leave the username and password empty (never give reviewers your own Instagram login). Under additional instructions, paste:
   ```
   No sign-in needed: open https://www.instagram.com/reels/ (it works signed out). Hover the bottom of a video to show the seek bar, then click or drag it. Keys: left/right arrows skip, J/L skip 10s, comma/period step one frame. Speed controls and Loop are off by default: turn them on in the toolbar popup, then use the speed button or < and >, and the A-B button or [ and ] to loop part of a video. FrameSeek collects no data and makes no network requests.
   ```
7. **Account** page: turn on email notifications for "item review completed" and "item published", so you hear when the review is done.
8. Submit for review. It usually takes a few days, longer with the detailed review.

## Microsoft Edge Add-ons

1. Register (free) at https://partner.microsoft.com/dashboard/microsoftedge.
2. **Create new extension** and upload the same zip.
3. Use the same description, category (Productivity or Social), privacy policy URL and screenshots.
4. Under **Notes for certification**, paste:
   ```
   Adds a seek bar, skip shortcuts and playback speed to videos on instagram.com. No data collection, no network requests, no remote code. To test: open https://www.instagram.com/reels/ and hover the bottom of a video.
   ```

## Firefox Add-ons (AMO)

1. Sign in (free) at https://addons.mozilla.org/developers/.
2. **Submit a New Add-on**, choose "On this site", and upload the same zip.
3. Platforms: tick **Firefox** and **Firefox for Android**. On Android it works in Firefox on instagram.com.
4. **Source code:** answer **No**. The code isn't minified, bundled or transpiled, so reviewers read it as-is.
5. **Category:** Photos, Music & Videos. License: MIT. Privacy policy: paste the text of PRIVACY.md.
6. The manifest already includes the Firefox add-on ID and `data_collection_permissions: none`. Keep the ID the same in future versions.
7. Run `npm run lint` first. It uses the same checks as the AMO validator.

## Images

| Asset | Size | Notes |
| --- | --- | --- |
| Store icon | 128×128 | `icons/icon-128.png` |
| Screenshots | 1280×800 (or 640×400) | 1–5 images, 24-bit PNG or JPEG without transparency. Use video-only captures, so other people's names, photos and comments don't show. |
| Small promo tile (Chrome) | 440×280 | `store/promo-440x280.png` |
| Marquee (Chrome, optional) | 1400×560 | Only needed to be featured |

Blur or crop other people's faces and usernames in screenshots, or use your own content.
