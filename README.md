# 🤖 Threads Bot Detector (AI Edition)

A powerful Chrome Extension to audit Threads followers and detect bots, fake accounts, and farmers using Rule-based logic, Google Gemini AI, or Puter.js.

![Version](https://img.shields.io/badge/Version-2.4-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Key Features

### 🧠 Dual AI Analysis Engines
* **Google Gemini (Cloud):** Connects directly to Google's API. Fast, reliable, and supports the latest **Gemini 2.0 Flash** & **2.5 Pro** models. (Requires a free API Key).
* **Puter.js (Free / Hybrid):** A unique integration that lets you use premium models like **GPT-5-nano**, **GPT-4o**, and **Claude 3.5 Sonnet** for free via the Puter.com infrastructure. No API key required!

### 🛡️ Advanced Security & Privacy
* **Smart Proxy Manager:**
    * **Auto-Fill Free Proxy:** One-click fetcher that grabs fresh SOCKS5 proxies from multiple reliable sources.
    * **Manual / VPN Support:** Compatible with SOCKS5 credentials from premium providers like **NordVPN** or **WebShare**.
    * **Smart Routing (PAC):** Automatically routes *only* Threads and Instagram traffic through the proxy. AI analysis requests (Google/Puter) bypass the proxy to ensure speed and stability.
* **Privacy Mode:** Blurs sensitive data (avatars, usernames, bio text) instantly for safe screenshots or streaming.

### ⚡ Workflow Tools
* **Batch Extraction:** Scrape hundreds of followers from any Threads profile in seconds.
* **Risk-Sorted Export:** Export your audit results to **CSV** (Excel-compatible), automatically sorted by Risk Score (Highest to Lowest).
* **"Risk Only" Filter:** Toggle to hide safe accounts and focus only on potential bots.
* **Stop & Resume:** Pause or stop the batch audit process at any time.

### 🕵️‍♂️ "Ruthless" Audit Logic
The AI has been instructed to be **aggressive** ("Guilty until proven innocent"). It flags accounts based on:
* **Low Effort:** No main posts + weak bio = High Risk.
* **Generic Content:** "Life is good" or emoji-only bios are treated as bot scripts.
* **Metadata Analysis:** Checks for default avatars, follower ratios, and account inactivity (>6 months).

---

## 🚀 Installation Guide

Since this is a powerful dev-tool not yet on the Chrome Web Store, you must install it manually.

### 1. Download the Source
Clone this repository or download the ZIP and extract it to a folder.

### 2. ⚠️ Critical Setup Step (Puter.js)
Due to Chrome's security rules (Manifest V3), external scripts cannot be loaded remotely. You must download the Puter library manually:

1.  Go to: **[https://js.puter.com/v2/](https://js.puter.com/v2/)**
2.  Right-click the page and select **"Save As..."**
3.  Save the file as **`puter.js`** inside the **root folder** of this extension (the same folder where `manifest.json` is located).

### 3. Load into Chrome
1.  Open Chrome and navigate to `chrome://extensions/`.
2.  Toggle **"Developer mode"** in the top right corner.
3.  Click **"Load unpacked"**.
4.  Select the folder containing the extension files.

---

## 📖 How to Use

1.  **Open a Profile:** Navigate to any Threads profile (yours or others).
2.  **Open Followers:** Click on the "Followers" count to open the list modal.
3.  **Extract:** Open the extension sidebar and click **"Extract List"**.
4.  **Configure AI (Settings):**
    * **For Gemini:** Select "Google Gemini", paste your API Key from [Google AI Studio](https://aistudio.google.com/app/apikey), and click Save.
    * **For Puter:** Select "Puter.js". You may need to click the **"Sign In"** button once to authenticate with Puter.
5.  **Start Audit:** Select users (or "Select All") and click **"Audit Selected"**.

---

## ⚙️ Proxy Settings (Optional)

If you are auditing many profiles, Threads might rate-limit your IP. Use the Proxy Manager to avoid this.

1.  Click the **Settings Gear (⚙️)** icon in the top right.
2.  **Auto Mode:** Click **"🪄 Get Free Proxy"**. The extension will find a working SOCKS5 proxy and apply it automatically.
3.  **Manual Mode:** Check "Enable Proxy" and enter your Host, Port, Username, and Password (if using a paid proxy).
4.  **Note:** The extension uses a PAC script. Your AI traffic (Gemini/Puter) will **NOT** go through the proxy to save bandwidth and avoid latency.

---

## 🛡️ Data Privacy

* **Local Storage:** All scraped data and audit results are stored locally in your browser (`chrome.storage.local`).
* **No Tracking:** This extension includes no analytics or tracking scripts.
* **Direct Connection:** AI requests are sent directly from your browser to the AI provider (Google or Puter). No middleman servers are used.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Disclaimer: This project is an independent tool and is not affiliated with, endorsed by, or sponsored by Threads, Meta Platforms, Inc., Google, or Puter.*