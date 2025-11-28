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

// PROXY SOURCES
const PROXY_SOURCES = [
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
    "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt"
];

async function loadLanguage(lang) {
  try {
    const url = chrome.runtime.getURL(`locales/${lang}.json`);
    const res = await fetch(url);
    translations = await res.json();
    updateUILanguage();
  } catch (e) { if(lang !== 'en') loadLanguage('en'); }
}

function t(key) { return translations[key] || key; }

function updateUILanguage() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if(translations[key]) el.innerText = translations[key];
  });
  if(document.getElementById("userSearch")) document.getElementById("userSearch").placeholder = t("searchPh");
  const filterBtn = document.getElementById("filterRiskBtn");
  if(filterBtn) filterBtn.innerText = isRiskFilter ? t("showAll") : t("filterRisk");
  if (isAuditing) document.getElementById("auditBtn").innerText = stopAuditRequested ? t("stopping") : t("stopAudit");
  
  const puterLogin = document.getElementById("puterLoginBtn");
  if(puterLogin) puterLogin.innerText = t("btnSignInPuter");

  const debugBtn = document.getElementById("showDebugBtn");
  if(debugBtn) debugBtn.innerText = t("viewDebug");

  const clearBtn = document.getElementById("clearListBtn");
  if(clearBtn) clearBtn.title = t("clearList");
}

document.getElementById("langSelector").addEventListener("change", (e) => {
  currentLang = e.target.value; chrome.storage.local.set({ "ui_lang": currentLang }); loadLanguage(currentLang);
});

// --- INIT ---
chrome.storage.local.get(["audit_db", "enc_api_key", "ai_provider", "cloud_model_id", "puter_model_id", "saved_users", "ui_lang", "proxy_config", "privacy_mode"], (data) => {
  auditCache = data.audit_db || {};
  if (data.ui_lang) { currentLang = data.ui_lang; document.getElementById("langSelector").value = currentLang; }
  loadLanguage(currentLang);

  if (data.saved_users && Array.isArray(data.saved_users)) {
    extractedUsers = data.saved_users; renderList(extractedUsers);
    if(extractedUsers.length > 0) {
      document.getElementById("userSearch").style.display = "block";
      document.getElementById("filterRiskBtn").style.display = "block"; 
      document.getElementById("auditBtn").style.display = "block";
      document.getElementById("statsRow").style.display = "flex";
      updateCount();
    }
  }
  if (data.cloud_model_id) document.getElementById("cloudModelSelector").value = data.cloud_model_id;
  if (data.puter_model_id) document.getElementById("puterModelSelector").value = data.puter_model_id;
  
  if (data.ai_provider) { 
      aiProvider = (data.ai_provider === "chrome") ? "disabled" : data.ai_provider; 
      document.getElementById("aiProviderSelector").value = aiProvider; 
      if(aiProvider === "puter") ensurePuterLoaded(); 
  }
  
  if (data.enc_api_key) { try { geminiKey = atob(data.enc_api_key); } catch (e) {} }
  
  // Check Puter Auth
  if (typeof puter !== 'undefined') checkPuterLogin();
  updateAIUI();

  if(data.proxy_config) {
     const p = data.proxy_config;
     document.getElementById("proxyEnabled").checked = p.enabled;
     document.getElementById("proxyProto").value = p.proto || "SOCKS5";
     document.getElementById("proxyHost").value = p.host || "";
     document.getElementById("proxyPort").value = p.port || "";
     document.getElementById("proxyUser").value = p.user || "";
     document.getElementById("proxyPass").value = p.pass || "";
     toggleProxyInputs(p.enabled);
  }
  if (data.privacy_mode) { document.body.classList.add("privacy-mode"); document.getElementById("privacyCheck").checked = true; }
});

// --- DYNAMIC LOADER FOR PUTER.JS ---
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

