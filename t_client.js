const { io } = require('socket.io-client');
const s = io('http://localhost:3131', { transports: ['websocket'] });
s.on('connect', () => {
  s.emit('create_room', { code: 'TESZT', name: 'TESZT-1', avatar: '🧑‍⚖️', playerId: 'testp1', profile: {} }, (res) => {
    console.log('CREATE', JSON.stringify(res));
    if (res && res.error) return process.exit(1);
    s.emit('start_game', { modes: ['repo'] });
  });
});
s.on('state', (st) => {
  if (st.phase !== 'lobby') {
    console.log('PHASE', st.phase, 'prosec', st.prosecutorId, 'def', st.defendantId, 'defender', st.defenderId, 'judge', st.currentJudgeId);
    setTimeout(() => { s.close(); process.exit(0); }, 4000);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 10000);
