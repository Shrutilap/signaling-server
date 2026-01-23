# Call Gateway - WebRTC Signaling & Routing Server

Node.js-based call gateway that handles WebRTC signaling, urgency detection, and intelligent call routing.

## Features
- WebSocket signaling server for WebRTC connections
- Real-time urgency detection
- Intelligent call routing (human vs bot)
- Call bridging and management
- Transcript logging to AI server

## Setup

### Prerequisites
- Node.js 18+
- Redis
- Running AI Server

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```bash
PORT=3000
AI_SERVER_URL=http://localhost:8000
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
```

### Run Server

```bash
# Development
npm run dev

# Production
npm start
```

## WebSocket Events

### Client → Server
- `call-init ate` - Start a new call
- `sdp-offer` - Send SDP offer
- `ice-candidate` - Send ICE candidate
- `call-end` - End the call

### Server → Client
- `call-ringing` - Call is ringing
- `call-accepted` - Call was accepted
- `sdp-answer` - SDP answer
- `call-ended` - Call has ended
- `urgency-detected` - Urgency level determined

## Project Structure

```
call-gateway/
├── src/
│   ├── server.ts            # Main server
│   ├── websocket/           # WebSocket handlers
│   ├── routing/             # Call routing logic
│   ├── transcription/       # STT handling
│   └── services/            # External services
├── package.json
└── tsconfig.json
```
