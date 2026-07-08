import { VocabSprintGame } from "./game.js";

const game = new VocabSprintGame();
game.init();

// iOSのDynamic Island/ロック画面に音の情報（Now Playing）を出さないようにする。
// ゲーム音を「メディア再生」ではなく「ambient（ゲーム/環境音）」として扱うことで、
// 単語を発音するたびにNow Playingが点滅したり、ロック画面に再生コントロールが出るのを防ぐ。
// トレードオフ: ambientは消音スイッチ（サイレント）をONにすると音が鳴らなくなる（ゲームとして自然な挙動）。
(() => {
  const applyAmbientAudioSession = () => {
    const session = globalThis.navigator?.audioSession;
    if (session && "type" in session) {
      try {
        session.type = "ambient";
      } catch {
        // 未対応・設定不可の環境では何もしない（PC/Androidには影響なし）。
      }
    }
    if (globalThis.navigator?.mediaSession) {
      try {
        globalThis.navigator.mediaSession.metadata = null;
      } catch {
        // ignore
      }
    }
  };
  applyAmbientAudioSession();
  // 一部環境では復帰時にリセットされることがあるため、可視状態が戻ったら再適用する。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      applyAmbientAudioSession();
    }
  });
})();

// スマホでのピンチズームを抑止する。
(() => {
  const preventDefaultIfCancelable = (event) => {
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  // iOS Safari のジェスチャによる拡大を無効化。
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, preventDefaultIfCancelable, { passive: false });
  }

  // 2本指以上のタッチ移動（ピンチ）を無効化。
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) {
        preventDefaultIfCancelable(event);
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
        preventDefaultIfCancelable(event);
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
