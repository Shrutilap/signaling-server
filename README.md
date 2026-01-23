# Call Gateway - WebRTC Signaling Server

A production-ready Node.js/TypeScript signaling server for WebRTC voice calls with AI agent integration. Built with Fastify, Socket.IO, and Firebase integration for push notifications.

## 🎯 Overview

The Call Gateway serves as the central hub for managing real-time voice communication between users and AI voice agents. It handles WebRTC signaling, call management, and seamless bidirectional audio/text relay to AI agent servers.

## ✨ Key Features

### Core Functionality
- **WebRTC Signaling**: Full Socket.IO-based signaling server for peer-to-peer connection establishment
- **Agent Proxy Service**: Bidirectional audio/text relay between mobile clients and AI agent servers
- **Push Notifications**: Firebase Cloud Messaging integration for incoming call alerts
- **Permission Management**: Role-based access control for caller-recipient relationships
- **Call Escalation**: HTTP API to transfer ongoing agent calls to human recipients

### Advanced Features
- **Call Session Management**: In-memory call tracking and session state management
- **Client Manager**: Centralized user connection and presence tracking
- **Multi-platform Support**: Works with mobile apps and web clients

## 🏗️ Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Mobile    │◄───────►│ Call Gateway │◄───────►│   Agent     │
│   Client    │  Socket │  (Signaling) │ WebSocket│   Server    │
└─────────────┘   .IO   └──────────────┘         └─────────────┘
                            │
                            │
                            ▼
                      ┌──────────┐
                      │ Firebase │
                      │   FCM    │
                      └──────────┘
```

## 📦 Installation

### Prerequisites
- **Node.js**: v18 or higher
- **npm**: v9 or higher
- **Firebase Project**: For push notifications (with service account JSON)
- **Agent Server** (optional): For AI agent voice interaction

### Install Dependencies

```bash
npm install
```

## ⚙️ Configuration

Create a `.env` file in the root directory:

```bash
# Server Configuration
PORT=3000
LOG_LEVEL=info

# External Services
AGENT_SERVER_URL=ws://localhost:8001

# Firebase (for push notifications)
# Place your firebase-service-account.json in the root directory
```

### Firebase Setup

1. Download your Firebase service account JSON from the Firebase Console
2. Save it as `firebase-service-account.json` in the project root
3. Ensure it's listed in `.gitignore` (already configured)

## 🚀 Running the Server

### Development Mode
```bash
npm run dev
```
Runs with hot-reload using `ts-node-dev`

### Production Mode
```bash
# Build TypeScript to JavaScript
npm run build

# Start production server
npm start
```

The server will start on the configured port (default: 3000).

## 📡 API Reference

### WebSocket Events (Socket.IO)

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `register` | `{ userId, fcmToken, name }` | Register user and FCM token for push notifications |
| `call-initiate` | `{ from, to, callerName }` | Initiate a new call to another user |
| `ice-candidate` | `{ candidate, callId }` | Exchange ICE candidates for WebRTC |
| `sdp-offer` | `{ sdp, callId }` | Send SDP offer for WebRTC negotiation |
| `sdp-answer` | `{ sdp, callId }` | Send SDP answer to complete handshake |
| `call-accept` | `{ callId }` | Accept an incoming call |
| `call-reject` | `{ callId, userId }` | Reject an incoming call |
| `end-call` | `{ callId }` | Terminate an active call |
| `audio-chunk` | `{ callId, audioData }` | Stream audio for transcription |
| `agent-audio` | `{ callId, audioData }` | Send audio to AI agent |
| `agent-text` | `{ callId, message }` | Send text message to AI agent |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `registered` | `{ userId }` | Successful registration confirmation |
| `incoming-call` | `{ callId, callerId, callerName }` | Incoming call notification |
| `call-accepted` | `{ callId, recipientId }` | Call was accepted by recipient |
| `call-rejected` | `{ callId, reason }` | Call was rejected |
| `call-ended` | `{ callId, reason }` | Call has ended |
| `ice-candidate` | `{ candidate, callId }` | ICE candidate from peer |
| `sdp-offer` | `{ sdp, callId }` | SDP offer from caller |
| `sdp-answer` | `{ sdp, callId }` | SDP answer from callee |
| `connected-to-agent` | `{ callId, agentName }` | Connected to AI agent |
| `agent-audio-response` | `{ callId, audioData }` | Audio response from agent |
| `agent-text-response` | `{ callId, message }` | Text response from agent |
| `agent-transfer-to-human` | `{ callId, recipientId, recipientName }` | Agent escalating to human |
| `error` | `{ message, code }` | Error notification |

### HTTP Endpoints

#### `POST /escalate-to-human`
Escalate an ongoing bot call to a human agent.

**Request Body:**
```json
{
  "callId": "uuid-v4",
  "recipientId": "user123",
  "recipientName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call escalated successfully"
}
```



## 🎮 Usage Example

### Client Connection Flow

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

// 1. Register user
socket.emit('register', {
  userId: 'user123',
  fcmToken: 'firebase-token',
  name: 'Alice'
});

// 2. Initiate call
socket.emit('call-initiate', {
  from: 'user123',
  to: 'user456',
  callerName: 'Alice'
});

// 3. Handle WebRTC signaling
socket.on('sdp-offer', ({ sdp, callId }) => {
  // Create answer and send back
  const answer = await createAnswer(sdp);
  socket.emit('sdp-answer', { sdp: answer, callId });
});

// 4. Listen for agent connection
socket.on('connected-to-agent', ({ callId, agentName }) => {
  console.log(`Connected to ${agentName}`);
});
```

