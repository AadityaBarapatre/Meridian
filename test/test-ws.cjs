const WebSocket = require('ws');

async function testWS() {
  console.log('Testing WebSocket connection at ws://localhost:5173/ws ...');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:5173/ws');
    let msgCount = 0;
    const types = new Set();

    ws.on('open', () => {
      console.log('WS connection opened successfully!');
    });

    ws.on('message', data => {
      msgCount++;
      const msg = JSON.parse(data.toString());
      types.add(msg.type);
      if (msgCount >= 5) {
        console.log(`Received ${msgCount} messages. Types observed:`, Array.from(types));
        ws.close();
        resolve(true);
      }
    });

    ws.on('error', err => {
      console.error('WS error:', err);
      reject(err);
    });

    setTimeout(() => {
      if (msgCount < 5) {
        reject(new Error(`Timed out waiting for messages (received ${msgCount})`));
      }
    }, 5000);
  });
}

testWS()
  .then(() => {
    console.log('[PASS] WebSocket proxy and live updates verified.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
