let debugLog = [];
function log(msg) { debugLog.push(msg); if (debugLog.length > 200) debugLog.shift(); }

// --- PROXY STATE ---
let proxyAuthCreds = null;
let activeProxyUrl = null; 

// --- 1. INITIALIZE & LISTENERS ---

chrome.storage.local.get("proxy_config", (data) => {
    if(data.proxy_config) applyProxySettings(data.proxy_config);
});

chrome.proxy.onProxyError.addListener((details) => {
    log(`❌ Proxy System Error: ${details.error}`);
    console.error("PAC Error:", details);
});

chrome.webRequest.onAuthRequired.addListener(
    (details) => {
        // Only provide credentials if it is OUR proxy requesting auth
        if (details.isProxy && proxyAuthCreds) {
            // Optional: You could check details.challenger.host to match your proxy host for extra security
            return { authCredentials: { username: proxyAuthCreds.user, password: proxyAuthCreds.pass } };
        }
        return {};
    },
    { urls: ["<all_urls>"] },
    ["blocking"]
);

// --- 2. PROXY SETTINGS (PAC SCRIPT) ---
function applyProxySettings(config) {
    if (!config || !config.enabled || !config.host || !config.port) {
        chrome.proxy.settings.clear({ scope: "regular" });
        proxyAuthCreds = null;
        activeProxyUrl = null;
        log("Proxy: Disabled (Direct Connection)");
        return;
    }

    const scheme = config.proto || "SOCKS5";
    let proxyString = "";
    
    // Construct the proxy return string based on protocol
    if (scheme === "SOCKS5") {
        // SOCKS5 preferred, fall back to SOCKS, then DIRECT
        proxyString = `SOCKS5 ${config.host}:${config.port}; SOCKS ${config.host}:${config.port}`;
    } else {
        proxyString = `PROXY ${config.host}:${config.port}`;
    }

    activeProxyUrl = `${config.host}:${config.port} (${scheme})`;

    // STRICT PAC SCRIPT
    // Uses dnsDomainIs for precise domain matching.
    // EVERYTHING else hits the final 'return "DIRECT"'
    const pacScript = `
        function FindProxyForURL(url, host) {
            var proxy = "${proxyString}; DIRECT";
            
            // Match specific domains strictly
            if (dnsDomainIs(host, "threads.net") || 
                dnsDomainIs(host, ".threads.net") ||
                dnsDomainIs(host, "threads.com") || 
                dnsDomainIs(host, ".threads.com") ||
                dnsDomainIs(host, "instagram.com") || 
                dnsDomainIs(host, ".instagram.com") ||
                dnsDomainIs(host, "cdninstagram.com") || 
                dnsDomainIs(host, ".cdninstagram.com") ||
                dnsDomainIs(host, "fbcdn.net") || 
                dnsDomainIs(host, ".fbcdn.net")) {
                
                return proxy;
            }
            
            // SECURITY: All other traffic MUST use original IP
            return "DIRECT";
        }
    `;

    const configObj = { 
        mode: "pac_script", 
        pacScript: { data: pacScript } 
    };

    // Apply setting. 
    // Note: 'scope: "regular"' is required to affect the main browser profile, 
    // which includes the background script's fetch() requests.
    chrome.proxy.settings.set({ value: configObj, scope: "regular" }, () => {
        if (chrome.runtime.lastError) { 
            log("Proxy Config Error: " + chrome.runtime.lastError.message); 
        } else { 
            log(`✅ Proxy Set: ${activeProxyUrl} (Targeted Only)`); 
        }
    });

    if (config.user && config.pass) { 
        proxyAuthCreds = { user: config.user, pass: config.pass }; 
    } else { 
        proxyAuthCreds = null; 
    }
}