// --- DYNAMIC MODEL FETCHERS ---
async function populatePuterModels() {
    if(typeof puter === 'undefined') return;
    try {
        let models = [];
        try { models = await puter.ai.listModels(); } catch(e) {}
        
        if(!models || models.length === 0) {
            models = ["gpt-5-nano", "gpt-4o-mini", "gpt-4o", "claude-3-5-sonnet", "gemini-2.0-flash", "mistral-large-latest", "deepseek-chat"];
        }

        const selector = document.getElementById("puterModelSelector");
        const currentVal = selector.value;
        selector.innerHTML = "";
        
        models.forEach(m => {
            const opt = document.createElement("option");
            const val = typeof m === 'string' ? m : m.id;
            opt.value = val;
            opt.innerText = val;
            if(val === currentVal) opt.selected = true;
            selector.appendChild(opt);
        });
    } catch(e) { console.error("Puter Model List Error", e); }
}

async function populateGeminiModels() {
    if(!geminiKey) { showToast(t("enterKey")); return; }
    const btn = document.getElementById("refreshGeminiBtn");
    btn.innerText = "...";
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
        if(!res.ok) throw new Error("API Error");
        const data = await res.json();
        
        const selector = document.getElementById("cloudModelSelector");
        selector.innerHTML = "";
        
        const validModels = data.models.filter(m => {
            const name = m.name.toLowerCase();
            return (name.includes("gemini-2.5") || name.includes("gemini-3") || name.includes("gemini-2.0") || name.includes("gemini-1.5")) &&
                   m.supportedGenerationMethods && 
                   m.supportedGenerationMethods.some(method => method.includes("generateContent"));
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
    } catch(e) {
        showToast(t("fetchFailed"));
    } finally {
        btn.innerText = "🔄";
    }
}

document.getElementById("refreshGeminiBtn").addEventListener("click", populateGeminiModels);

// --- SETTINGS UI ---
document.getElementById("settingsToggleBtn").addEventListener("click", () => document.getElementById("settingsMenu").classList.toggle("show"));
document.getElementById("closeSettingsBtn").addEventListener("click", () => document.getElementById("settingsMenu").classList.remove("show"));
document.getElementById("privacyCheck").addEventListener("change", (e) => {
    const isPrivacy = e.target.checked;
    if (isPrivacy) document.body.classList.add("privacy-mode"); else document.body.classList.remove("privacy-mode");
    chrome.storage.local.set({ "privacy_mode": isPrivacy });
});

// --- PROXY LOGIC ---
const proxyEnabledCheck = document.getElementById("proxyEnabled");
const proxyInputsDiv = document.getElementById("proxyInputs");
function toggleProxyInputs(enabled) { proxyInputsDiv.style.display = enabled ? "block" : "none"; }
proxyEnabledCheck.addEventListener("change", (e) => { toggleProxyInputs(e.target.checked); if(!e.target.checked) saveProxySettings(); });
document.getElementById("saveProxyBtn").addEventListener("click", saveProxySettings);

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
        if (config.enabled && config.host) showToast(t("proxySaved")); else if (!config.enabled) showToast(t("proxyDisabled"));
    });
}

// --- EXPORT/IMPORT ---
document.getElementById("exportBtn").addEventListener("click", () => {
  if (extractedUsers.length === 0 && Object.keys(auditCache).length === 0) return showToast(t("nothingExport"));
  const data = { timestamp: new Date().toISOString(), users: extractedUsers, cache: auditCache };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `threads-audit-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast(t("exported"));
});

// --- CSV EXPORT LOGIC ---
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (Object.keys(auditCache).length === 0 && extractedUsers.length === 0) {
      return showToast(t("nothingExport"));
  }
  let csvContent = "\uFEFFUsername,Risk Score,Risk Level,Profile URL,Last Audit,AI/Rules Note\n";
  const allUsers = Array.from(new Set([...extractedUsers, ...Object.keys(auditCache)]));
  const exportData = allUsers.map(user => {
      const data = auditCache[user];
      return {
          user: user,
          score: data ? (data.score || 0) : 0,
          risk: data ? (data.score >= 40 ? "HIGH" : "LOW") : "N/A",
          link: `https://www.threads.net/@${user}`,
          ai_reason: (data && data.checklist) ? data.checklist.filter(c => typeof c === 'string' ? c.includes("AI") : c.special).map(c => typeof c === 'string' ? c : c.special).join("; ") : "",
          date: data ? new Date().toLocaleDateString() : "Pending"
      };
  });

  exportData.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.user.localeCompare(b.user);
  });

  exportData.forEach(row => {
      const safeReason = `"${row.ai_reason.replace(/"/g, '""')}"`;
      csvContent += `${row.user},${row.score},${row.risk},${row.link},${row.date},${safeReason}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `threads-audit-report-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(t("exported"));
});

