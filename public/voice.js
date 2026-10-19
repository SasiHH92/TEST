'use strict';
// ============================================================
// JÁTÉKBELI HANG (BÉTA) – WebRTC, a játékosok között közvetlenül (mesh). A szerver csak a kapcsolatfelvételt (SDP) közvetíti ('voice_signal'),
// a hangot nem látja és nem tárolja. Kapcsolat: STUN (nyilvános Google STUN); közvetítő (TURN) nincs – ahol a hálózat nem engedi a közvetlen
// kapcsolatot (egyes mobilnetek / routerek), ott a hang nem jön létre (a játék ettől még megy, a Discord ugyanúgy használható).
//   - a szerver engedi (KB_VOICE), a házigazda kapcsolja be a lobbiban ("🎙️ Hang bekapcsolása"), legfeljebb S.voice.max fő
//   - a beszédek alatt csak a beszélő és a bíró hallatszik (a többiek mikrofonja automatikusan némul); tiltakozásnál a tiltakozó, a beszélő és a bíró;
//     keresztkérdésnél a kérdezők, a megszólítottak és a bíró; minden más fázisban mindenki beszélhet. A kézi némítás mindig erősebb.
//   - "nem csepegtetett" ICE: az ajánlat / válasz a jelöltekkel együtt megy egyben (kevés üzenet – a szerver eseménykorlátja alatt)
// window.kbVoice.state() a teszteknek: { available, on, joined, muted, autoMuted, peers: { id: kapcsolat-állapot } }.
// ============================================================
(function () {
  if (window.KB_WATCH || typeof socket === 'undefined') return;
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  const SPEAKER = { prosecution: 'prosecutorId', defense: 'defendantId', defender: 'defenderId', witness: 'witnessId', final_prosecution: 'prosecutorId', final_defense: 'defendantId' };
  const peers = new Map(); // playerId -> { pc, audio }
  let local = null, joined = false, joining = false, manualMute = false, autoMuted = false;
  const box = document.createElement('div'); box.id = 'voiceAudio'; box.hidden = true; document.body.appendChild(box);
  const $id = (id) => document.getElementById(id);
  const toast = (t) => { try { if (typeof showToast === 'function') showToast(t); } catch (_) { /* */ } };

  // ki beszélhet most (a szerver állapotából): a többiek mikrofonja automatikusan némul
  function mayTalk() {
    if (typeof S === 'undefined' || !S || !MY.playerId) return true;
    const me = MY.playerId, judge = S.currentJudgeId === me;
    if (SPEAKER[S.phase]) return S[SPEAKER[S.phase]] === me || judge;
    if (S.phase === 'objection' && S.objectionData) { const od = S.objectionData; return od.objectorId === me || od.speakerId === me || judge; }
    if (S.phase === 'jury_question' && S.juryQuestion) return (S.juryQuestion.picks || []).some((p) => p.targetId === me || p.askerId === me) || judge;
    return true;
  }
  function applyMute() {
    autoMuted = joined && !mayTalk();
    if (local) for (const t of local.getAudioTracks()) t.enabled = !manualMute && !autoMuted;
    render();
  }

  // ---------- kapcsolatok ----------
  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 3000); // legfeljebb 3 mp-et várunk a jelöltekre
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
  });
  function send(to, type, sdp) { socket.emit('voice_signal', { to, data: { type, sdp: sdp || '' } }); }
  function makePeer(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.dataset.peer = id; box.appendChild(audio);
    if (local) for (const t of local.getTracks()) pc.addTrack(t, local);
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast('🎙️ A hangkapcsolat nem jött létre ' + (typeof nameOf === 'function' ? nameOf(id) : '') + ' felé (hálózat).'); render(); };
    const entry = { pc, audio };
    peers.set(id, entry);
    return entry;
  }
  function dropPeer(id) {
    const e = peers.get(id); if (!e) return;
    peers.delete(id);
    try { e.pc.close(); } catch (_) { /* */ }
    try { e.audio.srcObject = null; e.audio.remove(); } catch (_) { /* */ }
  }
  async function callPeer(id) { // a kisebb azonosítójú fél kezdeményez (nincs ütközés)
    const { pc } = makePeer(id);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await gathered(pc);
    send(id, 'offer', pc.localDescription.sdp);
  }
  socket.on('voice_signal', async ({ from, data } = {}) => {
    if (!joined || !from || !data) return;
    try {
      if (data.type === 'offer') {
        const { pc } = makePeer(from);
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await gathered(pc);
        send(from, 'answer', pc.localDescription.sdp);
      } else if (data.type === 'answer') {
        const e = peers.get(from);
        if (e && e.pc.signalingState === 'have-local-offer') await e.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else if (data.type === 'bye') dropPeer(from);
    } catch (err) { console.warn('[hang]', err && err.message); }
  });
  function syncPeers() {
    const v = (typeof S !== 'undefined' && S && S.voice) || null;
    const list = v && v.on ? v.peers || [] : [];
    if (joined && v && (!v.on || !list.includes(MY.playerId))) { if (!joining) leave(true); return; } // a hangot kikapcsolták / a szerver kivett
    for (const id of [...peers.keys()]) if (!list.includes(id)) dropPeer(id);
    if (!joined) return;
    for (const id of list) if (id !== MY.playerId && !peers.has(id) && MY.playerId < id) callPeer(id).catch((e) => console.warn('[hang]', e && e.message));
  }

  // ---------- belépés / kilépés ----------
  async function join() {
    if (joined || joining) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') { toast('🎙️ Ez a böngésző nem támogatja a hangot.'); return; }
    joining = true; render();
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) { joining = false; render(); toast('🎙️ A mikrofon nem érhető el (engedélyezd a böngészőben).'); return; }
    socket.emit('voice_join', {}, (res) => {
      joining = false;
      if (!res || res.error) { stopLocal(); render(); toast('🎙️ ' + ((res && res.error) || 'A hang most nem érhető el.')); return; }
      joined = true; manualMute = false;
      applyMute(); syncPeers();
      toast('🎙️ Bent vagy a hangban. A beszédek alatt csak a beszélő és a bíró hallatszik.');
    });
  }
  function stopLocal() { if (local) { for (const t of local.getTracks()) t.stop(); local = null; } }
  function leave(silent) {
    for (const id of [...peers.keys()]) { send(id, 'bye'); dropPeer(id); }
    if (joined && !silent) socket.emit('voice_leave', {});
    joined = false; joining = false; manualMute = false; autoMuted = false;
    stopLocal(); render();
  }
  function toggleMute() { if (!joined) return join(); manualMute = !manualMute; applyMute(); }

  // ---------- gombok ----------
  function render() {
    const v = (typeof S !== 'undefined' && S && S.voice) || null, host = typeof S !== 'undefined' && S && S.hostId === MY.playerId;
    const roomBtn = $id('btnVoiceRoom'), lobbyBtn = $id('btnVoiceLobby'), leaveBtn = $id('btnVoiceLeave'), gameBtn = $id('btnVoice');
    if (roomBtn) { roomBtn.classList.toggle('hidden', !v || !host); const t = v && v.on ? 'Hang kikapcsolása' : 'Hang bekapcsolása (béta)'; roomBtn.innerHTML = '🎙️ <span>' + t + '</span>'; roomBtn.title = t; }
    const on = !!(v && v.on);
    const label = joining ? '🎙️ Kapcsolódás…' : !joined ? '🎙️ Belépés a hangba' : manualMute ? '🔇 Némítva' : autoMuted ? '🤫 Most a beszélő beszél' : '🎙️ Bent vagy';
    if (lobbyBtn) { lobbyBtn.classList.toggle('hidden', !on); lobbyBtn.textContent = label + (on && v.peers ? ' (' + v.peers.length + '/' + v.max + ')' : ''); lobbyBtn.setAttribute('aria-pressed', joined && !manualMute ? 'true' : 'false'); }
    if (leaveBtn) leaveBtn.classList.toggle('hidden', !joined);
    if (gameBtn) {
      gameBtn.classList.toggle('hidden', !on);
      gameBtn.textContent = !joined ? '🎙️' : manualMute ? '🔇' : autoMuted ? '🤫' : '🎙️';
      gameBtn.classList.toggle('green', joined && !manualMute && !autoMuted);
      gameBtn.title = label + (joined ? ' – koppints a némításhoz' : '');
      gameBtn.setAttribute('aria-label', label); gameBtn.setAttribute('aria-pressed', joined && !manualMute ? 'true' : 'false');
    }
  }
  const bind = (id, fn) => { const el = $id(id); if (el) el.addEventListener('click', fn); };
  bind('btnVoiceRoom', () => { const v = S && S.voice; socket.emit('voice_room', { on: !(v && v.on) }, (r) => { if (r && r.error) toast('🎙️ ' + r.error); }); });
  bind('btnVoiceLobby', toggleMute);
  bind('btnVoice', toggleMute);
  bind('btnVoiceLeave', () => leave(false));

  // kapcsolat-kiesés: a szerver kivett a hangból; a szobába visszatérve (az első új állapot után) újra belépünk, a némítás megmarad
  let rejoin = null;
  socket.on('disconnect', () => { if (joined) { rejoin = { muted: manualMute }; leave(true); } });
  document.addEventListener('kb:state', () => {
    if (rejoin && S && S.voice && S.voice.on && !joined && !joining) { const r = rejoin; rejoin = null; join().then(() => { if (joined) { manualMute = r.muted; applyMute(); } }); return; }
    syncPeers(); applyMute();
  });
  document.addEventListener('kb:screen', (e) => { if (e.detail !== 'lobby' && e.detail !== 'game') { rejoin = null; if (joined) leave(false); } }); // kilépett a szobából
  window.kbVoice = {
    state: () => { const st = {}; for (const [id, e] of peers) st[id] = e.pc.connectionState; return { available: !!(S && S.voice), on: !!(S && S.voice && S.voice.on), joined, muted: manualMute, autoMuted, trackEnabled: !!(local && local.getAudioTracks()[0] && local.getAudioTracks()[0].enabled), peers: st }; },
    // beérkezett hangcsomagok kapcsolatonként (getStats inbound-rtp) – a teszteknek és a hibakereséshez
    stats: async () => { const out = {}; for (const [id, e] of peers) { let n = 0; try { (await e.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.packetsReceived || 0; }); } catch (_) { /* */ } out[id] = n; } return out; },
    join, leave: () => leave(false), toggleMute, mayTalk
  };
})();
