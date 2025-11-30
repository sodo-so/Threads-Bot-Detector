# 🤖 Threads Bot Detector (AI Edition)

A powerful Chrome Extension to audit Threads followers and detect bots, fake accounts, and farmers using Rule-based logic, Google Gemini AI, Cloudflare Workers AI, Puter.js, or local Ollama models.

![Version](https://img.shields.io/badge/Version-2.5-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Key Features

### 🧠 Quad AI Analysis Engines
* **Google Gemini (Cloud):** Connects directly to Google's API. Fast, reliable, and supports **Gemini 2.5 Flash** & **Pro**. (Requires free API Key).
* **Cloudflare Workers AI:** Run serverless models like **Llama 3.1** and **Mistral** via Cloudflare's global network.
* **Ollama (Local / Private):** Run AI entirely on your own machine. 100% private, free, and unlimited. Supports any model you have pulled (Llama 3, Phi-3, Gemma 2, etc.).
* **Puter.js (Free / Hybrid):** Use premium models like **GPT-4o** and **Claude 3.5 Sonnet** for free via Puter.com. No API key required!

### 🛡️ Advanced Security & Privacy
* **Smart Proxy Manager:**
    * **Auto-Fill Free Proxy:** One-click fetcher that grabs fresh SOCKS5 proxies.
    * **Smart Routing (PAC):** Routes *only* Threads/Instagram traffic through the proxy. AI requests bypass the proxy for speed.
* **Privacy Mode:** Blurs sensitive data (avatars, usernames, bio text) instantly for safe screenshots.

### ⚡ Workflow Tools
* **Custom Prompt Editor:** Edit the AI system prompt directly within the extension to customize audit criteria.
* **Batch Extraction:** Scrape hundreds of followers in seconds.
* **Risk-Sorted Export:** Export results to **CSV** or **JSON**.

---

## 🚀 Installation Guide

### 1. Download the Source
Clone this repository or download the ZIP and extract it to a folder.

### 2. ⚠️ Critical Setup Step (Puter.js)
Due to Chrome's security rules (Manifest V3), external scripts cannot be loaded remotely. You must download the Puter library manually:

1.  Go to: **[https://js.puter.com/v2/](https://js.puter.com/v2/)**
2.  Right-click the page and select **"Save As..."**
3.  Save the file as **`puter.js`** inside the **root folder** of this extension (where `manifest.json` is).

### 3. Load into Chrome
1.  Open Chrome and navigate to `chrome://extensions/`.
2.  Toggle **"Developer mode"** in the top right.
3.  Click **"Load unpacked"**.
4.  Select the folder containing the extension files.

---

## 🦙 Ollama Setup (Local AI)

To use your own local models (like Llama 3 or Mistral), you must configure Ollama to allow browser requests.

1.  **Install Ollama:** Download from [ollama.com](https://ollama.com).
2.  **Pull a Model:** Run `ollama pull llama3` (or your preferred model) in your terminal.
3.  **⚠️ Important: Fix CORS Issues:**
    By default, Ollama blocks browser extensions. You must set the `OLLAMA_ORIGINS` environment variable.

    * **Mac / Linux:**
        ```bash
        # Stop Ollama first, then run:
        OLLAMA_ORIGINS="*" ollama serve
        ```
    * **Windows (PowerShell):**
        ```powershell
        # Quit Ollama from taskbar first
        $env:OLLAMA_ORIGINS="*"; ollama serve
        ```

4.  **In the Extension:**
    * Go to Settings -> Select **Ollama (Local)**.
    * Click **Refresh (🔄)** to detect your installed models.
    * Click **Save Config**.

---

## 📖 How to Use

1.  **Open a Profile:** Navigate to any Threads profile.
2.  **Open Followers:** Click on the "Followers" count to open the list.
3.  **Extract:** Open the extension and click **"Extract List"**.
4.  **Configure AI:**
    * **Cloud:** Use Google Gemini or Cloudflare keys.
    * **Local:** Use Ollama (see setup above).
    * **Free:** Use Puter.js (requires login).
5.  **Start Audit:** Select users and click **"Audit Selected"**.

---

## 🛡️ Data Privacy

* **Local Storage:** All scraped data is stored locally in your browser.
* **Direct Connection:** AI requests are sent directly from your browser to the AI provider. No middleman servers are used.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.