document.getElementById("importBtn").addEventListener("click", () => { document.getElementById("importFileInput").click(); });
// --- 2. MODIFIED IMPORT LOGIC ---
document.getElementById("importFileInput").addEventListener("change", (event) => {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      
      const hasData = extractedUsers.length > 0 || Object.keys(auditCache).length > 0;
      let doMerge = false;

      if (hasData) {
          // Pass translated button labels here
          doMerge = await showConfirm(
              t("importPrompt"), 
              t("btnMerge"),      // "Merge" / "合并"
              t("btnOverwrite")   // "Overwrite" / "覆盖"
          );
      }

      if (doMerge) {
          if (json.users) extractedUsers = Array.from(new Set([...extractedUsers, ...json.users]));
          if (json.cache) auditCache = { ...auditCache, ...json.cache };
      } else {
          extractedUsers = json.users || [];
          auditCache = json.cache || {};
      }

      chrome.storage.local.set({ "saved_users": extractedUsers });
      chrome.storage.local.set({ "audit_db": auditCache });
      renderList(extractedUsers); 
      updateCount();
      
      document.getElementById("userSearch").style.display = "block"; 
      document.getElementById("filterRiskBtn").style.display = "block"; 
      document.getElementById("auditBtn").style.display = "block"; 
      document.getElementById("statsRow").style.display = "flex";
      
      showToast(`${t("imported")}. Users: ${extractedUsers.length}`);
    } catch (err) { showToast(t("invalidJson")); }
    event.target.value = "";
  }; 
  reader.readAsText(file);
});
// --- AI UI LOGIC ---
const providerSelector = document.getElementById("aiProviderSelector");
const cloudModelSelector = document.getElementById("cloudModelSelector");
const puterModelSelector = document.getElementById("puterModelSelector");
const cloudControls = document.getElementById("cloudControls");
const puterControls = document.getElementById("puterControls");
const aiInputArea = document.getElementById("aiInputArea");
const aiRemoveArea = document.getElementById("aiRemoveArea");
const keyStatus = document.getElementById("keyStatus");

// Create Login Button for Puter
const puterLoginBtn = document.createElement("button");
puterLoginBtn.className = "btn";
puterLoginBtn.style.cssText = "background:#007bff; color:white; font-size:11px; margin-top:5px; padding:6px; display:none;";
puterLoginBtn.id = "puterLoginBtn";
puterLoginBtn.innerText = t("btnSignInPuter");
puterLoginBtn.onclick = loginToPuter;
puterControls.appendChild(puterLoginBtn);

async function checkPuterLogin() {
    if (typeof puter === 'undefined') {
        showToast(t("puterNotLoaded"));
        return;
    }
    try { puterSignedIn = puter.auth.isSignedIn(); updateAIUI(); } catch (e) {}
}
async function loginToPuter() {
    try { await puter.auth.signIn(); puterSignedIn = true; updateAIUI(); showToast(t("signInSuccess")); } catch (e) { showToast(t("signInFailed")); }
}

providerSelector.addEventListener("change", (e) => { 
    aiProvider = e.target.value; 
    chrome.storage.local.set({ "ai_provider": aiProvider }); 
    if (aiProvider === "puter") ensurePuterLoaded(); 
    updateAIUI(); 
});
cloudModelSelector.addEventListener("change", (e) => chrome.storage.local.set({ "cloud_model_id": e.target.value }));
puterModelSelector.addEventListener("change", (e) => chrome.storage.local.set({ "puter_model_id": e.target.value }));

function updateAIUI() {
  cloudControls.style.display = "none"; puterControls.style.display = "none"; keyStatus.innerText = ""; keyStatus.className = "";
  if (aiProvider === "cloud") {
    cloudControls.style.display = "flex";
    if (geminiKey) { keyStatus.innerText = "(Ready)"; keyStatus.className = "status-saved"; aiInputArea.style.display = "none"; aiRemoveArea.style.display = "block"; } 
    else { keyStatus.innerText = "(No Key)"; keyStatus.className = "status-missing"; aiInputArea.style.display = "block"; aiRemoveArea.style.display = "none"; }
  } else if (aiProvider === "puter") {
      puterControls.style.display = "block"; 
      if (puterSignedIn) {
          keyStatus.innerText = "(Ready)"; keyStatus.className = "status-saved";
          puterLoginBtn.style.display = "none"; puterModelSelector.style.display = "block";
      } else {
          keyStatus.innerText = "(Login Req)"; keyStatus.className = "status-missing";
          puterLoginBtn.style.display = "block"; puterModelSelector.style.display = "none";
      }
  }
}

