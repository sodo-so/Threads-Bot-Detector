let extractedUsers = [];
let auditCache = {};
let geminiKey = null;
let aiProvider = "disabled";
let currentLang = "en";
let translations = {};
let isRiskFilter = false;
let isAuditing = false;
let stopAuditRequested = false;
let puterSignedIn = false;
let puterLibraryLoaded = false;
let skippedUsers = new Set();
let isExtracting = false;

// PROXY SOURCES
const PROXY_SOURCES = [
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
    "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt"
];

// --- CSS INJECTION (Responsive & Privacy) ---
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  .row.skipped { background: #f5f5f5 !important; opacity: 0.6; }
  .row.skipped .row-name { text-decoration: line-through; color: #aaa; font-style: italic; }
  
  /* Privacy Filters */
  #inspector.privacy-blur .ins-img, 
  #inspector.privacy-blur .ins-header div, 
  #inspector.privacy-blur .ins-bio, 
  #inspector.privacy-blur .ins-post-main > div:last-child, 
  #inspector.privacy-blur .reply-card,
  #inspector.privacy-blur .ins-stats
  { filter: blur(3px) !important; user-select: none; }

  #inspector.privacy-visible .ins-img, 
  #inspector.privacy-visible .ins-header div, 
  #inspector.privacy-visible .ins-bio, 
  #inspector.privacy-visible .ins-post-main > div:last-child, 
  #inspector.privacy-visible .reply-card,
  #inspector.privacy-visible .ins-stats
  { filter: none !important; user-select: text; }

  /* Responsive Header Layout */
  .ins-header {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      margin-bottom: 12px;
  }
  
  .ins-user-wrapper {
      display: flex;
      align-items: center;
      flex: 1 1 auto;
      min-width: 140px;
      margin-right: 4px;
      overflow: hidden;
      text-decoration: none; 
      color: inherit; 
      cursor: pointer;
  }
  .ins-user-wrapper:hover { opacity: 0.8; }

  .ins-action-wrapper {
      display: flex;
      gap: 6px;
      flex: 0 0 auto;
      margin-left: auto;
  }
`;
document.head.appendChild(styleSheet);

// --- LOCALIZATION ---
async function loadLanguage(lang) {
    try {
        const url = chrome.runtime.getURL(`locales/${lang}.json`);
        const res = await fetch(url);
        translations = await res.json();
        updateUILanguage();
    } catch (e) {
        if (lang !== 'en') loadLanguage('en');
    }
}

function t(key) {
    return translations[key] || key;
}

function updateUILanguage() {
    // 1. Text Content
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[key]) el.innerText = translations[key];
    });

    // 2. Placeholders
    document.querySelectorAll("[data-i18n-ph]").forEach(el => {
        const key = el.getAttribute("data-i18n-ph");
        if (translations[key]) el.placeholder = translations[key];
    });

    // 3. Dynamic Elements
    if (document.getElementById("universalInput")) {
        document.getElementById("universalInput").placeholder = t("universalPh");
    }
    
    if (isAuditing) {
        const auditBtn = document.getElementById("auditBtn");
        if(auditBtn) auditBtn.innerText = stopAuditRequested ? t("stopping") : t("stopAudit");
    }

    const puterLogin = document.getElementById("puterLoginBtn");
    if (puterLogin) puterLogin.innerText = t("btnSignInPuter");

    const debugBtn = document.getElementById("showDebugBtn");
    if (debugBtn) debugBtn.innerText = t("viewDebug");

    const clearBtn = document.getElementById("clearListBtn");
    if (clearBtn) clearBtn.title = t("clearList");

    const batchRemoveBtn = document.getElementById("batchRemoveBtn");
    if (batchRemoveBtn) batchRemoveBtn.title = t("batchRemoveTitle");

    // 4. Live Refresh of Tags
    if (typeof renderList === "function" && extractedUsers.length > 0) {
        renderList(extractedUsers);
    }
}

const langSelector = document.getElementById("langSelector");
if(langSelector) {
    langSelector.addEventListener("change", (e) => {
        currentLang = e.target.value;
        chrome.storage.local.set({ "ui_lang": currentLang });
        loadLanguage(currentLang);
    });
}

// --- DIALOG HELPERS ---
function showConfirm(message, yesText = "OK", noText = "Cancel") {
    return new Promise((resolve) => {
        const dialog = document.getElementById("appDialog");
        const textEl = document.getElementById("dialogText");
        const okBtn = document.getElementById("dialogOkBtn");
        const cancelBtn = document.getElementById("dialogCancelBtn");

        textEl.innerText = message;
        okBtn.innerText = yesText;
        cancelBtn.innerText = noText;
        cancelBtn.style.display = "block";

        const cleanup = () => {
            okBtn.removeEventListener("click", handleOk);
            cancelBtn.removeEventListener("click", handleCancel);
            dialog.close();
        };

        const handleOk = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };

        okBtn.addEventListener("click", handleOk);
        cancelBtn.addEventListener("click", handleCancel);
        dialog.showModal();
    });
}

function showAlert(message) {
    const dialog = document.getElementById("appDialog");
    const textEl = document.getElementById("dialogText");
    const okBtn = document.getElementById("dialogOkBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    textEl.innerText = message;
    okBtn.innerText = t("btnOk") !== "btnOk" ? t("btnOk") : "OK";
    cancelBtn.style.display = "none";

    const handleOk = () => {
        okBtn.removeEventListener("click", handleOk);
        dialog.close();
    };

    okBtn.addEventListener("click", handleOk);
    dialog.showModal();
}

// --- UI HELPER ---
function toggleUI(show) {
    const display = show ? "block" : "none";
    const flexDisplay = show ? "flex" : "none";
    if(document.getElementById("auditBtn")) document.getElementById("auditBtn").style.display = display;
    if(document.getElementById("statsRow")) document.getElementById("statsRow").style.display = flexDisplay;
}

// --- INIT (Async to wait for Lang) ---
chrome.storage.local.get(["audit_db", "enc_api_key", "ai_provider", "cloud_model_id", "puter_model_id", "saved_users", "skipped_users", "ui_lang", "proxy_config", "privacy_mode"], async (data) => {
    auditCache = data.audit_db || {};
    
    // 1. Load Language FIRST
    if (data.ui_lang) {
        currentLang = data.ui_lang;
        const ls = document.getElementById("langSelector");
        if(ls) ls.value = currentLang;
    }
    await loadLanguage(currentLang);

    if (data.skipped_users) {
        skippedUsers = new Set(data.skipped_users);
    }

    // 2. Render List AFTER Lang
    if (data.saved_users && Array.isArray(data.saved_users)) {
        extractedUsers = data.saved_users;
        renderList(extractedUsers);
        if (extractedUsers.length > 0) {
            toggleUI(true);
            updateCount();
        }
    }
    if (data.cloud_model_id && document.getElementById("cloudModelSelector")) document.getElementById("cloudModelSelector").value = data.cloud_model_id;
    if (data.puter_model_id && document.getElementById("puterModelSelector")) document.getElementById("puterModelSelector").value = data.puter_model_id;

    if (data.ai_provider) {
        aiProvider = (data.ai_provider === "chrome") ? "disabled" : data.ai_provider;
        if(document.getElementById("aiProviderSelector")) document.getElementById("aiProviderSelector").value = aiProvider;
        if (aiProvider === "puter") ensurePuterLoaded();
    }

    if (data.enc_api_key) {
        try { geminiKey = atob(data.enc_api_key); } catch (e) {}
    }

    if (typeof puter !== 'undefined') checkPuterLogin();
    updateAIUI();

    if (data.proxy_config) {
        const p = data.proxy_config;
        if(document.getElementById("proxyEnabled")) document.getElementById("proxyEnabled").checked = p.enabled;
        if(document.getElementById("proxyProto")) document.getElementById("proxyProto").value = p.proto || "SOCKS5";
        if(document.getElementById("proxyHost")) document.getElementById("proxyHost").value = p.host || "";
        if(document.getElementById("proxyPort")) document.getElementById("proxyPort").value = p.port || "";
        if(document.getElementById("proxyUser")) document.getElementById("proxyUser").value = p.user || "";
        if(document.getElementById("proxyPass")) document.getElementById("proxyPass").value = p.pass || "";
        toggleProxyInputs(p.enabled);
    }
    if (data.privacy_mode) {
        document.body.classList.add("privacy-mode");
        if(document.getElementById("privacyCheck")) document.getElementById("privacyCheck").checked = true;
    }
});

// --- PUTER LOADER ---
function ensurePuterLoaded() {
    if (typeof puter !== 'undefined' || puterLibraryLoaded) {
        checkPuterLogin();
        populatePuterModels();
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'puter.js';
        script.onload = () => {
            puterLibraryLoaded = true;
            checkPuterLogin();
            populatePuterModels();
            resolve();
        };
        script.onerror = () => {
            showToast(t("puterLoadFail"));
            reject(new Error("Script load error"));
        };
        document.head.appendChild(script);
    });
}

// --- MODEL FETCHERS ---
async function populatePuterModels() {
    if (typeof puter === 'undefined') return;
    try {
        let models = [];
        try { models = await puter.ai.listModels(); } catch (e) {}
        if (!models || models.length === 0) {
            models = ["gpt-5-nano", "gpt-4o-mini", "gpt-4o", "claude-3-5-sonnet", "gemini-2.0-flash", "mistral-large-latest", "deepseek-chat"];
        }
        const selector = document.getElementById("puterModelSelector");
        if(!selector) return;
        const currentVal = selector.value;
        selector.innerHTML = "";
        models.forEach(m => {
            const opt = document.createElement("option");
            const val = typeof m === 'string' ? m : m.id;
            opt.value = val;
            opt.innerText = val;
            if (val === currentVal) opt.selected = true;
            selector.appendChild(opt);
        });
    } catch (e) { console.error("Puter Model List Error", e); }
}

async function populateGeminiModels() {
    if (!geminiKey) { showToast(t("enterKey")); return; }
    const btn = document.getElementById("refreshGeminiBtn");
    btn.innerText = "...";
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        const selector = document.getElementById("cloudModelSelector");
        selector.innerHTML = "";
        const validModels = data.models.filter(m => {
            const name = m.name.toLowerCase();
            return (name.includes("gemini-2.5") || name.includes("gemini-3") || name.includes("gemini-2.0") || name.includes("gemini-1.5")) &&
                m.supportedGenerationMethods && m.supportedGenerationMethods.some(method => method.includes("generateContent"));
        });
        validModels.sort((a, b) => b.name.localeCompare(a.name));
        validModels.forEach(m => {
            const name = m.name.replace("models/", "");
            const opt = document.createElement("option");
            opt.value = name;
            opt.innerText = m.displayName || name;
            selector.appendChild(opt);
        });
        showToast(t("modelsUpdated"));
    } catch (e) { showToast(t("fetchFailed")); } finally { btn.innerText = "🔄"; }
}

if(document.getElementById("refreshGeminiBtn")) {
    document.getElementById("refreshGeminiBtn").addEventListener("click", populateGeminiModels);
}

// --- SETTINGS UI ---
if(document.getElementById("settingsToggleBtn")) {
    document.getElementById("settingsToggleBtn").addEventListener("click", () => document.getElementById("settingsMenu").classList.toggle("show"));
}
if(document.getElementById("closeSettingsBtn")) {
    document.getElementById("closeSettingsBtn").addEventListener("click", () => document.getElementById("settingsMenu").classList.remove("show"));
}
if(document.getElementById("privacyCheck")) {
    document.getElementById("privacyCheck").addEventListener("change", (e) => {
        const isPrivacy = e.target.checked;
        if (isPrivacy) document.body.classList.add("privacy-mode");
        else document.body.classList.remove("privacy-mode");
        chrome.storage.local.set({ "privacy_mode": isPrivacy });
    });
}

// --- PROXY ---
const proxyEnabledCheck = document.getElementById("proxyEnabled");
const proxyInputsDiv = document.getElementById("proxyInputs");
function toggleProxyInputs(enabled) { if(proxyInputsDiv) proxyInputsDiv.style.display = enabled ? "block" : "none"; }

if(proxyEnabledCheck) {
    proxyEnabledCheck.addEventListener("change", (e) => { toggleProxyInputs(e.target.checked); if (!e.target.checked) saveProxySettings(); });
}
if(document.getElementById("saveProxyBtn")) {
    document.getElementById("saveProxyBtn").addEventListener("click", saveProxySettings);
}

if(document.getElementById("fetchProxyBtn")) {
    document.getElementById("fetchProxyBtn").addEventListener("click", async () => {
        const btn = document.getElementById("fetchProxyBtn");
        const originalText = btn.innerText;
        btn.innerText = t("fetching");
        btn.disabled = true;
        let foundProxy = null;
        for (const sourceUrl of PROXY_SOURCES) {
            try {
                const response = await fetch(sourceUrl);
                if (!response.ok) continue;
                const text = await response.text();
                const lines = text.split('\n').filter(line => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(line.trim()));
                if (lines.length > 0) {
                    foundProxy = lines[Math.floor(Math.random() * lines.length)];
                    break;
                }
            } catch (e) { }
        }
        if (foundProxy) {
            const parts = foundProxy.split(":");
            if (parts.length >= 2) {
                document.getElementById("proxyHost").value = parts[0];
                document.getElementById("proxyPort").value = parts[1];
                document.getElementById("proxyProto").value = "SOCKS5";
                document.getElementById("proxyUser").value = "";
                document.getElementById("proxyPass").value = "";
                document.getElementById("proxyEnabled").checked = true;
                toggleProxyInputs(true);
                saveProxySettings();
                showToast(`${t("proxyFetched")} ${parts[0]}`);
            }
        } else { showToast(t("fetchError")); }
        btn.innerText = originalText; btn.disabled = false;
    });
}

function saveProxySettings() {
    const config = {
        enabled: document.getElementById("proxyEnabled").checked,
        proto: document.getElementById("proxyProto").value,
        host: document.getElementById("proxyHost").value.trim(),
        port: document.getElementById("proxyPort").value.trim(),
        user: document.getElementById("proxyUser").value.trim(),
        pass: document.getElementById("proxyPass").value.trim()
    };
    chrome.storage.local.set({ "proxy_config": config }, () => {
        chrome.runtime.sendMessage({ action: "update_proxy", config: config });
        if (config.enabled && config.host) showToast(t("proxySaved"));
        else if (!config.enabled) showToast(t("proxyDisabled"));
    });
}

// --- IMPORT/EXPORT ---
if(document.getElementById("exportBtn")) {
    document.getElementById("exportBtn").addEventListener("click", () => {
        if (extractedUsers.length === 0 && Object.keys(auditCache).length === 0) return showToast(t("nothingExport"));
        const data = { timestamp: new Date().toISOString(), users: extractedUsers, cache: auditCache, skipped: Array.from(skippedUsers) };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `threads-audit-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast(t("exported"));
    });
}

