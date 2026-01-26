import WebSocket from 'ws';
import { Socket } from 'socket.io';
import ConversationService from './ConversationService';

interface CallData {
    from: string;
    to: string;
    callId: string;
    callerName: string;
}

class AgentProxyService {
    private activeProxies = new Map<string, WebSocket>();
    private baseAgentUrl: string | null = null;

    setAgentServerUrl(url: string) {
        // Store base URL without query params
        this.baseAgentUrl = url;
        console.log('[AgentProxy] Base agent server URL set:', url);
    }

    async createProxy(clientSocket: Socket, callData: CallData) {
        if (!this.baseAgentUrl) {
            console.error('[AgentProxy] Agent server URL not configured');
            return;
        }

        // Build dynamic agent URL: empid = recipient (being called), calleremp = caller
        const agentUrl = `${this.baseAgentUrl}?empid=${callData.to}&calleremp=${callData.from}`;

        console.log(`[AgentProxy] Creating proxy to agent for call ${callData.callId}`);
        console.log(`[AgentProxy] Recipient: ${callData.to}, Caller: ${callData.from}`);
        console.log(`[AgentProxy] Agent URL: ${agentUrl}`);
        console.log(`[AgentProxy] EXACT RESOLVED URL: ${agentUrl}`);


        const agentWs = new WebSocket(agentUrl);
        this.activeProxies.set(callData.callId, agentWs);

        agentWs.on('open', () => {
            console.log(`[AgentProxy] Connected to agent for call ${callData.callId}`);
        });

        agentWs.on('error', (error) => {
            console.error(`[AgentProxy] WebSocket error for call ${callData.callId}:`, error);
            clientSocket.emit('agent-error', {
                callId: callData.callId,
                message: 'Failed to connect to agent'
            });
        });

        // Mobile → Agent: Relay audio
        clientSocket.on('agent-audio', (data: { callId: string; audioData: string }) => {
            if (data.callId !== callData.callId) return;

            if (agentWs.readyState === WebSocket.OPEN) {
                agentWs.send(JSON.stringify({
                    type: 'audio',
                    data: data.audioData,
                }));
            }
        });

        // Mobile → Agent: Relay text
        clientSocket.on('agent-text', async (data: { callId: string; message: string }) => {
            if (data.callId !== callData.callId) return;

            if (agentWs.readyState === WebSocket.OPEN) {
                console.log(`[AgentProxy] Relaying text to agent: ${data.message}`);

                // Log user message to agent in database
                try {
                    await ConversationService.logMessage(callData.from, 'agent', data.message);
                    console.log(`[AgentProxy] User message logged to database`);
                } catch (error) {
                    console.error('[AgentProxy] Failed to log user message:', error);
                }

                agentWs.send(JSON.stringify({
                    type: 'text',
                    data: data.message,
                }));
            }
        });

        // Agent → Mobile: Relay responses
        agentWs.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'audio') {
                    clientSocket.emit('agent-audio-response', {
                        callId: callData.callId,
                        audioData: msg.data,
                    });
                } else if (msg.type === 'text') {
                    console.log(`[AgentProxy] Relaying agent text to mobile: ${msg.data}`);

                    // Log agent message to database
                    try {
                        await ConversationService.logMessage('agent', callData.from, msg.data);
                        console.log(`[AgentProxy] Agent message logged to database`);
                    } catch (error) {
                        console.error('[AgentProxy] Failed to log agent message:', error);
                    }

                    clientSocket.emit('agent-text-response', {
                        callId: callData.callId,
                        message: msg.data,
                    });
                }
            } catch (e) {
                console.error('[AgentProxy] Parse error:', e);
            }
        });

        // Cleanup
        const cleanup = () => {
            console.log(`[AgentProxy] Cleaning up proxy for call ${callData.callId}`);
            this.activeProxies.delete(callData.callId);
            if (agentWs.readyState === WebSocket.OPEN) {
                agentWs.close();
            }
        };

        clientSocket.on('disconnect', cleanup);
        clientSocket.on('end-call', cleanup);

        agentWs.on('close', () => {
            console.log(`[AgentProxy] Agent WebSocket closed for call ${callData.callId}`);
            clientSocket.emit('agent-disconnected', { callId: callData.callId });
            cleanup();
        });
    }

    closeProxy(callId: string) {
        const agentWs = this.activeProxies.get(callId);
        if (agentWs) {
            console.log(`[AgentProxy] Manually closing proxy for call ${callId}`);
            agentWs.close();
            this.activeProxies.delete(callId);
        }
    }

    isProxyActive(callId: string): boolean {
        return this.activeProxies.has(callId);
    }
}

export default new AgentProxyService();