document.getElementById("saveKeyBtn").addEventListener("click", () => {
  const rawKey = document.getElementById("apiKeyInput").value.trim();
  if (!rawKey) return showToast(t("enterKey"));
  chrome.storage.local.set({ "enc_api_key": btoa(rawKey) }, () => { geminiKey = rawKey; document.getElementById("apiKeyInput").value = ""; updateAIUI(); showToast(t("keySaved")); });
});
document.getElementById("removeKeyBtn").addEventListener("click", () => { chrome.storage.local.remove("enc_api_key", () => { geminiKey = null; updateAIUI(); showToast(t("keyRemoved")); }); });

document.getElementById("extractBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // MODIFIED: Use translation key
  if (!tab.url.includes("threads")) return showToast(t("errOpenProfile")); 
  
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
    chrome.tabs.sendMessage(tab.id, { action: "extract_followers" }, (res) => {
      
      // MODIFIED: Use translation key
      if (chrome.runtime.lastError) return showToast(t("errConnect")); 
      
      if (!res || !res.success) {
          const errorMsg = t(res?.error) || res?.error || "Unknown Error";
          return showToast(errorMsg);
      }

      extractedUsers = res.data; 
      chrome.storage.local.set({ "saved_users": extractedUsers }); 
      renderList(extractedUsers);
      document.getElementById("userSearch").style.display = "block"; 
      document.getElementById("filterRiskBtn").style.display = "block"; 
      document.getElementById("auditBtn").style.display = "block"; 
      document.getElementById("statsRow").style.display = "flex"; 
      updateCount();
    });
  });
});

// --- MAIN AUDIT LOOP ---
function applyFilters() {
  const term = document.getElementById("userSearch").value.toLowerCase();
  const container = document.getElementById("listContainer");
  let rows = Array.from(document.querySelectorAll(".row"));
  if (isRiskFilter) {
      rows.sort((a, b) => {
          const scoreA = auditCache[a.getAttribute("data-user")] ? auditCache[a.getAttribute("data-user")].score : 0;
          const scoreB = auditCache[b.getAttribute("data-user")] ? auditCache[b.getAttribute("data-user")].score : 0;
          return scoreB - scoreA;
      });
  }
  rows.forEach(r => {
    const data = auditCache[r.getAttribute("data-user")];
    const matchesSearch = r.getAttribute("data-user").toLowerCase().includes(term);
    let matchesRisk = true;
    if (isRiskFilter) { if (!data || data.score < 40) matchesRisk = false; }
    if (matchesSearch && matchesRisk) { r.style.display = "flex"; container.appendChild(r); } else { r.style.display = "none"; }
  });
}

document.getElementById("userSearch").addEventListener("input", applyFilters);
document.getElementById("filterRiskBtn").addEventListener("click", () => {
    isRiskFilter = !isRiskFilter;
    const btn = document.getElementById("filterRiskBtn");
    if (isRiskFilter) { btn.style.opacity = "1"; btn.style.border = "2px solid #b71c1c"; btn.innerText = t("showAll"); } 
    else { btn.style.opacity = "1"; btn.style.border = "none"; btn.innerText = t("filterRisk"); }
    applyFilters();
});