if(document.getElementById("exportCsvBtn")) {
    document.getElementById("exportCsvBtn").addEventListener("click", () => {
        if (Object.keys(auditCache).length === 0 && extractedUsers.length === 0) return showToast(t("nothingExport"));
        let csvContent = "\uFEFFUsername,Risk Score,Risk Level,Profile URL,Last Audit,AI/Rules Note\n";
        const allUsers = Array.from(new Set([...extractedUsers, ...Object.keys(auditCache)]));
        const exportData = allUsers.map(user => {
            const data = auditCache[user];
            const isSkipped = skippedUsers.has(user);
            let riskLevel = "N/A";
            let riskScore = 0;
            
            if (isSkipped) { 
                riskLevel = "SKIPPED"; riskScore = ""; 
            } else if (data) {
                if (data.manualChecked) {
                    riskLevel = "CHECKED"; riskScore = data.score; 
                } else {
                    riskScore = data.score || 0; 
                    riskLevel = data.score >= 40 ? "HIGH" : "LOW"; 
                }
            }
            return {
                user: user, score: riskScore, risk: riskLevel, link: `https://www.threads.com/@${user}`,
                ai_reason: (data && data.checklist) ? data.checklist.filter(c => typeof c === 'string' ? c.includes("AI") : c.special).map(c => typeof c === 'string' ? c : c.special).join("; ") : "",
                date: data ? new Date().toLocaleDateString() : "Pending"
            };
        });
        exportData.sort((a, b) => {
            if (a.risk === "SKIPPED" && b.risk !== "SKIPPED") return 1;
            if (a.risk !== "SKIPPED" && b.risk === "SKIPPED") return -1;
            if (b.score !== a.score) return b.score - a.score;
            return a.user.localeCompare(b.user);
        });
        exportData.forEach(row => {
            const safeReason = `"${row.ai_reason.replace(/"/g, '""')}"`;
            csvContent += `${row.user},${row.score},${row.risk},${row.link},${row.date},${safeReason}\n`;
        });
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `threads-audit-report-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast(t("exported"));
    });
}

if(document.getElementById("importBtn")) {
    document.getElementById("importBtn").addEventListener("click", () => { document.getElementById("importFileInput").click(); });
}

if(document.getElementById("importFileInput")) {
    document.getElementById("importFileInput").addEventListener("change", (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                const hasData = extractedUsers.length > 0 || Object.keys(auditCache).length > 0;
                let doMerge = false;
                if (hasData) { doMerge = await showConfirm(t("importPrompt"), t("btnMerge"), t("btnOverwrite")); }
                if (doMerge) {
                    if (json.users) extractedUsers = Array.from(new Set([...extractedUsers, ...json.users]));
                    if (json.cache) auditCache = { ...auditCache, ...json.cache };
                    if (json.skipped && Array.isArray(json.skipped)) json.skipped.forEach(u => skippedUsers.add(u));
                } else {
                    extractedUsers = json.users || [];
                    auditCache = json.cache || {};
                    if (json.skipped && Array.isArray(json.skipped)) skippedUsers = new Set(json.skipped);
                    else skippedUsers.clear();
                }
                chrome.storage.local.set({ "saved_users": extractedUsers, "audit_db": auditCache, "skipped_users": Array.from(skippedUsers) });
                
                renderList(extractedUsers);
                updateCount();
                toggleUI(true);

                // REFRESH INSPECTOR IF OPEN
                const currentNameEl = document.querySelector(".ins-header .ins-user-wrapper div:last-child");
                if (currentNameEl) {
                    const currentUsername = currentNameEl.innerText.replace("@", "").replace(" ↗", "").trim();
                    if (auditCache[currentUsername]) renderInspector(auditCache[currentUsername]);
                }

                showToast(`${t("imported")}. Users: ${extractedUsers.length}`);
            } catch (err) { console.error(err); showToast(t("invalidJson")); }
            event.target.value = "";
        };
        reader.readAsText(file);
    });
}

// --- AI CONFIG ---
const providerSelector = document.getElementById("aiProviderSelector");
const cloudModelSelector = document.getElementById("cloudModelSelector");
const puterModelSelector = document.getElementById("puterModelSelector");
const cloudControls = document.getElementById("cloudControls");
const puterControls = document.getElementById("puterControls");
const aiInputArea = document.getElementById("aiInputArea");
const aiRemoveArea = document.getElementById("aiRemoveArea");
const keyStatus = document.getElementById("keyStatus");

const puterLoginBtn = document.createElement("button");
puterLoginBtn.className = "btn";
puterLoginBtn.style.cssText = "background:#007bff; color:white; font-size:11px; margin-top:5px; padding:6px; display:none;";
puterLoginBtn.id = "puterLoginBtn";
puterLoginBtn.innerText = t("btnSignInPuter");
puterLoginBtn.onclick = loginToPuter;
if(puterControls) puterControls.appendChild(puterLoginBtn);

async function checkPuterLogin() {
    if (typeof puter === 'undefined') { showToast(t("puterNotLoaded")); return; }
    try { puterSignedIn = puter.auth.isSignedIn(); updateAIUI(); } catch (e) { }
}
async function loginToPuter() {
    try { await puter.auth.signIn(); puterSignedIn = true; updateAIUI(); showToast(t("signInSuccess")); } catch (e) { showToast(t("signInFailed")); }
}

if(providerSelector) {
    providerSelector.addEventListener("change", (e) => {
        aiProvider = e.target.value;
        chrome.storage.local.set({ "ai_provider": aiProvider });
        if (aiProvider === "puter") ensurePuterLoaded();
        updateAIUI();
    });
}
if(cloudModelSelector) {
    cloudModelSelector.addEventListener("change", (e) => chrome.storage.local.set({ "cloud_model_id": e.target.value }));
}
if(puterModelSelector) {
    puterModelSelector.addEventListener("change", (e) => chrome.storage.local.set({ "puter_model_id": e.target.value }));
}

function updateAIUI() {
    if(cloudControls) cloudControls.style.display = "none"; 
    if(puterControls) puterControls.style.display = "none"; 
    if(keyStatus) { keyStatus.innerText = ""; keyStatus.className = ""; }
    
    if (aiProvider === "cloud") {
        if(cloudControls) cloudControls.style.display = "flex";
        if (geminiKey) { 
            if(keyStatus) { keyStatus.innerText = "(Ready)"; keyStatus.className = "status-saved"; }
            if(aiInputArea) aiInputArea.style.display = "none"; 
            if(aiRemoveArea) aiRemoveArea.style.display = "block"; 
        } else { 
            if(keyStatus) { keyStatus.innerText = "(No Key)"; keyStatus.className = "status-missing"; }
            if(aiInputArea) aiInputArea.style.display = "block"; 
            if(aiRemoveArea) aiRemoveArea.style.display = "none"; 
        }
    } else if (aiProvider === "puter") {
        if(puterControls) puterControls.style.display = "block";
        if (puterSignedIn) {
            if(keyStatus) { keyStatus.innerText = "(Ready)"; keyStatus.className = "status-saved"; }
            puterLoginBtn.style.display = "none"; 
            if(puterModelSelector) puterModelSelector.style.display = "block";
        } else {
            if(keyStatus) { keyStatus.innerText = "(Login Req)"; keyStatus.className = "status-missing"; }
            puterLoginBtn.style.display = "block"; 
            if(puterModelSelector) puterModelSelector.style.display = "none";
        }
    }
}

if(document.getElementById("saveKeyBtn")) {
    document.getElementById("saveKeyBtn").addEventListener("click", () => {
        const rawKey = document.getElementById("apiKeyInput").value.trim();
        if (!rawKey) return showToast(t("enterKey"));
        chrome.storage.local.set({ "enc_api_key": btoa(rawKey) }, () => { geminiKey = rawKey; document.getElementById("apiKeyInput").value = ""; updateAIUI(); showToast(t("keySaved")); });
    });
}
if(document.getElementById("removeKeyBtn")) {
    document.getElementById("removeKeyBtn").addEventListener("click", () => { chrome.storage.local.remove("enc_api_key", () => { geminiKey = null; updateAIUI(); showToast(t("keyRemoved")); }); });
}

// --- ADD/SEARCH ---
const manualAddBtn = document.getElementById("addManualUserBtn");
const universalInput = document.getElementById("universalInput");

if(manualAddBtn && universalInput) {
    manualAddBtn.addEventListener("click", () => {
        const rawValue = universalInput.value.trim();
        if (!rawValue) return;
        let username = rawValue.replace('@', '').replace('threads.net/', '').replace('threads.com/', '').replace('https://www.', '').replace('https://', '').replace(/\/$/, "");
        const isValid = /^[a-zA-Z0-9._]{1,30}$/.test(username);
        if (!isValid) return showToast(t("errInvalidUser"));
        if (extractedUsers.includes(username)) return showToast(t("errUserExists").replace("{user}", username));
        extractedUsers.push(username);
        chrome.storage.local.set({ "saved_users": extractedUsers });
        renderList(extractedUsers);
        
        universalInput.value = "";
        applyFilters(); 
        toggleUI(true);
        showToast(t("msgUserAdded").replace("{user}", username));
        universalInput.focus(); universalInput.select();
    });
    universalInput.addEventListener("keypress", (e) => { if (e.key === "Enter") { e.preventDefault(); manualAddBtn.click(); } });
}

function applyFilters() {
    const termEl = document.getElementById("universalInput");
    if(!termEl) return;
    const term = termEl.value.toLowerCase().trim();
    const container = document.getElementById("listContainer");
    let rows = Array.from(document.querySelectorAll(".row"));
    if (isRiskFilter) {
        rows.sort((a, b) => {
            const userA = a.getAttribute("data-user");
            const userB = b.getAttribute("data-user");
            const scoreA = (auditCache[userA] && typeof auditCache[userA].score === 'number') ? auditCache[userA].score : 0;
            const scoreB = (auditCache[userB] && typeof auditCache[userB].score === 'number') ? auditCache[userB].score : 0;
            return scoreB - scoreA;
        });
    }
    rows.forEach(r => {
        const username = r.getAttribute("data-user");
        const data = auditCache[username];
        const matchesSearch = !term || username.toLowerCase().includes(term);
        let matchesRisk = true;
        if (isRiskFilter) { if (!data || data.score < 40) matchesRisk = false; }
        if (matchesSearch && matchesRisk) { r.style.display = "flex"; container.appendChild(r); } else { r.style.display = "none"; }
    });
    updateCount();
}

if(document.getElementById("universalInput")) {
    document.getElementById("universalInput").addEventListener("input", applyFilters);
}

if(document.getElementById("filterRiskBtn")) {
    document.getElementById("filterRiskBtn").addEventListener("click", () => {
        const hasAuditData = Object.keys(auditCache).length > 0;
        if (!hasAuditData && !isRiskFilter) { showToast(t("nothingExport") || "No audit data yet."); return; }
        isRiskFilter = !isRiskFilter;
        const btn = document.getElementById("filterRiskBtn");
        if (isRiskFilter) {
            btn.style.opacity = "1"; btn.style.border = "2px solid #b71c1c"; btn.style.background = "#ffebee"; btn.style.color = "#b71c1c";
        } else {
            btn.style.opacity = "1"; btn.style.border = "none"; btn.style.background = "#d32f2f"; btn.style.color = "#fff";
        }
        applyFilters();
    });
}

// --- EXTRACTION ---
const extractBtn = document.getElementById("extractBtn");
if(extractBtn) {
    extractBtn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return showToast(t("errConnect") || "Cannot access tab.");
        if (!tab.url.match(/threads\.(net|com)/)) return showToast(t("errWrongDomain") || "Please open Threads first");
        
        if (isExtracting) {
            chrome.tabs.sendMessage(tab.id, { action: "stop_extraction" });
            extractBtn.innerText = t("stopping");
            return;
        }
        isExtracting = true;
        extractBtn.innerText = t("btnInit");
        extractBtn.disabled = true;
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
            if (chrome.runtime.lastError) {
                isExtracting = false; extractBtn.disabled = false; extractBtn.innerText = t("extract"); return showToast(t("msgRefresh"));
            }
            extractBtn.disabled = false;
            chrome.tabs.sendMessage(tab.id, { action: "extract_followers" });
        });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "waiting_for_modal") {
        if(extractBtn) { extractBtn.innerText = t("btnOpenModal"); extractBtn.style.background = "#f57c00"; extractBtn.style.color = "#fff"; }
        showToast(t("msgOpenModal"));
    }
    if (msg.action === "extraction_started") {
        if(extractBtn) { extractBtn.innerText = t("btnStopFound").replace("{count}", "0"); extractBtn.style.background = "#b71c1c"; }
    }
    if (msg.action === "extraction_progress") {
        if(extractBtn) extractBtn.innerText = t("btnStopFound").replace("{count}", msg.count);
    }
    if (msg.action === "extraction_complete") {
        isExtracting = false;
        if(extractBtn) { extractBtn.innerText = t("extract"); extractBtn.style.background = "#000"; }
        const incomingUsers = msg.data || [];
        const prevLen = extractedUsers.length;
        extractedUsers = Array.from(new Set([...extractedUsers, ...incomingUsers]));
        const newCount = extractedUsers.length - prevLen;
        chrome.storage.local.set({ "saved_users": extractedUsers });
        renderList(extractedUsers);
        toggleUI(true);
        updateCount();
        showToast(t("msgDone").replace("{count}", newCount));
    }
});

// --- AUDIT LOOP ---
if(document.getElementById("auditBtn")) {
    document.getElementById("auditBtn").addEventListener("click", async () => {
        const btn = document.getElementById("auditBtn");
        if (isAuditing) { stopAuditRequested = true; btn.innerText = t("stopping"); return; }

        const rows = Array.from(document.querySelectorAll(".row"));
        const checkboxes = rows
            .filter(r => r.style.display !== "none")
            .map(r => r.querySelector(".user-check:checked:not(:disabled)"))
            .filter(Boolean);

        if (!checkboxes.length) return showToast(t("selectUser"));

        isAuditing = true; stopAuditRequested = false; btn.innerText = t("stopAudit"); btn.classList.add("btn-stop");
        document.getElementById("inspector").innerHTML = `<div class="ins-empty">${t("batchStart")}</div>`;

        for (let i = 0; i < checkboxes.length; i++) {
            if (stopAuditRequested) break;
            const row = checkboxes[i].closest(".row"); const username = row.getAttribute("data-user");
            row.scrollIntoView({ behavior: "smooth", block: "center" });

            let delay = 0;
            if (aiProvider === 'disabled' && !auditCache[username]) { delay = 50; }

            const success = await performAudit(username, row);
            if (success === false) { stopAuditRequested = true; break; }

            if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }
        isAuditing = false; btn.innerText = t("audit"); btn.classList.remove("btn-stop");
        if (stopAuditRequested) showToast(t("auditStopped")); else showToast(t("auditComplete"));
        if (isRiskFilter) applyFilters();
    });
}

async function performAudit(username, rowElement, isRetry = false) {
    const tag = rowElement.querySelector(".tag");
    document.querySelectorAll(".row").forEach(r => r.classList.remove("active")); rowElement.classList.add("active");
    if (auditCache[username] && !isRetry) { renderInspector(auditCache[username]); updateTag(tag, auditCache[username]); return true; }
    
    tag.innerText = isRetry ? "RETRY..." : "..."; 
    tag.className = "tag loading";

    const currentProvider = document.getElementById("aiProviderSelector").value;
    const isCloud = (currentProvider === "cloud");
    const isPuter = (currentProvider === "puter");

    if (isCloud && !geminiKey) { showToast(t("enterKey")); return false; }
    if (isPuter && !puterSignedIn) {
        try { await puter.auth.signIn(); puterSignedIn = true; updateAIUI(); }
        catch (e) { tag.innerText = t("statusAuth"); tag.className = "tag"; showToast(t("puterSignInReq")); return false; }
    }

    try {
        let res = await chrome.runtime.sendMessage({
            action: "silent_audit", username: username, apiKey: isCloud ? geminiKey : null,
            cloudModelId: cloudModelSelector.value, skipCloudAI: !isCloud, language: currentLang
        });

        if (res && res.success) {
            if (isCloud && res.debugLog) {
                const logs = res.debugLog.join(" ");
                if (logs.includes("AI Error")) {
                    if (!isRetry) { showToast(t("msgRetrying")); tag.innerText = "WAIT 60s"; tag.className = "tag"; await new Promise(r => setTimeout(r, 60000)); return await performAudit(username, rowElement, true); }
                    const msg = res.debugLog.find(l => l.includes("AI Error")) || "AI Error";
                    showToast(t("errAiMsg").replace("{msg}", msg)); tag.innerText = "AI ERR"; tag.className = "tag red"; renderErrorInspector(username, msg); return false;
                }
                if (logs.includes("AI: Disabled")) { showToast(t("errAiDisabled")); tag.innerText = "CFG ERR"; tag.className = "tag red"; return false; }
                if (logs.includes("AI: Skipped")) { showToast(t("errAiSkipped")); tag.innerText = "NO KEY"; tag.className = "tag red"; return false; }
            }

            if (isPuter) {
                tag.innerText = t("statusAi");
                const historyText = (res.replyData && res.replyData.history.length > 0) ? res.replyData.history.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n") : "(No replies)";
                const prompt = `Role: Cybersecurity Auditor. Target: @${username}. Bio: "${res.bioSnippet}". Main Post: "${res.mainPost.text}". Replies: ${historyText}. Detect Bot/Farm. JSON: { "bot_probability": number (0-100), "reason": "Short reason in ${currentLang}" }`;
                try {
                    const selectedModel = document.getElementById("puterModelSelector").value;
                    const aiResp = await puter.ai.chat(prompt, { model: selectedModel });
                    let content = aiResp?.message?.content || "{}"; content = content.replace(/```json|```/g, "").trim();
                    const result = JSON.parse(content);
                    let score = result.bot_probability || 0;
                    if (score <= 1 && score > 0) score = Math.round(score * 100);
                    res.score = score;
                    res.checklist.push({ special: `🤖 Puter AI: ${score}/100` });
                    res.debugLog.push(`${t("aiAnalysisLocal")}: ${score}/100 - ${result.reason}`);
                    if (result.reason) res.checklist.push({ special: `📝 ${result.reason}` });
                } catch (aiErr) { 
                    if (!isRetry) { showToast(t("msgRetrying")); tag.innerText = "WAIT 60s"; tag.className = "tag"; await new Promise(r => setTimeout(r, 60000)); return await performAudit(username, rowElement, true); }
                    tag.innerText = "AI FAIL"; tag.className = "tag red"; res.checklist.push({ special: "⚠️ " + t("aiFailedPuter") }); auditCache[username] = res; renderInspector(res); showToast(t("errPuterFail")); return false; 
                }
            }

            auditCache[username] = res; chrome.storage.local.set({ "audit_db": auditCache });
            updateTag(tag, res); renderInspector(res); return true;
        } else { 
            const err = res?.error || "Unknown";
            if (err.includes("Rate Limit") || err.includes("429")) { showToast(t("errRateLimit")); tag.innerText = "429"; tag.className = "tag red"; return false; }
            if (err.includes("Proxy")) { showToast(t("errProxyFail")); tag.innerText = "PROXY"; tag.className = "tag red"; return false; }
            tag.innerText = "ERR"; tag.className = "tag"; renderErrorInspector(username, err); return true; 
        }
    } catch (e) { tag.innerText = t("statusFail"); tag.className = "tag"; return true; }
}

function renderInspector(data) {
    const div = document.getElementById("inspector");
    div.classList.remove("privacy-blur", "privacy-visible");

    const ICON_EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const ICON_EYE_CLOSED = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    let color = data.score >= 40 ? "d32f2f" : "2e7d32";
    if (data.manualChecked) color = "2e7d32";

    const imgUrl = (data.avatar && !data.avatar.includes("null")) ? data.avatar : "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png";
    const isSkipped = skippedUsers.has(data.username);
    const skipIcon = isSkipped ? "↩️" : "🗑️";
    const skipTitle = isSkipped ? t("restoreUser") : t("skipUser");
    
    const btnBaseStyle = "border:1px solid #ccc; background:#fff; cursor:pointer; font-size:16px; padding:4px 8px; border-radius:4px; height:32px; width:32px; display:flex; align-items:center; justify-content:center;";
    const eyeBtnStyle = `${btnBaseStyle} color:#555;`;
    const removeBtnStyle = `${btnBaseStyle} color:red; border-color:#ffcdd2;`;
    const skipBtnStyle = `${btnBaseStyle}`;
    const checkBtnStyle = `${btnBaseStyle} color:${data.manualChecked ? '#fff' : '#2e7d32'}; background:${data.manualChecked ? '#2e7d32' : '#fff'}; border-color:#2e7d32; margin-right:8px;`;

    let mainPostHtml = data.mainPost.exists ? `<div class="ins-post-main"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span class="activity-badge badge-Main">MAIN POST</span><span style="color:#999;font-size:10px;">${data.mainPost.dateStr}</span></div><div style="color:#333;">${data.mainPost.text}</div></div>` : `<div class="ins-post-main" style="border-left:4px solid #d32f2f;background:#ffebee;color:#d32f2f;font-weight:bold;">${t("noMain")}</div>`;
    let replyContentHtml = ""; let avgLabel = "";
    if (data.replyData && data.replyData.exists) {
        const avgColor = (data.replyData.avgLength < 20) ? "d32f2f" : "2e7d32"; avgLabel = `<span style="font-weight:bold;color:#${avgColor}">Avg: ${data.replyData.avgLength}</span>`;
        replyContentHtml = (data.replyData.history.length > 0) ? data.replyData.history.map(item => `<div class="reply-card"><div style="text-align:right;font-size:10px;color:#999;margin-bottom:4px;border-bottom:1px solid #eee;">${item.reply.date ? new Date(item.reply.date * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ""}</div>${(item.context && item.context.user !== "Unknown") ? `<div style="background:#eee;color:#666;padding:6px;border-radius:4px;margin-bottom:6px;font-style:italic;font-size:11px;border-left:2px solid #ccc;"><strong>@${item.context.user}:</strong> ${item.context.text.substring(0, 80)}...</div>` : ""}<div style="color:#000;"><strong style="color:#444;">@${item.reply.user}:</strong> ${item.reply.text}</div></div>`).join('') : "<div style='color:#999;padding:10px;'>...</div>";
    } else { replyContentHtml = "<div style='color:#999;padding:10px;'>...</div>"; }

    const aiItems = data.checklist.filter(i => i.special && (i.special.includes("AI") || i.special.includes("📝") || i.special.includes("⚠️")));
    const ruleItems = data.checklist.filter(i => !i.special || !(i.special.includes("AI") || i.special.includes("📝") || i.special.includes("⚠️")));
    let aiHtml = "";
    if (aiItems.length > 0) { aiHtml = `<div class="ins-ai-section">${aiItems.map(i => { const text = i.special || i; return text.includes("AI") ? `<span class="ins-ai-title">${text}</span>` : `<div class="ins-ai-content">${text}</div>`; }).join('')}</div>`; }
    const ruleHtml = ruleItems.map(item => { if (item.key) return `<li>${t(item.key)}${item.val ? ` (${item.val})` : ""}${item.score ? ` (+${item.score})` : ""}</li>`; return `<li>${item}</li>`; }).join('');

    const isGlobalPrivacy = document.body.classList.contains("privacy-mode");
    const initialEyeIcon = isGlobalPrivacy ? ICON_EYE_CLOSED : ICON_EYE_OPEN;

    div.innerHTML = `
    <div class="ins-header">
        <a href="https://www.threads.com/@${data.username}" target="_blank" class="ins-user-wrapper" title="Open Profile">
            <img src="${imgUrl}" class="ins-img">
            <div style="min-width:0;">
                <div style="font-weight:bold;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${data.realName}</div>
                <div style="color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${data.username} ↗</div>
            </div>
        </a>
        <div class="ins-action-wrapper">
            <button id="insPrivacyBtn" style="${eyeBtnStyle}" title="${t("togglePrivacy")}">${initialEyeIcon}</button>
            <button id="insCheckBtn" style="${checkBtnStyle}" title="${t("markChecked")}">${ICON_CHECK}</button>
            <button id="insRemoveBtn" style="${removeBtnStyle}" title="${t("removeUser")}">❌</button>
            <button id="insSkipBtn" style="${skipBtnStyle}" title="${skipTitle}">${skipIcon}</button>
        </div>
    </div>
    <div class="ins-stats"><span>👥 <b>${data.followerCount}</b></span><span style="color:#${color};font-weight:bold;border:1px solid #${color};padding:0 4px;border-radius:4px;">Risk: ${data.score}/100</span><span>${data.postCount} items</span></div>
    ${aiHtml}
    <ul style="margin:5px 0 15px 0; padding:0; list-style:none; color:#d32f2f; font-size:12px; line-height:1.4;">${ruleHtml}</ul>
    <div class="ins-bio">"${data.bioSnippet || ""}"</div>
    ${mainPostHtml}
    <div class="ins-post-reply"><div style="color:#999;font-size:10px;margin-bottom:5px;display:flex;justify-content:space-between;"><div><span class="activity-badge badge-Reply">REPLIES</span></div>${avgLabel}</div><div class="reply-list-scroll">${replyContentHtml}</div></div>
    <div style="text-align:right;margin-bottom:10px;"><button id="showDebugBtn" style="font-size:9px;border:1px solid #ddd;background:#f5f5f5;color:#666;cursor:pointer;padding:3px 8px;border-radius:4px;">${t("viewDebug")}</button></div>`;

    document.getElementById("insSkipBtn").addEventListener("click", () => { const row = document.querySelector(`.row[data-user="${data.username}"]`); if (row) { toggleSkipUser(data.username, row); renderInspector(data); } });
    document.getElementById("insRemoveBtn").addEventListener("click", () => { if(confirm(t("confirmRemoveUser").replace("{user}", data.username))) { removeUserPermanently(data.username); } });
    document.getElementById("insCheckBtn").addEventListener("click", () => { toggleCheckedStatus(data.username); });
    document.getElementById("showDebugBtn").addEventListener("click", () => showAlert("DEBUG LOG:\n\n" + data.debugLog.join('\n')));

    const privacyBtn = document.getElementById("insPrivacyBtn");
    privacyBtn.addEventListener("click", () => {
        const isCurrentlyBlurred = getComputedStyle(div.querySelector(".ins-img")).filter.includes("blur");
        if (isCurrentlyBlurred) { div.classList.remove("privacy-blur"); div.classList.add("privacy-visible"); privacyBtn.innerHTML = ICON_EYE_OPEN; } 
        else { div.classList.remove("privacy-visible"); div.classList.add("privacy-blur"); privacyBtn.innerHTML = ICON_EYE_CLOSED; }
    });
}

function removeUserPermanently(username) {
    extractedUsers = extractedUsers.filter(u => u !== username);
    delete auditCache[username];
    skippedUsers.delete(username);
    chrome.storage.local.set({ "saved_users": extractedUsers, "audit_db": auditCache, "skipped_users": Array.from(skippedUsers) });
    renderList(extractedUsers);
    updateCount();
    document.getElementById("inspector").innerHTML = `<div class="ins-empty">${t("selectUser")}</div>`;
    showToast(t("userRemoved"));
}

function renderErrorInspector(user, err) { document.getElementById("inspector").innerHTML = `<div style="color:red;text-align:center;padding-top:60px">❌ ${t("errError")} @${user}<br><span style="font-size:10px">${err || t("errUnknown")}</span></div>`; }

function renderList(users) {
    const container = document.getElementById("listContainer");
    container.innerHTML = "";
    users.forEach(u => {
        const div = document.createElement("div");
        const isSkipped = skippedUsers.has(u);
        div.className = isSkipped ? "row skipped" : "row";
        div.setAttribute("data-user", u);
        const checkState = isSkipped ? "disabled" : "checked";
        div.innerHTML = `<input type="checkbox" class="user-check" ${checkState}><span class="row-name">@${u}</span><a href="https://www.threads.com/@${u}" target="_blank" class="ext-link">↗</a><span class="tag" style="cursor:pointer;" title="Click to Re-Audit">Pending</span>`;
        div.querySelector(".row-name").addEventListener("click", () => { document.getElementById("inspector").innerHTML = `<div class="ins-empty">🔎 Loading <span class="loading-user">@${u}</span>...</div>`; performAudit(u, div); });
        const tagBtn = div.querySelector(".tag");
        tagBtn.addEventListener("click", (e) => { e.stopPropagation(); if (skippedUsers.has(u)) return; delete auditCache[u]; chrome.storage.local.set({ "audit_db": auditCache }); tagBtn.innerText = "..."; tagBtn.className = "tag loading"; document.getElementById("inspector").innerHTML = `<div class="ins-empty">🔄 Re-Auditing <span class="loading-user">@${u}</span>...</div>`; performAudit(u, div); });
        if (auditCache[u]) updateTag(tagBtn, auditCache[u]);
        container.appendChild(div);
    });
    if (isRiskFilter) applyFilters();
    document.querySelectorAll(".user-check").forEach(b => b.addEventListener("change", updateCount));
}

function toggleSkipUser(username, row) {
    const checkbox = row.querySelector(".user-check");
    if (skippedUsers.has(username)) { skippedUsers.delete(username); row.classList.remove("skipped"); if (checkbox) { checkbox.disabled = false; checkbox.checked = true; } }
    else { skippedUsers.add(username); row.classList.add("skipped"); if (checkbox) { checkbox.checked = false; checkbox.disabled = true; } }
    chrome.storage.local.set({ "skipped_users": Array.from(skippedUsers) });
    updateCount();
}

function toggleCheckedStatus(username) {
    if (!auditCache[username]) return;
    const isChecked = !auditCache[username].manualChecked;
    auditCache[username].manualChecked = isChecked;
    chrome.storage.local.set({ "audit_db": auditCache });
    renderInspector(auditCache[username]);
    const row = document.querySelector(`.row[data-user="${username}"]`);
    if (row) { const tag = row.querySelector(".tag"); updateTag(tag, auditCache[username]); }
    if (isChecked) showToast(t("userMarked"));
}

function updateTag(tag, data) { 
    if (data.manualChecked) { tag.className = "tag green"; const label = translations["statusChecked"] ? t("statusChecked") : "CHECKED"; tag.innerText = label; return; }
    tag.className = data.score >= 40 ? "tag red" : "tag green"; 
    tag.innerText = data.score >= 40 ? `RISK ${data.score}` : "SAFE"; 
}

function updateCount() {
    const rows = Array.from(document.querySelectorAll(".row"));
    const visibleChecked = rows.filter(r => { if (r.style.display === "none") return false; const cb = r.querySelector(".user-check"); return cb && cb.checked && !cb.disabled; }).length;
    document.getElementById("countLabel").innerText = `${visibleChecked} selected`;
}

function showToast(msg) { const t = document.getElementById("toast"); t.innerText = msg; t.className = "show"; setTimeout(() => t.className = "", 5000); }

if(document.getElementById("selectAll")) { document.getElementById("selectAll").addEventListener("change", (e) => { const isChecked = e.target.checked; const rows = document.querySelectorAll(".row"); rows.forEach(row => { if (row.style.display !== "none") { const checkbox = row.querySelector(".user-check"); if (checkbox && !checkbox.disabled) checkbox.checked = isChecked; } }); updateCount(); }); }

if(document.getElementById("clearListBtn")) {
    document.getElementById("clearListBtn").addEventListener("click", () => {
        if (!confirm(t("confirmClear"))) return;
        extractedUsers = []; skippedUsers.clear(); chrome.storage.local.set({ "saved_users": [], "skipped_users": [] });
        renderList([]); updateCount(); toggleUI(false); showToast(t("cleared"));
    });
}

// BATCH REMOVE
if(document.getElementById("batchRemoveBtn")) {
    const btn = document.getElementById("batchRemoveBtn");
    btn.title = t("batchRemoveTitle") || "Remove Selected";
    btn.addEventListener("click", async () => {
        const rows = Array.from(document.querySelectorAll(".row"));
        const checkedUsers = rows.filter(r => r.style.display !== "none").map(r => { const cb = r.querySelector(".user-check"); if (cb && cb.checked && !cb.disabled) return r.getAttribute("data-user"); return null; }).filter(Boolean);
        if (checkedUsers.length === 0) return showToast(t("selectUser"));
        const confirmed = await showConfirm(t("confirmBatchRemove").replace("{count}", checkedUsers.length), t("btnOk"), "Cancel");
        if (!confirmed) return;
        extractedUsers = extractedUsers.filter(u => !checkedUsers.includes(u));
        checkedUsers.forEach(u => { delete auditCache[u]; skippedUsers.delete(u); });
        chrome.storage.local.set({ "saved_users": extractedUsers, "audit_db": auditCache, "skipped_users": Array.from(skippedUsers) });
        renderList(extractedUsers); updateCount();
        if(extractedUsers.length === 0) { document.getElementById("inspector").innerHTML = `<div class="ins-empty">${t("selectUser")}</div>`; toggleUI(false); }
        showToast(t("batchRemoved").replace("{count}", checkedUsers.length));
    });
}

// SELECTIVE CACHE CLEAR
if(document.getElementById("clearCacheBtn")) {
    const clearBtn = document.getElementById("clearCacheBtn");
    clearBtn.title = t("clearCacheTitle") || "Clear results";
    clearBtn.addEventListener("click", () => {
        const rows = Array.from(document.querySelectorAll(".row"));
        const selectedUsers = rows.filter(r => r.style.display !== "none").map(r => { const cb = r.querySelector(".user-check"); if (cb && cb.checked && !cb.disabled) return r.getAttribute("data-user"); return null; }).filter(Boolean);
        if (selectedUsers.length === 0) return showToast(t("selectUser"));
        if (!confirm(t("confirmClearSelected").replace("{count}", selectedUsers.length))) return;
        selectedUsers.forEach(user => { delete auditCache[user]; const row = document.querySelector(`.row[data-user="${user}"]`); if(row) { const tag = row.querySelector(".tag"); tag.className = "tag"; tag.innerText = "Pending"; } });
        chrome.storage.local.set({ "audit_db": auditCache });
        const currentInspectorName = document.querySelector(".ins-header .ins-user-wrapper div:last-child")?.innerText?.replace("@", "").replace(" ↗", "").trim();
        if (currentInspectorName && !auditCache[currentInspectorName]) document.getElementById("inspector").innerHTML = `<div class="ins-empty">${t("selectUser")}</div>`;
        showToast(t("cacheClearedBatch").replace("{count}", selectedUsers.length));
    });
}