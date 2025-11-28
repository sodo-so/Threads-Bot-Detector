(function() {
  if (window.hasThreadsExtractorLoaded) return;
  window.hasThreadsExtractorLoaded = true;

  let isWorking = false; // Covers both waiting and scrolling
  let waitInterval = null;
  let collectedUsers = new Set();

  // --- Helpers ---
  
  const sleep = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

  function getScrollContainer(modal) {
    const divs = modal.querySelectorAll('div');
    for (let div of divs) {
      const style = window.getComputedStyle(div);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return div;
    }
    return modal; // Fallback
  }

  function scrapeCurrentView(modal) {
    const links = modal.querySelectorAll('a[href^="/@"]');
    const ignore = ['login', 'search', 'activity'];
    let count = 0;
    links.forEach(link => {
      const u = link.getAttribute('href').replace('/@', '').replace('/', '').split('?')[0];
      if (u && !ignore.includes(u.toLowerCase()) && !collectedUsers.has(u)) {
        collectedUsers.add(u);
        count++;
      }
    });
    return count;
  }

  // --- Main Logic ---

  async function startAutoScroll(modal) {
    // Notify panel that we found the list and are starting
    chrome.runtime.sendMessage({ action: "extraction_started" });

    const scrollContainer = getScrollContainer(modal);
    let consecutiveNoNewItems = 0;

    // Initial scrape
    scrapeCurrentView(modal);

    while (isWorking) {
      // 1. Scroll
      scrollContainer.scrollTop += 500;
      
      // 2. Wait (Simulate human reading)
      await sleep(800, 1500);

      // 3. Scrape
      const newFound = scrapeCurrentView(modal);
      
      // 4. Report Progress
      chrome.runtime.sendMessage({ action: "extraction_progress", count: collectedUsers.size });

      // 5. End of list detection
      if (newFound === 0) consecutiveNoNewItems++;
      else consecutiveNoNewItems = 0;

      // Check if physically at bottom or just stuck
      const isAtBottom = Math.abs(scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight) < 5;
      
      if (isAtBottom || consecutiveNoNewItems > 6) {
        // One last wait to be sure network isn't just slow
        await sleep(1500, 2000);
        if (scrapeCurrentView(modal) === 0) break; 
      }
    }

    finishExtraction();
  }

  function finishExtraction() {
    isWorking = false;
    if (waitInterval) clearInterval(waitInterval);
    
    chrome.runtime.sendMessage({
      action: "extraction_complete",
      success: true,
      count: collectedUsers.size,
      data: Array.from(collectedUsers)
    });
  }

  function initiateProcess() {
    isWorking = true;
    collectedUsers.clear();

    // 1. Check if modal exists immediately
    const modal = document.querySelector('div[role="dialog"]');
    
    if (modal) {
      startAutoScroll(modal);
    } else {
      // 2. If not, tell Panel to tell User to open it
      chrome.runtime.sendMessage({ action: "waiting_for_modal" });
      
      // 3. Start Polling Loop
      waitInterval = setInterval(() => {
        if (!isWorking) { clearInterval(waitInterval); return; }
        
        const foundModal = document.querySelector('div[role="dialog"]');
        if (foundModal) {
          clearInterval(waitInterval);
          startAutoScroll(foundModal); // Auto-start once found
        }
      }, 1000); // Check every second
    }
  }

  // --- Listener ---

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "extract_followers") {
      if (isWorking) return; // Prevent double click
      initiateProcess();
    }
    
    if (req.action === "stop_extraction") {
      isWorking = false;
      if (waitInterval) clearInterval(waitInterval);
      // Send back whatever we have so far
      sendResponse({ success: true, count: collectedUsers.size });
      // Also trigger the complete flow
      finishExtraction();
    }
  });

})();