document.getElementById("auditBtn").addEventListener("click", async () => {
  const btn = document.getElementById("auditBtn");
  if (isAuditing) { stopAuditRequested = true; btn.innerText = t("stopping"); return; }
  const checkboxes = document.querySelectorAll(".user-check:checked");
  if (!checkboxes.length) return showToast(t("selectUser"));
  isAuditing = true; stopAuditRequested = false; btn.innerText = t("stopAudit"); btn.classList.add("btn-stop");
  document.getElementById("inspector").innerHTML = `<div class="ins-empty">${t("batchStart")}</div>`;
  
  for (let i = 0; i < checkboxes.length; i++) {
    if (stopAuditRequested) break;
    const row = checkboxes[i].closest(".row"); const username = row.getAttribute("data-user");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    
    // --- NO SLEEP IF AI ACTIVE ---
    let delay = 0;
    if (aiProvider === 'disabled' && !auditCache[username]) { delay = 50; }
    
    await performAudit(username, row);
    if(delay > 0) await new Promise(r => setTimeout(r, delay));
  }
  isAuditing = false; btn.innerText = t("audit"); btn.classList.remove("btn-stop");
  if (stopAuditRequested) showToast(t("auditStopped")); else showToast(t("auditComplete"));
  if (isRiskFilter) applyFilters();
});

async function performAudit(username, rowElement) {
  const tag = rowElement.querySelector(".tag");
  document.querySelectorAll(".row").forEach(r => r.classList.remove("active")); rowElement.classList.add("active");
  if (auditCache[username]) { renderInspector(auditCache[username]); updateTag(tag, auditCache[username]); return; }
  tag.innerText = "..."; tag.className = "tag loading";
  
  const currentProvider = document.getElementById("aiProviderSelector").value;
  const isCloud = (currentProvider === "cloud");
  const isPuter = (currentProvider === "puter");

  if (isPuter && !puterSignedIn) {
      try { await puter.auth.signIn(); puterSignedIn = true; updateAIUI(); } 
      catch (e) { tag.innerText = t("statusAuth"); tag.className = "tag"; showToast(t("puterSignInReq")); return; }
  }

  try {
    let res = await chrome.runtime.sendMessage({ 
      action: "silent_audit", username: username, apiKey: isCloud ? geminiKey : null,
      cloudModelId: cloudModelSelector.value, skipCloudAI: !isCloud, language: currentLang
    });

    if (res && res.success) {
      if (isPuter) {
          tag.innerText = t("statusAi"); 
          const historyText = (res.replyData && res.replyData.history.length > 0) ? res.replyData.history.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n") : "(No reply history found)";
          const prompt = `Role: Strict Cybersecurity Auditor. Target: @${username}. Bio: "${res.bioSnippet}". Main Post Content: "${res.mainPost.text}". Replies: ${historyText}. Task: Detect "Follower Farm/Bot". Respond ONLY in JSON: { "bot_probability": number (0-100), "reason": "Short explanation in ${currentLang}" }`;
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
          } catch (aiErr) { res.checklist.push({ special: t("aiFailedPuter") }); }
      }
      auditCache[username] = res; chrome.storage.local.set({ "audit_db": auditCache });
      updateTag(tag, res); renderInspector(res);
    } else { tag.innerText = t("statusErr"); tag.className = "tag"; renderErrorInspector(username, res?.error); }
  } catch (e) { tag.innerText = t("statusFail"); tag.className = "tag"; }
}

// --- 1. MODIFIED HELPER: Custom Buttons ---
/**
 * Shows a custom confirmation dialog with custom button text.
 * @param {string} message 
 * @param {string} [yesText] - Text for the primary button (default: OK)
 * @param {string} [noText] - Text for the secondary button (default: Cancel)
 */
