(function() {
  if (window.hasThreadsExtractorLoaded) return;
  window.hasThreadsExtractorLoaded = true;

  function extractFollowers() {
    // 1. Find the Modal
    const modal = document.querySelector('div[role="dialog"]');
    
    if (!modal) {
      return { 
        success: false, 
        error: "errModalMissing" // Changed to key
      };
    }

    // 2. Find links inside the modal
    const links = modal.querySelectorAll('a[href^="/@"]');
    
    if (links.length === 0) {
      return { success: false, error: "errListEmpty" }; // Changed to key
    }

    let followers = new Set();
    const ignore = ['login', 'search', 'activity'];

    links.forEach(link => {
      const username = link.getAttribute('href').replace('/@', '').replace('/', '').split('?')[0];
      if (username && !ignore.includes(username.toLowerCase())) {
        followers.add(username);
      }
    });

    return {
      success: true,
      count: followers.size,
      data: Array.from(followers)
    };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract_followers") {
      sendResponse(extractFollowers());
    }
  });
})();