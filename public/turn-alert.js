'use strict';
// "TE JÖSSZ!" jelzés: ha a játékosnak most teendője van (a saját beszéde, döntés a tiltakozásról, a tiltakozásra adott válasz, szavazás,
// kihívás-szavazás, kihívás-ellenőrzés bíróként, válasz egy esküdt-kérdésre), egyszer rezeg (telefonon), csippan ("ding") és rövid értesítést mutat.
//   - csak ÚJ teendőnél (a teendő kulcsa: fázis + kör + az alfeladat), ugyanarra nem ismétel
//   - ha az oldal épp háttérben volt (pl. átváltott a Discordra), a visszatéréskor jelez, ha a teendő még áll
//     (háttérben a böngésző nem enged rezegni – ehhez értesítés-engedély kellene, azt a játék nem kér)
//   - a rezgés kikapcsolható: localStorage kb_vibrate = '0'; a hang a meglévő némítással együtt némul (kbSound)
//   - néző módban (window.KB_WATCH) nincs jelzés
// window.kbTurnAlert.current() a teszteknek: { key, text }.
(function () {
  if (window.KB_WATCH) return;
  const SPEAKER = { prosecution: 'prosecutorId', defense: 'defendantId', defender: 'defenderId', witness: 'witnessId', final_prosecution: 'prosecutorId', final_defense: 'defendantId' };
  const SPEAK_TEXT = { prosecution: 'a vádbeszéded', defense: 'a védekezésed', defender: 'a védőbeszéded', witness: 'a tanúvallomásod', final_prosecution: 'a zárószavad', final_defense: 'a zárószavad' };
  let lastKey = '', pendingKey = '', pendingText = '';

  // a játékos most esedékes teendője a szerver állapotából (S) – üres, ha nincs
  function duty() {
    if (typeof S === 'undefined' || !S || !MY || !MY.playerId) return null;
    const me = MY.playerId, round = (S.caseNo || '') + ':' + (S.round || 0) + ':';
    const ph = S.phase;
    if (SPEAKER[ph] && S[SPEAKER[ph]] === me) return { key: round + 'speak:' + ph, text: '🎤 Te jössz: ' + SPEAK_TEXT[ph] + '!' };
    if (ph === 'objection' && S.objectionData) {
      const od = S.objectionData;
      if (od.phase === 'judge' && S.currentJudgeId === me) return { key: round + 'obj-judge:' + (od.objectorId || ''), text: '⚖️ TILTAKOZOM! – döntsd el, jogos-e.' };
      if (od.phase === 'defense' && od.speakerId === me) return { key: round + 'obj-def:' + (od.objectorId || ''), text: '🛡️ Tiltakoztak ellened – válaszolj!' };
    }
    if (ph === 'verdict_vote' && S.verdictVote && S.verdictVote.canVote && !S.verdictVote.myVote) return { key: round + 'vote', text: '🗳️ Szavazz: bűnös vagy ártatlan?' };
    if (ph === 'challenge_vote' && S.challengeVote && S.challengeVote.canVote) {
      const mine = S.challengeVote.myVotes || {};
      if ((S.challengeVote.challenges || []).some((c) => mine[c.who] === undefined)) return { key: round + 'cvote', text: '⚔️ Szavazz: teljesítették a kihívást?' };
    }
    if (ph === 'challenge_review' && S.challengeReview) {
      const cur = (S.challengeReview.challenges || [])[S.challengeReview.current || 0];
      if (cur && cur.iAmJudge && !cur.judged) return { key: round + 'review:' + (S.challengeReview.current || 0), text: '⚔️ Bíróként ellenőrizd a kihívást!' };
    }
    if (ph === 'jury_question' && S.juryQuestion && S.juryQuestion.canAnswer) return { key: round + 'answer', text: '❓ Kérdést kaptál – válaszolj!' };
    return null;
  }
  const vibrateOn = () => { try { return localStorage.getItem('kb_vibrate') !== '0'; } catch (_) { return true; } };
  function alertNow(text) {
    try { if (vibrateOn() && navigator.vibrate) navigator.vibrate([140, 70, 140]); } catch (_) { /* nem támogatott */ }
    try { if (window.kbSound && window.kbSound.play) window.kbSound.play('ding'); } catch (_) { /* a hang nem kötelező */ }
    try { if (typeof showToast === 'function') showToast(text); } catch (_) { /* */ }
  }
  function check() {
    const d = duty();
    if (!d) { pendingKey = ''; return; }
    if (d.key === lastKey) return;
    if (document.visibilityState !== 'visible') { pendingKey = d.key; pendingText = d.text; return; } // háttérben: a visszatéréskor jelzünk
    lastKey = d.key; pendingKey = '';
    alertNow(d.text);
  }
  document.addEventListener('kb:state', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !pendingKey) return;
    const d = duty();
    if (d && d.key === pendingKey && d.key !== lastKey) { lastKey = d.key; alertNow(pendingText); }
    pendingKey = '';
  });
  window.kbTurnAlert = { current: () => duty(), check };
})();