function showConfirm(message, yesText = "OK", noText = "Cancel") {
  return new Promise((resolve) => {
    const dialog = document.getElementById("appDialog");
    const textEl = document.getElementById("dialogText");
    const okBtn = document.getElementById("dialogOkBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    textEl.innerText = message;
    
    // Apply custom button text
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

/**
 * Shows a custom alert dialog (OK button only).
 * @param {string} message 
 */
function showAlert(message) {
  const dialog = document.getElementById("appDialog");
  const textEl = document.getElementById("dialogText");
  const okBtn = document.getElementById("dialogOkBtn");
  const cancelBtn = document.getElementById("dialogCancelBtn");

  textEl.innerText = message;
  
  // --- FIX: Explicitly reset button text to "OK" ---
  // This prevents it from showing "Merge" or "Overwrite" from previous dialogs
  okBtn.innerText = t("btnOk") !== "btnOk" ? t("btnOk") : "OK";
  
  cancelBtn.style.display = "none"; // Hide cancel for alerts

  const handleOk = () => { 
    okBtn.removeEventListener("click", handleOk);
    dialog.close(); 
  };

  okBtn.addEventListener("click", handleOk);
  dialog.showModal();
}

function renderInspector(data) {
  const div = document.getElementById("inspector");
  const color = data.score >= 40 ? "d32f2f" : "2e7d32";
  const imgUrl = (data.avatar && !data.avatar.includes("null")) ? data.avatar : "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png";
  let mainPostHtml = data.mainPost.exists ? `<div class="ins-post-main"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span class="activity-badge badge-Main">MAIN POST</span><span style="color:#999;font-size:10px;">${data.mainPost.dateStr}</span></div><div style="color:#333;">${data.mainPost.text}</div></div>` : `<div class="ins-post-main" style="border-left:4px solid #d32f2f;background:#ffebee;color:#d32f2f;font-weight:bold;">${t("noMain")}</div>`;
  let replyContentHtml = ""; let avgLabel = "";
  if (data.replyData && data.replyData.exists) {
    const avgColor = (data.replyData.avgLength < 20) ? "d32f2f" : "2e7d32"; avgLabel = `<span style="font-weight:bold;color:#${avgColor}">Avg: ${data.replyData.avgLength}</span>`;
    replyContentHtml = (data.replyData.history.length > 0) ? data.replyData.history.map(item => `<div class="reply-card"><div style="text-align:right;font-size:10px;color:#999;margin-bottom:4px;border-bottom:1px solid #eee;">${item.reply.date ? new Date(item.reply.date*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : ""}</div>${(item.context && item.context.user !== "Unknown") ? `<div style="background:#eee;color:#666;padding:6px;border-radius:4px;margin-bottom:6px;font-style:italic;font-size:11px;border-left:2px solid #ccc;"><strong>@${item.context.user}:</strong> ${item.context.text.substring(0,80)}...</div>` : ""}<div style="color:#000;"><strong style="color:#444;">@${item.reply.user}:</strong> ${item.reply.text}</div></div>`).join('') : "<div style='color:#999;padding:10px;'>...</div>";
  } else { replyContentHtml = "<div style='color:#999;padding:10px;'>...</div>"; }

  const aiItems = data.checklist.filter(i => i.special && (i.special.includes("AI") || i.special.includes("📝") || i.special.includes("⚠️")));
  const ruleItems = data.checklist.filter(i => !i.special || !(i.special.includes("AI") || i.special.includes("📝") || i.special.includes("⚠️")));

  let aiHtml = "";
  if(aiItems.length > 0) {
      aiHtml = `<div class="ins-ai-section">
        ${aiItems.map(i => {
            const text = i.special || i;
            if(text.includes("AI")) return `<span class="ins-ai-title">${text}</span>`;
            return `<div class="ins-ai-content">${text}</div>`;
        }).join('')}
      </div>`;
  }

  const ruleHtml = ruleItems.map(item => { if (item.key) return `<li>${t(item.key)}${item.val ? ` (${item.val})` : ""}${item.score ? ` (+${item.score})` : ""}</li>`; return `<li>${item}</li>`; }).join('');

  div.innerHTML = `
    <div class="ins-header"><img src="${imgUrl}" class="ins-img"><div><div style="font-weight:bold;font-size:14px;">${data.realName}</div><div style="color:#666">@${data.username}</div></div></div>
    <div class="ins-stats"><span>👥 <b>${data.followerCount}</b></span><span style="color:#${color};font-weight:bold;border:1px solid #${color};padding:0 4px;border-radius:4px;">Risk: ${data.score}/100</span><span>${data.postCount} items</span></div>
    
    ${aiHtml}
    
    <ul style="margin:5px 0 15px 0; padding:0; list-style:none; color:#d32f2f; font-size:12px; line-height:1.4;">
      ${ruleHtml}
    </ul>

    <div class="ins-bio">"${data.bioSnippet || ""}"</div>
    ${mainPostHtml}
    <div class="ins-post-reply"><div style="color:#999;font-size:10px;margin-bottom:5px;display:flex;justify-content:space-between;"><div><span class="activity-badge badge-Reply">REPLIES</span></div>${avgLabel}</div><div class="reply-list-scroll">${replyContentHtml}</div></div>
    
    <div style="text-align:right;margin-bottom:10px;"><button id="showDebugBtn" style="font-size:9px;border:1px solid #ddd;background:#f5f5f5;color:#666;cursor:pointer;padding:3px 8px;border-radius:4px;">${t("viewDebug")}</button></div>
  `;
  document.getElementById("showDebugBtn").addEventListener("click", () => showAlert("DEBUG LOG:\n\n"+data.debugLog.join('\n')));
}

function renderErrorInspector(user, err) { document.getElementById("inspector").innerHTML = `<div style="color:red;text-align:center;padding-top:60px">❌ ${t("errError")} @${user}<br><span style="font-size:10px">${err||t("errUnknown")}</span></div>`; }
// --- 3. MODIFIED RENDER LIST: Re-Audit Logic ---
function renderList(users) { 
    const container = document.getElementById("listContainer"); 
    container.innerHTML = ""; 
    users.forEach(u => { 
        const div = document.createElement("div"); 
        div.className = "row"; 
        div.setAttribute("data-user", u); 
        
        // Added cursor pointer to the tag to indicate clickability
        div.innerHTML = `
            <input type="checkbox" class="user-check" checked>
            <span class="row-name">@${u}</span>
            <a href="https://www.threads.net/@${u}" target="_blank" class="ext-link">↗</a>
            <span class="tag" style="cursor:pointer;" title="Click to Re-Audit">Pending</span>
        `; 
        
        // Standard Inspector Click
        div.querySelector(".row-name").addEventListener("click", () => { 
            document.getElementById("inspector").innerHTML = `<div class="ins-empty">🔎 Loading <span class="loading-user">@${u}</span>...</div>`; 
            performAudit(u, div); 
        }); 

        // --- NEW: Tag Click to Re-Audit ---
        const tagBtn = div.querySelector(".tag");
        tagBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent row selection if needed
            
            // 1. Clear Cache for this user
            delete auditCache[u];
            chrome.storage.local.set({ "audit_db": auditCache });
            
            // 2. Visual Feedback
            tagBtn.innerText = "...";
            tagBtn.className = "tag loading";
            
            // 3. Show loading in inspector
            document.getElementById("inspector").innerHTML = `<div class="ins-empty">🔄 Re-Auditing <span class="loading-user">@${u}</span>...</div>`;
            
            // 4. Run Audit (Pass true to skip cache check if you modify performAudit, but deleting cache above is safer)
            performAudit(u, div);
        });

        if (auditCache[u]) updateTag(tagBtn, auditCache[u]); 
        container.appendChild(div); 
    }); 
    
    if (isRiskFilter) applyFilters(); 
    document.querySelectorAll(".user-check").forEach(b => b.addEventListener("change", updateCount)); 
}
function updateTag(tag, data) { tag.className = data.score >= 40 ? "tag red" : "tag green"; tag.innerText = data.score >= 40 ? `RISK ${data.score}` : "SAFE"; }
function updateCount() { document.getElementById("countLabel").innerText = `${document.querySelectorAll(".user-check:checked").length} selected`; }
function showToast(msg) { const t = document.getElementById("toast"); t.innerText = msg; t.className = "show"; setTimeout(() => t.className="", 5000); }
document.getElementById("selectAll").addEventListener("change", (e) => { document.querySelectorAll(".user-check").forEach(b => b.checked = e.target.checked); updateCount(); });
// --- CLEAR LIST BUTTON ---
document.getElementById("clearListBtn").addEventListener("click", () => {
    // 1. Confirm with user using translation
    if (!confirm(t("confirmClear"))) return;

    // 2. Clear Data
    extractedUsers = [];
    chrome.storage.local.set({ "saved_users": [] });

    // 3. Clear UI
    renderList([]);
    updateCount();

    // 4. Hide Controls (Reset to initial state)
    document.getElementById("userSearch").style.display = "none";
    document.getElementById("filterRiskBtn").style.display = "none";
    document.getElementById("auditBtn").style.display = "none";
    document.getElementById("statsRow").style.display = "none";

    // 5. Show Feedback
    showToast(t("cleared"));
});

document.getElementById("clearCacheBtn").addEventListener("click", () => { chrome.storage.local.remove("audit_db"); auditCache = {}; document.querySelectorAll(".tag").forEach(t => { t.innerText="Pending"; t.className="tag"; }); showToast(t("cleared")); });