// --- 3. MESSAGING ---
chrome.action.onClicked.addListener((tab) => { 
    if (tab.url) chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.log(e)); 
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "silent_audit") {
    debugLog = []; 
    auditProfileSilent(
        request.username, 
        request.apiKey, 
        request.skipCloudAI, 
        request.cloudModelId, 
        request.language,
        request.customPrompt,
        request.cfCreds,
        request.cfModel,
        request.provider,
        request.ollamaConfig
    ).then(sendResponse);
    return true; 
  }
  if (request.action === "update_proxy") {
      applyProxySettings(request.config);
      return false;
  }
  if (request.action === "fetch_ollama_models") {
    fetch(`${request.url}/api/tags`)
        .then(res => {
            if (!res.ok) throw new Error("Ollama connection failed");
            return res.json();
        })
        .then(data => sendResponse({ success: true, models: data.models || [] }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});

// --- 4. UTILS ---
function decodeUnicode(str) { if (!str) return ""; let result = str.replace(/\\n/g, "\n"); try { if (!result.startsWith('"')) { } } catch (e) {} result = result.replace(/\\u([\d\w]{4})/gi, (match, grp) => String.fromCharCode(parseInt(grp, 16))); return result.replace(/\\/g, ""); }
function extractCaption(htmlString) { const match = htmlString.match(/"caption":\{.*?"text":"((?:[^"\\]|\\.)*)"/); return match ? decodeUnicode(match[1]) : null; }
function extractBio(htmlString, metaDesc) { if (metaDesc && metaDesc.includes(" - ")) { const candidate = metaDesc.split(" - ").slice(1).join(" - ").trim(); if (candidate.length > 0) return decodeUnicode(candidate); } const match = htmlString.match(/"biography":"((?:[^"\\]|\\.)*)"/); return match ? decodeUnicode(match[1]) : ""; }

function extractUserRepliesWithContext(htmlString, targetUser) {
  log(`SCAN: ${targetUser}`);
  let results = [];
  const regex = /"thread_items":\[/g;
  let match;
  const indices = [];
  while ((match = regex.exec(htmlString)) !== null) indices.push(match.index);

  indices.forEach(startIndex => {
    try {
      let bracketCount = 0; let jsonStr = ""; let foundStart = false;
      const arrayStart = htmlString.indexOf('[', startIndex);
      for (let i = arrayStart; i < htmlString.length; i++) {
        const char = htmlString[i]; jsonStr += char;
        if (char === '[') { bracketCount++; foundStart = true; } else if (char === ']') { bracketCount--; }
        if (foundStart && bracketCount === 0) break;
        if (jsonStr.length > 50000) break; 
      }
      const threadItems = JSON.parse(jsonStr);
      threadItems.forEach((item, index) => {
        const post = item.post;
        if (post && post.user && post.user.username === targetUser) {
          const replyText = post.caption ? decodeUnicode(post.caption.text) : "";
          const timestamp = post.taken_at; 
          if (replyText) {
            let contextObj = { user: "Unknown", text: "(Thread Starter)" };
            if (index > 0) {
              const prevPost = threadItems[index - 1].post;
              if (prevPost) contextObj = { user: prevPost.user ? prevPost.user.username : "Unknown", text: prevPost.caption ? decodeUnicode(prevPost.caption.text) : "(Image/Video)" };
            }
            results.push({ reply: { user: targetUser, text: replyText, date: timestamp }, context: contextObj });
          }
        }
      });
    } catch (e) { }
  });

  const uniqueResults = []; const seenText = new Set();
  results.forEach(r => { if (!seenText.has(r.reply.text)) { seenText.add(r.reply.text); uniqueResults.push(r); }});
  uniqueResults.sort((a, b) => b.reply.date - a.reply.date);
  return uniqueResults.slice(0, 5);
}

// --- 5. CLOUD AI & AUDIT LOGIC (Unchanged from original logic, dependencies handled here) ---
// (Keeping the rest of your original logic intact as the issue was isolated to Proxy Settings)

async function analyzeWithCloudAI(username, bio, mainPostText, replyHistory, apiKey, modelId, lang, customPrompt) {
  try {
    const targetModel = modelId || "gemini-2.5-flash"; 
    log(`AI: Init (${targetModel})`);
    
    const conversationLog = replyHistory.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n");
    const historyText = conversationLog.length > 0 ? conversationLog : "(No reply history found)";

    let prompt = "";
    if (customPrompt) {
        prompt = customPrompt.replace("{username}", username).replace("{bio}", bio).replace("{mainPost}", mainPostText).replace("{replyHistory}", historyText).replace("{lang}", lang || 'English');
    } else {
        prompt = `Role: Ruthless Bot Hunter. Target Profile: @${username}. Bio: "${bio}". Main Post Content: "${mainPostText}". Reply History: ${historyText}. Audit this user. Return JSON: { "bot_probability": number, "reason": "explanation in ${lang || 'English'}" }`;
    }
    
    log("AI: Sending... (Direct Connection)");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if(data.error) throw new Error(data.error.message);
    const jsonStr = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(jsonStr);
    const scoreVal = (typeof result.bot_probability === 'number') ? result.bot_probability : 0;
    log(`AI: Result ${scoreVal}% - ${result.reason}`);
    return { score: scoreVal, reason: result.reason, skipped: false };
  } catch (e) { log(`AI Error: ${e.message}`); return { score: 0, reason: "AI Failed", skipped: true }; }
}

async function analyzeWithCloudflare(username, bio, mainPostText, replyHistory, creds, modelId, lang, customPrompt) {
    try {
        // ... (Same as original code)
        const targetModel = modelId || "@cf/meta/llama-3-8b-instruct"; 
        const conversationLog = replyHistory.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n");
        const historyText = conversationLog.length > 0 ? conversationLog : "(No reply history found)";
        let promptText = customPrompt ? customPrompt.replace("{username}", username).replace("{bio}", bio).replace("{mainPost}", mainPostText).replace("{replyHistory}", historyText).replace("{lang}", lang || 'English') : `Audit @${username}. JSON only.`;
        const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${targetModel}`;
        const response = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${creds.apiToken}`, "Content-Type": "application/json"}, body: JSON.stringify({ messages: [{ role: "system", content: "JSON only." }, { role: "user", content: promptText }] }) });
        const data = await response.json();
        if(!data.success) throw new Error(data.errors[0].message);
        const result = JSON.parse(data.result.response.replace(/```json|```/g, "").trim());
        return { score: result.bot_probability || 0, reason: result.reason, skipped: false };
    } catch(e) { log(`CF AI Error: ${e.message}`); return { score: 0, reason: "CF AI Failed", skipped: true }; }
}