## 📂 Project Structure

```
call-gateway/
├── src/
│   ├── server.ts                    # Main Fastify server & HTTP endpoints
│   ├── config/
│   │   └── index.ts                 # Environment configuration
│   ├── models/
│   │   └── types.ts                 # TypeScript interfaces (CallSession, etc.)
│   ├── websocket/
│   │   ├── signalingServer.ts       # Socket.IO event handlers & signaling logic
│   │   └── clientManager.ts         # User connection & call session management
│   ├── services/
│   │   ├── firebaseService.ts       # FCM push notification service
│   │   ├── AgentProxyService.ts     # WebSocket proxy to AI agent server
│   │   └── PermissionService.ts     # Permission checking for calls
├── public/
│   └── index.html                   # Test web client
├── dist/                            # Compiled JavaScript (gitignored)
├── firebase-service-account.json    # Firebase credentials (gitignored)
├── .env                             # Environment variables (gitignored)
├── package.json
├── tsconfig.json
└── Dockerfile                       # Docker containerization
```

## 🔒 Security Notes

### Sensitive Files (Already in .gitignore)
- `.env` - Contains all API keys and credentials
- `firebase-service-account.json` - Firebase admin SDK credentials
- `node_modules/` - Dependencies
- `dist/` - Build artifacts

⚠️ **Never commit these files to version control!**

## 🐳 Docker Support

Build and run with Docker:

```bash
# Build image
docker build -t call-gateway .

# Run container
docker run -p 3000:3000 \
  -e AI_SERVER_URL=http://ai-server:8000 \
  -e MONGODB_URL=mongodb://mongo:27017/call_gateway \
  call-gateway
```

## 🔧 Development

### Type System
Full TypeScript support with strict type checking. Key interfaces:

- `CallSession` - Active call tracking
- `CallClient` - User connection metadata

### Logging
Uses Pino for structured logging with pretty-printing in development:

```typescript
import pino from 'pino';
const logger = pino({ level: config.logLevel });

logger.info({ callId, userId }, 'Call initiated');
logger.error({ error: err.message }, 'Connection failed');
```

## 🧪 Testing

Test the signaling server using the included web client:

1. Start the server: `npm run dev`
2. Open `http://localhost:3000` in your browser
3. Test WebRTC connections between multiple browser tabs

## 🗺️ Roadmap

- [ ] Call recording functionality
- [ ] Rate limiting and DDoS protection
- [ ] WebRTC TURN server integration
- [ ] Group call support
- [ ] Call analytics

## 📄 License

MIT

## 🤝 Contributing

This is a private project. For issues or feature requests, please contact the development team.

---

**Built with ❤️ using Fastify, Socket.IO, and WebRTC**
