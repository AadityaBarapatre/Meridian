const WebSocket = require('ws');

async function testReconnect() {
  console.log('Testing WebSocket auto-reconnect logic (as implemented in App.tsx)...');

  return new Promise((resolve, reject) => {
    let ws;
    let dead = false;
    let initialConnected = false;
    let reconnected = false;
    let messagesAfterReconnect = 0;

    const connect = () => {
      ws = new WebSocket('ws://localhost:4000/ws');

      ws.on('open', () => {
        if (!initialConnected) {
          initialConnected = true;
          console.log('Initial connection established.');
          // Simulate server connection termination
          setTimeout(() => {
            console.log('Simulating server connection drop (terminating socket)...');
            ws.terminate();
          }, 500);
        } else {
          reconnected = true;
          console.log('Auto-reconnected successfully!');
        }
      });

      ws.on('message', data => {
        if (reconnected) {
          messagesAfterReconnect++;
          if (messagesAfterReconnect >= 2) {
            console.log(`Received ${messagesAfterReconnect} messages after reconnect!`);
            dead = true;
            ws.close();
            resolve(true);
          }
        }
      });

      ws.on('close', () => {
        console.log('Socket closed.');
        if (!dead) {
          console.log('Waiting 1000ms before reconnecting (App.tsx behavior)...');
          setTimeout(connect, 1000);
        }
      });

      ws.on('error', err => {
        // Expected during drop/reconnect interval
      });
    };

    connect();

    setTimeout(() => {
      if (!reconnected || messagesAfterReconnect < 2) {
        dead = true;
        reject(new Error('Timed out waiting for reconnect and post-reconnect messages'));
      }
    }, 8000);
  });
}

testReconnect()
  .then(() => {
    console.log('[PASS] WebSocket reconnect logic verified.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
