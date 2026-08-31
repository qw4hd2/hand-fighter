// CrazyGames SDK v3 adapter. Inert everywhere except on crazygames.com,
// so the exact same build runs on itch.io / GitHub Pages unchanged.
export const CG = {
  active: false,

  async init() {
    const SDK = window.CrazyGames && window.CrazyGames.SDK;
    if (!SDK) return;
    try {
      await SDK.init();
      this.active = SDK.environment === 'crazygames';
    } catch (e) { this.active = false; }
  },

  _call(fn) {
    if (!this.active) return;
    try { fn(window.CrazyGames.SDK); } catch (e) { /* SDK hiccup — never break the game */ }
  },

  gameplayStart() { this._call(s => s.game.gameplayStart()); },
  gameplayStop() { this._call(s => s.game.gameplayStop()); },
  happytime() { this._call(s => s.game.happytime()); },

  // Multiplayer invite links: turns our room codes into shareable CrazyGames URLs.
  inviteUrl(code) {
    if (!this.active) return null;
    try { return window.CrazyGames.SDK.game.inviteLink({ room: code }); } catch (e) { return null; }
  },

  inviteParam() {
    if (!this.active) return null;
    try { return window.CrazyGames.SDK.game.getInviteParam('room'); } catch (e) { return null; }
  },

  // True when a party leader launched the game expecting to land in a lobby.
  get instantMultiplayer() {
    if (!this.active) return false;
    try { return !!window.CrazyGames.SDK.game.isInstantMultiplayer; } catch (e) { return false; }
  },

  showInviteButton(code) { this._call(s => s.game.showInviteButton({ room: code })); },
  hideInviteButton() { this._call(s => s.game.hideInviteButton()); },

  // Midgame ad at a natural break. Mutes audio during the ad and ALWAYS
  // calls done() — even on error or timeout — so the game can never get stuck.
  midgameAd(sfx, done) {
    if (!this.active) { done(); return; }
    let finished = false;
    const wasMuted = sfx.muted;
    const finish = () => {
      if (finished) return;
      finished = true;
      sfx.setMuted(wasMuted);
      done();
    };
    try {
      sfx.stopMusic();
      sfx.setMuted(true);
      window.CrazyGames.SDK.ad.requestAd('midgame', {
        adStarted: () => {},
        adFinished: finish,
        adError: finish,
      });
      setTimeout(finish, 30000);   // safety net
    } catch (e) { finish(); }
  },
};
