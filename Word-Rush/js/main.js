import { VocabSprintGame } from "./game.js";

const game = new VocabSprintGame();
game.init();

// スマホでのピンチズームを抑止する。
(() => {
  // iOS Safari のジェスチャによる拡大を無効化。
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }

  // 2本指以上のタッチ移動（ピンチ）を無効化。
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  // ダブルタップによるズームを無効化。
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
})();

// PWAインストール（ホーム画面に追加）ボタンの制御。
(() => {
  const button = document.getElementById("pwaInstallButton");
  if (!button) {
    return;
  }

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const syncStandaloneClass = () => {
    document.body.classList.toggle("is-standalone", isStandalone());
  };

  let deferredPrompt = null;

  const hideButton = () => {
    document.body.classList.remove("can-install");
    button.classList.add("hidden");
    deferredPrompt = null;
  };

  syncStandaloneClass();
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", syncStandaloneClass);

  // Chromium 系: インストール可能になったらプロンプトを保持してボタンを表示。
  window.addEventListener("beforeinstallprompt", (event) => {
    if (isStandalone()) {
      return;
    }
    event.preventDefault();
    deferredPrompt = event;
    button.classList.remove("hidden");
    document.body.classList.add("can-install");
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      return;
    }
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    button.disabled = true;
    try {
      promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // プロンプト表示に失敗しても致命的ではない。
    }
    button.disabled = false;
    hideButton();
  });

  // インストール完了、またはすでにアプリ起動中なら非表示。
  window.addEventListener("appinstalled", hideButton);
  if (isStandalone()) {
    hideButton();
  }
})();

// 可能な環境では画面を縦向きに固定する（フルスクリーン/インストール済みPWAでのみ有効）。
(() => {
  const lock = () => {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      screen.orientation.lock("portrait").catch(() => {
        // タブ表示中などロック不可の環境では CSS のガード表示にフォールバックする。
      });
    }
  };
  lock();
  window.addEventListener("orientationchange", lock);
})();

// 横向きになったらプレイ中のゲームを一時停止する（縦向きガード表示と同じ条件）。
(() => {
  const landscape = window.matchMedia("(orientation: landscape) and (max-height: 560px)");
  const handle = (event) => {
    if (event.matches && game.state.phase === "playing") {
      game.pauseGame();
    }
  };
  if (typeof landscape.addEventListener === "function") {
    landscape.addEventListener("change", handle);
  } else if (typeof landscape.addListener === "function") {
    landscape.addListener(handle);
  }
  handle(landscape);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.getRegistration()
      .then((registration) => {
        if (!registration && !navigator.serviceWorker.controller) {
          return null;
        }
        return navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
          .then((nextRegistration) => nextRegistration.update());
      })
      .catch(() => {
        // The app still works without persistent caching.
      });
  });
}
