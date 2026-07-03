import { VocabSprintGame } from "./game.js";

const game = new VocabSprintGame();
game.init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {
      // The app still works without persistent caching.
    });
  });
}
