// Portal SDK adapter: auto-detects CrazyGames or Poki (whichever script the
// build's index.html includes) and exposes one interface to the game.
// Inert when neither is present, so the same code runs on itch.io and
// GitHub Pages unchanged.
export const CG = {
  backend: null,   // 'crazygames' | 'poki' | null

  async init() {
    if (window.CrazyGames && window.CrazyGames.SDK) {
      try {
        await window.CrazyGames.SDK.init();
        // Active everywhere except explicitly disabled domains, so CrazyGames'
        // QA/preview environments detect the SDK calls too.
        if (window.CrazyGames.SDK.environment !== 'disabled') this.backend = 'crazygames';
      } catch (e) { /* stay inactive */ }
    } else if (window.PokiSDK) {
      try {
        await window.PokiSDK.init();
        window.PokiSDK.gameLoadingFinished();
        this.backend = 'poki';
      } catch (e) { /* stay inactive */ }
    }
  },

  get active() { return !!this.backend; },

  _cg(fn) { try { fn(window.CrazyGames.SDK); } catch (e) { /* never break the game */ } },
  _poki(fn) { try { fn(window.PokiSDK); } catch (e) { /* never break the game */ } },

  gameplayStart() {
    if (this.backend === 'crazygames') this._cg(s => s.game.gameplayStart());
    else if (this.backend === 'poki') this._poki(p => p.gameplayStart());
  },

  gameplayStop() {
    if (this.backend === 'crazygames') this._cg(s => s.game.gameplayStop());
    else if (this.backend === 'poki') this._poki(p => p.gameplayStop());
  },

  happytime() {
    if (this.backend === 'crazygames') this._cg(s => s.game.happytime());
  },

  // Multiplayer invite links (CrazyGames is synchronous, Poki is async).
  inviteUrl(code) {
    if (this.backend === 'crazygames') {
      try { return window.CrazyGames.SDK.game.inviteLink({ room: code }); } catch (e) { return null; }
    }
    return null;
  },

  async pokiShareUrl(code) {
    if (this.backend !== 'poki') return null;
    try { return await window.PokiSDK.shareableURL({ room: code }); } catch (e) { return null; }
  },

  inviteParam() {
    if (this.backend === 'crazygames') {
      try { return window.CrazyGames.SDK.game.getInviteParam('room'); } catch (e) { return null; }
    }
    if (this.backend === 'poki') {
      try { return window.PokiSDK.getURLParam('room'); } catch (e) { return null; }
    }
    return null;
  },

  // True when a party leader launched the game expecting to land in a lobby.
  get instantMultiplayer() {
    if (this.backend !== 'crazygames') return false;
    try { return !!window.CrazyGames.SDK.game.isInstantMultiplayer; } catch (e) { return false; }
  },

  showInviteButton(code) {
    if (this.backend === 'crazygames') this._cg(s => s.game.showInviteButton({ room: code }));
  },

  hideInviteButton() {
    if (this.backend === 'crazygames') this._cg(s => s.game.hideInviteButton());
  },

  // Midgame ad at a natural break. Mutes audio during the ad and ALWAYS
  // calls done() — even on error or timeout — so the game can never get stuck.
  midgameAd(sfx, done) {
    if (!this.backend) { done(); return; }
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
      if (this.backend === 'poki') {
        window.PokiSDK.commercialBreak(() => {}).then(finish).catch(finish);
      } else {
        window.CrazyGames.SDK.ad.requestAd('midgame', {
          adStarted: () => {},
          adFinished: finish,
          adError: finish,
        });
      }
      setTimeout(finish, 30000);   // safety net
    } catch (e) { finish(); }
  },
};