async function analyzeWithOllama(username, bio, mainPostText, replyHistory, config, lang, customPrompt) {
    try {
        const url = config.url || "http://localhost:11434";
        const model = config.model || "llama3";
        const conversationLog = replyHistory.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n");
        const historyText = conversationLog.length > 0 ? conversationLog : "(No reply history found)";
        let promptText = customPrompt ? customPrompt.replace("{username}", username).replace("{bio}", bio).replace("{mainPost}", mainPostText).replace("{replyHistory}", historyText).replace("{lang}", lang || 'English') : `Audit @${username}. JSON only.`;
        const response = await fetch(`${url}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model, stream: false, messages: [{ role: "system", content: "JSON only." }, { role: "user", content: promptText }], options: { temperature: 0.1 } }) });
        if (!response.ok) throw new Error("Connection failed");
        const data = await response.json();
        const result = JSON.parse(data.message.content.replace(/```json|```/g, "").trim());
        return { score: result.bot_probability || 0, reason: result.reason, skipped: false };
    } catch (e) { log(`Ollama Error: ${e.message}`); return { score: 0, reason: "Ollama Failed", skipped: true }; }
}

async function auditProfileSilent(username, apiKey, skipCloudAI, cloudModelId, lang, customPrompt) {
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/html' };
    if (activeProxyUrl) { log(`🌍 FETCH VIA PROXY: ${activeProxyUrl}`); } else { log(`🌍 FETCH DIRECT (No Proxy)`); }
    
    // This fetch request will adhere to the PAC script defined above.
    const mainRes = await fetch(`https://www.threads.net/@${username}`, { headers });
    
    if (!mainRes.ok) {
        if(mainRes.status === 407) return { success: false, error: "Proxy Auth Failed" };
        if(mainRes.status === 429) return { success: false, error: "Rate Limit" };
        return { success: false, error: `HTTP ${mainRes.status}` };
    }
    const mainHtml = await mainRes.text();
    // ... (Extraction logic remains same as original)
    const metaImg = mainHtml.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    const avatarUrl = metaImg ? metaImg[1] : null;
    const metaDesc = (mainHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/) || [])[1] || "";
    const jsonFollower = mainHtml.match(/"follower_count":(\d+)/);
    let displayFollowers = jsonFollower ? parseInt(jsonFollower[1]).toLocaleString() : "Hidden";
    if (displayFollowers === "Hidden") { const m = metaDesc.match(/([0-9.,KMB]+)\s+Followers/i); if (m) displayFollowers = m[1]; }
    const metaTitle = mainHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
    let realName = metaTitle ? decodeUnicode(metaTitle[1].split('(')[0].trim()) : username;
    let bioText = extractBio(mainHtml, metaDesc);
    const totalVisiblePosts = (mainHtml.match(/"taken_at":(\d{10})/g) || []).length;
    let mainPost = { date: null, text: null, exists: false };
    const mainTime = mainHtml.match(/"taken_at":(\d{10})/);
    if (mainTime) { mainPost.date = new Date(parseInt(mainTime[1]) * 1000); mainPost.exists = true; mainPost.text = extractCaption(mainHtml) || "(Image/Video Post)"; }

    let replyData = { exists: false, date: null, history: [], avgLength: 999 };
    try {
      const replyRes = await fetch(`https://www.threads.net/@${username}/replies`, { headers });
      const replyHtml = await replyRes.text();
      replyData.history = extractUserRepliesWithContext(replyHtml, username);
      if (replyData.history.length > 0) { replyData.exists = true; replyData.date = new Date(replyData.history[0].reply.date * 1000); const total = replyData.history.reduce((acc, item) => acc + item.reply.text.length, 0); replyData.avgLength = Math.round(total / replyData.history.length); }
    } catch (e) { log(`Reply Err: ${e.message}`); }

    let aiResult = { score: 0, reason: null, skipped: true };
    if (!skipCloudAI) {
        const provider = arguments[8] || "cloud"; 
        const cfCreds = arguments[6]; const cfModel = arguments[7]; const ollamaConfig = arguments[9];
        if (provider === "cloudflare" && cfCreds) aiResult = await analyzeWithCloudflare(username, bioText, mainPost.text, replyData.history, cfCreds, cfModel, lang, customPrompt);
        else if (provider === "ollama" && ollamaConfig) aiResult = await analyzeWithOllama(username, bioText, mainPost.text, replyData.history, ollamaConfig, lang, customPrompt);
        else if (provider === "cloud" && apiKey) aiResult = await analyzeWithCloudAI(username, bioText, mainPost.text, replyData.history, apiKey, cloudModelId, lang, customPrompt);
    }

    let latestDate = mainPost.date || replyData.date;
    if (mainPost.date && replyData.date) latestDate = (mainPost.date > replyData.date) ? mainPost.date : replyData.date;
    let daysInactive = latestDate ? Math.ceil(Math.abs(new Date() - latestDate) / (86400000)) : 0;
    let ruleScore = 0; let checks = [];
    if (displayFollowers !== "Hidden") { let raw = displayFollowers.replace(/,/g,'').replace('K','000').replace('M','000000'); if (parseFloat(raw) < 5) { ruleScore += 20; checks.push({ key: "lowF", val: displayFollowers, score: 20 }); } }
    if (!mainPost.exists) { ruleScore += 40; checks.push({ key: "noMain", score: 40 }); } else if (totalVisiblePosts < 4) { ruleScore += 40; checks.push({ key: "lowAct", score: 40 }); }
    if (latestDate && daysInactive > 180) { ruleScore += 40; checks.push({ key: "inactive" }); }
    if (!avatarUrl || avatarUrl.includes("default_profile")) { ruleScore += 20; checks.push({ key: "defAv", score: 20 }); }
    if (!replyData.exists || replyData.history.length === 0) { ruleScore += 60; checks.push({ key: "noRep", score: 60 }); } else if (replyData.history.length < 2) { ruleScore += 20; checks.push({ key: "fewRep", score: 20 }); }
    if (replyData.exists && replyData.avgLength < 15) { ruleScore += 20; checks.push({ key: "shortRep", val: `Avg ${replyData.avgLength}`, score: 20 }); }
    let finalScore = ruleScore;
    if (!aiResult.skipped) {
        let sourceLabel = arguments[8] === "cloudflare" ? "Cloudflare AI" : arguments[8] === "ollama" ? "Ollama (Local)" : "Gemini AI";
        checks.push({ special: `🤖 ${sourceLabel}: ${aiResult.score}/100` }); if (aiResult.reason) checks.push({ special: `📝 ${aiResult.reason}` }); finalScore = aiResult.score; 
    }

    return { success: true, username, realName, followerCount: displayFollowers, bioSnippet: bioText, avatar: avatarUrl, mainPost: { text: mainPost.text, dateStr: mainPost.date ? mainPost.date.toLocaleDateString() : "-", exists: mainPost.exists }, replyData, postCount: totalVisiblePosts, daysInactive, score: Math.min(100, finalScore), checklist: checks, debugLog };
  } catch (e) { log(`❌ Network Error: ${e.message}`); if (activeProxyUrl) { log("⚠️ PROXY TIMEOUT? Try a different server."); } return { success: false, error: activeProxyUrl ? "Proxy Timeout" : "Network Error" }; }
}