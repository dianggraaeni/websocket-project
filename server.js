const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');

// Baca sertifikat SSL
const server = https.createServer({
  cert: fs.readFileSync('./cert/cert.pem'),
  key: fs.readFileSync('./cert/key.pem')
});

// Buat WebSocket server
const wss = new WebSocket.Server({ server });

const clients = new Map(); // Map untuk menyimpan client dan token mereka
const MAX_CONNECTIONS = 5; // Limit connection

// Konstanta
const HEARTBEAT_INTERVAL = 30000; // 30 detik
const VALID_TOKEN = "rahasia"; // Token yang valid untuk autentikasi

// Fungsi broadcast (mengirim pesan ke semua client kecuali pengirim)
function broadcast(message) {
  for (const [client] of clients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

// Heartbeat handling function
function startHeartbeat(ws) {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
}

// Interval heartbeat
const heartbeatInterval = setInterval(() => {
  for (const [client] of clients.entries()) {
    if (!client.isAlive) {
      clients.delete(client);
      return client.terminate();
    }
    
    client.isAlive = false;
    client.ping();
    
    // Send heartbeat message to client
    const time = new Date().toLocaleTimeString();
    client.send(JSON.stringify({ 
      type: 'heartbeat', 
      time: time 
    }));
  }
}, HEARTBEAT_INTERVAL);

// Handle koneksi WebSocket
wss.on('connection', (ws, req) => {
  // Check connection limit - FIXED: Menggunakan >= untuk membatasi tepat 5 koneksi
  if (clients.size >= MAX_CONNECTIONS) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      message: 'Server connection limit reached. Try again later.' 
    }));
    return ws.close(1013, 'Maximum connections reached');
  }

  startHeartbeat(ws);
  
  ws.isAuthenticated = false;
  
  ws.send(JSON.stringify({ type: 'info', message: 'Please authenticate to continue' }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle ping message for latency measurement
      if (data.type === 'ping') {
        // Reply with timestamp from client for latency calculation
        ws.send(JSON.stringify({ 
          type: 'pong', 
          timestamp: data.timestamp 
        }));
        return;
      }
      
      // AUTENTIKASI
      if (!ws.isAuthenticated) {
        if (data.type === 'auth' && typeof data.token === 'string') {
          if (data.token === VALID_TOKEN) {
            ws.isAuthenticated = true;
            clients.set(ws, data.token);
            ws.send(JSON.stringify({ 
              type: 'info', 
              message: 'Authentication successful' 
            }));
            console.log(`Client authenticated with valid token. Total clients: ${clients.size}/${MAX_CONNECTIONS}`);
            
            // Send initial server message (inisiasi message dari server)
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                  type: 'server-message', 
                  message: 'Welcome to the secure WebSocket server!' 
                }));
              }
            }, 1000);
          } else {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Authentication failed: invalid token' 
            }));
            ws.close(1008, 'Authentication failed');
          }
        } else {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Authentication required' 
          }));
          ws.close(1008, 'Authentication required');
        }
        return;
      }
      
      // JIKA SUDAH AUTENTIKASI
      switch (data.type) {
        case 'chat':
          if (typeof data.message === 'string' && data.message.trim() !== '') {
            broadcast({ 
              type: 'chat', 
              from: 'user', 
              message: data.message.trim() 
            });
          } else {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Empty message not allowed' 
            }));
          }
          break;
        
        default:
          ws.send(JSON.stringify({ 
            type: 'info', 
            message: 'Message received' 
          }));
      }
    } catch (err) {
      console.error('Invalid message received:', err);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Invalid message format (must be JSON)' 
      }));
    }
  });
  
  // Timeout autentikasi
  setTimeout(() => {
    if (!ws.isAuthenticated && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Authentication timeout' 
      }));
      ws.terminate();
    }
  }, 30000);
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected. Total clients: ${clients.size}/${MAX_CONNECTIONS}`);
  });
});

// Clean up on server shutdown
process.on('SIGINT', () => {
  clearInterval(heartbeatInterval);
  for (const [client] of clients.entries()) {
    client.close(1001, 'Server shutting down');
  }
  process.exit(0);
});

// Jalankan server HTTPS
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Secure WebSocket server (wss) running at https://localhost:${PORT}`);
  console.log(`Max connections allowed: ${MAX_CONNECTIONS}`);
});