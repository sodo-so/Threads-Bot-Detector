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
});

chrome.webRequest.onAuthRequired.addListener(
    (details) => {
        if (details.isProxy && proxyAuthCreds) {
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
    if (scheme === "SOCKS5") {
        proxyString = `SOCKS5 ${config.host}:${config.port}; SOCKS ${config.host}:${config.port}`;
    } else {
        proxyString = `PROXY ${config.host}:${config.port}`;
    }

    activeProxyUrl = `${config.host}:${config.port} (${scheme})`;

    const pacScript = `
        function FindProxyForURL(url, host) {
            // Route Threads/Instagram through Proxy, everything else Direct (like AI API)
            if (shExpMatch(host, "*.threads.net") || 
                shExpMatch(host, "*.threads.com") || 
                shExpMatch(host, "*.instagram.com") || 
                shExpMatch(host, "*.cdninstagram.com") || 
                shExpMatch(host, "*.fbcdn.net")) {
                return "${proxyString}; DIRECT"; 
            }
            return "DIRECT";
        }
    `;

    const configObj = { mode: "pac_script", pacScript: { data: pacScript } };

    chrome.proxy.settings.set({ value: configObj, scope: "regular" }, () => {
        if (chrome.runtime.lastError) { log("Proxy Config Error: " + chrome.runtime.lastError.message); } 
        else { log(`✅ Proxy Set: ${activeProxyUrl}`); }
    });

    if (config.user && config.pass) { proxyAuthCreds = { user: config.user, pass: config.pass }; } else { proxyAuthCreds = null; }
}

// --- 3. MESSAGING ---
chrome.action.onClicked.addListener((tab) => { if (tab.url) chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.log(e)); });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "silent_audit") {
    debugLog = []; 
    // Pass customPrompt to the audit function
    auditProfileSilent(
        request.username, 
        request.apiKey, 
        request.skipCloudAI, 
        request.cloudModelId, 
        request.language,
        request.customPrompt
    ).then(sendResponse);
    return true; 
  }
  if (request.action === "update_proxy") {
      applyProxySettings(request.config);
      return false;
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

// --- 5. CLOUD AI (GEMINI) ---
async function analyzeWithCloudAI(username, bio, mainPostText, replyHistory, apiKey, modelId, lang, customPrompt) {
  try {
    const targetModel = modelId || "gemini-2.5-flash"; 
    log(`AI: Init (${targetModel})`);
    
    const conversationLog = replyHistory.map(r => `- Context: "${r.context.text}"\n  Reply: "${r.reply.text}"`).join("\n");
    const historyText = conversationLog.length > 0 ? conversationLog : "(No reply history found)";

    let prompt = "";

    if (customPrompt) {
        // Use custom prompt and replace variables
        prompt = customPrompt
            .replace("{username}", username)
            .replace("{bio}", bio)
            .replace("{mainPost}", mainPostText)
            .replace("{replyHistory}", historyText)
            .replace("{lang}", lang || 'English');
    } else {
        // Fallback to hardcoded default if custom prompt is missing
        prompt = `
        Role: Ruthless Bot Hunter.
        Target Profile: @${username}
        Bio: "${bio}"
        Main Post Content: "${mainPostText}"
        Reply History: ${historyText}

        INSTRUCTIONS:
        You are auditing "Follower Farms". Assume this user is a BOT until proven otherwise.
        
        SCORING RULES (0 = Human, 100 = Bot):
        - **LACK OF CONTENT IS GUILT**: If 'Main Post' is empty/generic AND 'Bio' is weak/empty -> Score MUST be 90-100.
        - **NO PERSONALITY**: If text is generic ("Life is good", "Happy"), treat it as a script -> Score 80+.
        - **ZERO EFFORT**: No replies + Low content = 100% Bot Probability.
        
        Do not be nice. If the data is thin, flag it as a bot.

        Return JSON only: { "bot_probability": number, "reason": "Aggressive explanation in ${lang || 'English'}" }
        `;
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
  } catch (e) { 
    log(`AI Error: ${e.message}`); 
    return { score: 0, reason: "AI Failed", skipped: true }; 
  }
}

// --- 6. MAIN AUDIT ---
async function auditProfileSilent(username, apiKey, skipCloudAI, cloudModelId, lang, customPrompt) {
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'text/html' };
    
    if (activeProxyUrl) { log(`🌍 FETCH VIA PROXY: ${activeProxyUrl}`); } else { log(`🌍 FETCH DIRECT (No Proxy)`); }

    const mainRes = await fetch(`https://www.threads.net/@${username}`, { headers });
    if (!mainRes.ok) {
        if(mainRes.status === 407) return { success: false, error: "Proxy Auth Failed" };
        if(mainRes.status === 429) return { success: false, error: "Rate Limit" };
        return { success: false, error: `HTTP ${mainRes.status}` };
    }
    const mainHtml = await mainRes.text();

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
    if (mainTime) {
      mainPost.date = new Date(parseInt(mainTime[1]) * 1000);
      mainPost.exists = true;
      mainPost.text = extractCaption(mainHtml) || "(Image/Video Post)";
    }

    let replyData = { exists: false, date: null, history: [], avgLength: 999 };
    try {
      const replyRes = await fetch(`https://www.threads.net/@${username}/replies`, { headers });
      const replyHtml = await replyRes.text();
      replyData.history = extractUserRepliesWithContext(replyHtml, username);
      if (replyData.history.length > 0) {
          replyData.exists = true;
          replyData.date = new Date(replyData.history[0].reply.date * 1000);
          const total = replyData.history.reduce((acc, item) => acc + item.reply.text.length, 0);
          replyData.avgLength = Math.round(total / replyData.history.length);
      }
    } catch (e) { log(`Reply Err: ${e.message}`); }

    let aiResult = { score: 0, reason: null, skipped: true };
    if (skipCloudAI) {
        log("AI: Disabled / Handled by Frontend");
    } else if (!apiKey) {
        log("AI: Skipped (No Key)");
    } else {
        if (replyData.history.length === 0) log("AI: Running (No Replies - Bio/Post Only)");
        aiResult = await analyzeWithCloudAI(username, bioText, mainPost.text, replyData.history, apiKey, cloudModelId, lang, customPrompt);
    }

    let latestDate = mainPost.date || replyData.date;
    if (mainPost.date && replyData.date) latestDate = (mainPost.date > replyData.date) ? mainPost.date : replyData.date;
    let daysInactive = latestDate ? Math.ceil(Math.abs(new Date() - latestDate) / (86400000)) : 0;

    // --- RULES (Updated to return KEYS instead of text) ---
    let ruleScore = 0;
    let checks = [];

    if (displayFollowers !== "Hidden") {
       let raw = displayFollowers.replace(/,/g,'').replace('K','000').replace('M','000000');
       if (parseFloat(raw) < 5) { 
         ruleScore += 20; 
         checks.push({ key: "lowF", val: displayFollowers, score: 20 });
       }
    }

    if (!mainPost.exists) { 
        ruleScore += 40; 
        checks.push({ key: "noMain", score: 40 });
    } 
    else if (totalVisiblePosts < 4) { 
        ruleScore += 40; 
        checks.push({ key: "lowAct", score: 40 }); 
    }
    
    if (latestDate && daysInactive > 180) { 
        ruleScore += 40; 
        checks.push({ key: "inactive" }); 
    }
    
    if (!avatarUrl || avatarUrl.includes("default_profile")) { 
        ruleScore += 20; 
        checks.push({ key: "defAv", score: 20 }); 
    }

    if (!replyData.exists || replyData.history.length === 0) {
        ruleScore += 60; 
        checks.push({ key: "noRep", score: 60 });
    } else if (replyData.history.length < 2) {
        ruleScore += 20; 
        checks.push({ key: "fewRep", score: 20 });
    }

    if (replyData.exists && replyData.avgLength < 15) {
        ruleScore += 20; 
        checks.push({ key: "shortRep", val: `Avg ${replyData.avgLength}`, score: 20 });
    }

    let finalScore = ruleScore;
    
    if (!aiResult.skipped) {
        checks.push({ special: `🤖 Gemini AI: ${aiResult.score}/100` });
        if (aiResult.reason) checks.push({ special: `📝 ${aiResult.reason}` });
        
        finalScore = aiResult.score; // AI overrides Rule score
    }

    return {
      success: true, username, realName, followerCount: displayFollowers, bioSnippet: bioText, avatar: avatarUrl,
      mainPost: { text: mainPost.text, dateStr: mainPost.date ? mainPost.date.toLocaleDateString() : "-", exists: mainPost.exists },
      replyData, postCount: totalVisiblePosts, daysInactive, 
      score: Math.min(100, finalScore),
      checklist: checks, debugLog
    };
  } catch (e) { 
      log(`❌ Network Error: ${e.message}`);
      if (activeProxyUrl) {
          log("⚠️ PROXY TIMEOUT? Try a different server.");
      }
      return { success: false, error: activeProxyUrl ? "Proxy Timeout" : "Network Error" }; 
  }
}