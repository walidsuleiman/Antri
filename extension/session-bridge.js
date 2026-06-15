/* Runs on antri.xyz. Mirrors the signed-in Supabase access token into the
   extension's storage so the popup can authenticate /api/extract-page calls.
   The app keeps its session in localStorage under "antri.supabase.session.<host>". */
(function () {
  "use strict";

  function readSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf("antri.supabase.session.") === 0) {
          var session = JSON.parse(localStorage.getItem(key));
          if (session && session.access_token) {
            return { access_token: session.access_token, expires_at: Number(session.expires_at) || 0 };
          }
        }
      }
    } catch (error) {
      /* ignore parse/storage errors */
    }
    return null;
  }

  function sync() {
    var session = readSession();
    try {
      if (session) {
        chrome.storage.local.set({ antriSession: session });
      } else {
        chrome.storage.local.remove("antriSession");
      }
    } catch (error) {
      /* extension context can briefly be unavailable; ignore */
    }
  }

  sync();
  // Keep the cached token fresh while Antri is open (the app refreshes it).
  window.addEventListener("focus", sync);
  setInterval(sync, 60000);
})();
