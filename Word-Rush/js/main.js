import { VocabSprintGame } from "./game.js";

const game = new VocabSprintGame();
game.init();

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
