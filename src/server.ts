import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { setupSocketIOServer } from './websocket/signalingServer';
import { config } from './config';
import pino from 'pino';
import FastifyMultipart from '@fastify/multipart';
// import { transcribeAudio } from './services/whisperClient';
import PermissionService from './services/PermissionService';
import AgentProxyService from './services/AgentProxyService';
import WebSocket from 'ws';


const logger = pino({
    level: config.logLevel,
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

// Start server
const start = async () => {
    const fastify = Fastify({
        logger: logger as any
    });

    try {
        // Initialize Permission Service with MongoDB
        console.log('[Server] Initializing PermissionService...');
        await PermissionService.init(config.mongodbUrl, 'talker');
        console.log('[Server] PermissionService initialized');

        // Initialize Agent Proxy Service with agent server URL
        AgentProxyService.setAgentServerUrl(config.agentServerUrl);
        console.log('[Server] AgentProxyService configured:', config.agentServerUrl);

        // Register plugins  
        await fastify.register(fastifyCors, {
            origin: '*'
        });

        // Register multipart for file uploads
        await fastify.register(FastifyMultipart);

        // Serve static files manually  
        const path = require('path');
        const fs = require('fs');

        fastify.get('/', async (request, reply) => {
            const html = fs.readFileSync(path.join(__dirname, '../public/index.html'));
            reply.type('text/html').send(html);
        });

        fastify.get('/app.js', async (request, reply) => {
            const js = fs.readFileSync(path.join(__dirname, '../public/app.js'));
            reply.type('application/javascript').send(js);
        });

        fastify.get('/styles.css', async (request, reply) => {
            const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'));
            reply.type('text/css').send(css);
        });

        // Test endpoint for permission checking
        fastify.get('/api/test-permission/:empid', async (request, reply) => {
            try {
                const { empid } = request.params as { empid: string };
                const permissions = await PermissionService.getUserPermissions(empid);
                return {
                    success: true,
                    empid,
                    permissions,
                    message: permissions.calls
                        ? 'Calls allowed - would route to P2P'
                        : 'Calls blocked - would route to agent'
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Clear permission cache for specific user
        fastify.post('/api/clear-cache/:empid', async (request, reply) => {
            try {
                const { empid } = request.params as { empid: string };
                PermissionService.clearCache(empid);
                return {
                    success: true,
                    message: `Cache cleared for empid: ${empid}`
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Clear all permission cache
        fastify.post('/api/clear-cache', async (request, reply) => {
            try {
                PermissionService.clearAllCache();
                return {
                    success: true,
                    message: 'All cache cleared'
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Test endpoint for agent server connection
        fastify.get('/api/test-agent-connection', async (request, reply) => {
            const WebSocket = require('ws');
            const agentUrl = config.agentServerUrl;

            if (!agentUrl) {
                return { success: false, message: 'Agent URL not configured' };
            }

            return new Promise((resolve) => {
                console.log(`[Test] Connecting to agent: ${agentUrl}`);
                const ws = new WebSocket(agentUrl);

                const timeout = setTimeout(() => {
                    ws.terminate();
                    resolve({ success: false, message: 'Connection timed out (15s)' });
                }, 15000);

                ws.on('open', () => {
                    console.log('[AudioTest] Connected to agent server');

                    ws.send(JSON.stringify({
                        type: 'start',
                        callId: 'test-call-123',
                        sampleRate: 16000,
                        channels: 1
                    }));

                    setTimeout(() => {
                        const frame = Buffer.alloc(640);
                        const payload = frame.toString('base64');

                        const interval = setInterval(() => {
                            ws.send(JSON.stringify({
                                type: 'audio',
                                encoding: 'pcm16',
                                sampleRate: 16000,
                                channels: 1,
                                audio: payload
                            }));
                        }, 20);

                        setTimeout(() => clearInterval(interval), 1000);
                    }, 200);
                });


                ws.on('error', (err: any) => {
                    clearTimeout(timeout);
                    resolve({ success: false, message: 'Connection failed', error: err.message });
                });
            });
        });

        // Health check
        fastify.get('/api/health', async () => {
            return {
                status: 'online',
                service: 'Call Gateway',
                version: '1.0.0'
            };
        });

        // Get active calls
        fastify.get('/api/calls', async () => {
            const { clientManager } = await import('./websocket/clientManager');
            return {
                activeCalls: clientManager.getAllSessions().length,
                sessions: clientManager.getAllSessions().map(s => ({
                    id: s.id,
                    status: s.status,
                    urgency: s.urgency,
                    routedTo: s.routedTo,
                    duration: s.endedAt ? s.endedAt - s.startedAt : Date.now() - s.startedAt
                }))
            };
        });

        // Get all registered users (for testing)
        fastify.get('/api/users', async () => {
            const { clientManager } = await import('./websocket/clientManager');
            const users = clientManager.getAllUsers();
            return {
                totalUsers: users.length,
                users: users
            };
        });

        //test audio
        fastify.get('/api/test-agent-audio', async () => {
            const agentUrl = 'ws://10.188.163.10:8080/nirmal/?projectid=9900';

            return new Promise((resolve) => {
                const ws = new WebSocket(agentUrl);

                const timeout = setTimeout(() => {
                    ws.terminate();
                    resolve({
                        success: false,
                        message: 'No response from agent'
                    });
                }, 5000);

                ws.on('open', () => {
                    console.log('[TEST] Connected');

                    // ✅ EXACT SAME AS REACT APP
                    ws.send(JSON.stringify({
                        type: 'text',
                        data: 'Hello agent from call-gateway'
                    }));
                });

                ws.on('message', (data: WebSocket.RawData) => {
                    clearTimeout(timeout);

                    resolve({
                        success: true,
                        response: data.toString()
                    });

                    ws.close();
                });

                ws.on('error', (err: Error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: err.message });
                });
            });
        });





        // Agent escalation endpoint - Agent server calls this to ring User B
        fastify.post('/api/escalate-call', async (request, reply) => {
            const { callId, recipientId, callerId, callerName } = request.body as {
                callId: string;
                recipientId: string;
                callerId: string;
                callerName: string;
            };

            logger.info({ callId, recipientId, callerId }, 'Agent server escalating call to user');

            // Import clientManager to get caller socket
            const { clientManager } = await import('./websocket/clientManager');

            // Step 1: Ring User B (recipientId)
            const { ringUser } = await import('./websocket/signalingServer');
            const ringResult = await ringUser(recipientId, callerId, callId, callerName);

            if (!ringResult.success) {
                reply.code(400);
                return {
                    success: false,
                    error: ringResult.reason
                };
            }

            // Step 2: Tell User A (callerId) to initiate WebRTC connection to User B
            const caller = clientManager.getUserFromDirectory(callerId);
            logger.info({ callerId, callerFound: !!caller, hasSocket: !!caller?.socket }, 'Looking up caller for P2P initiation');

            if (caller && caller.socket) {
                logger.info({ callerId, recipientId, callId }, 'Sending agent-transfer-to-human event to caller');
                caller.socket.emit('agent-transfer-to-human', {
                    callId: callId,
                    recipientId: recipientId,
                    recipientName: clientManager.getUserFromDirectory(recipientId)?.displayName || 'User'
                });
                logger.info({ callerId, recipientId, callId }, 'Notified caller to initiate P2P connection');
            } else {
                logger.warn({ callerId, callerExists: !!caller, hasSocket: !!caller?.socket }, 'Caller not found or offline - cannot initiate P2P');
            }

            return {
                success: true,
                message: 'User B has been notified and P2P connection initiated'
            };
        });

        // Conversation transcript endpoint - receives transcripts from mobile app
        fastify.post('/api/conversation-transcript', async (request, reply) => {
            const { callId, userId, userName, transcript, timestamp, isFinal } = request.body as {
                callId: string;
                userId: string;
                userName: string;
                transcript: string;
                timestamp: number;
                isFinal: boolean;
            };

            logger.info({
                callId,
                userId,
                userName,
                transcriptLength: transcript.length,
                isFinal,
                timestamp
            }, 'Received conversation transcript');

            // Log the actual transcript for debugging
            console.log('='.repeat(60));
            console.log(`[TRANSCRIPT] ${userName} (${userId})`);
            console.log(`[CALL ID] ${callId}`);
            console.log(`[STATUS] ${isFinal ? 'FINAL' : 'PARTIAL'}`);
            console.log(`[TEXT] ${transcript}`);
            console.log('='.repeat(60));

            // TODO: Forward to AI server when endpoint is available
            // await aiServerClient.sendConversationTranscript({
            //     callId, userId, userName, transcript, timestamp, isFinal
            // });

            return {
                success: true,
                message: 'Transcript received'
            };
        });



        // Whisper audio transcription endpoint
        // fastify.post('/api/transcribe-audio', async (request, reply) => {
        //     try {
        //         const data = await request.file();

        //         if (!data) {
        //             reply.code(400);
        //             return { error: 'No audio file provided' };
        //         }

        //         const callId = (data.fields.callId as any)?.value || 'unknown';
        //         const userId = (data.fields.userId as any)?.value || 'unknown';

        //         logger.info({ callId, userId }, 'Received audio for transcription');

        //         // Save uploaded file temporarily
        //         const tempPath = `./temp_${Date.now()}.m4a`;
        //         const fs = require('fs');
        //         const writeStream = fs.createWriteStream(tempPath);
        //         data.file.pipe(writeStream);

        //         await new Promise((resolve, reject) => {
        //             writeStream.on('finish', resolve);
        //             writeStream.on('error', reject);
        //         });

        //         try {
        //             // Transcribe using Whisper
        //             const result = await transcribeAudio(tempPath);

        //             logger.info({
        //                 callId,
        //                 userId,
        //                 transcriptLength: result.text.length,
        //                 language: result.language
        //             }, 'Audio transcribed successfully');

        //             // Log the transcript
        //             console.log('='.repeat(60));
        //             console.log(`[WHISPER TRANSCRIPT] User: ${userId}`);
        //             console.log(`[CALL ID] ${callId}`);
        //             console.log(`[LANGUAGE] ${result.language}`);
        //             console.log(`[TEXT] ${result.text}`);
        //             console.log('='.repeat(60));

        //             // TODO: Forward to AI server
        //             // await aiServerClient.sendConversationTranscript({
        //             //     callId, userId, transcript: result.text, language: result.language
        //             // });

        //             // Clean up temp file
        //             fs.unlinkSync(tempPath);

        //             return {
        //                 success: true,
        //                 text: result.text,
        //                 language: result.language
        //             };
        //         } catch (error: any) {
        //             // Clean up temp file on error
        //             if (fs.existsSync(tempPath)) {
        //                 fs.unlinkSync(tempPath);
        //             }

        //             logger.error({ error: error.message }, 'Whisper transcription failed');
        //             reply.code(500);
        //             return { error: 'Transcription failed', details: error.message };
        //         }
        //     } catch (error: any) {
        //         logger.error({ error: error.message }, 'Failed to process audio upload');
        //         reply.code(500);
        //         return { error: 'Failed to process audio upload' };
        //     }
        // })

        await fastify.listen({ port: config.port, host: '0.0.0.0' });

        // Setup Socket.IO server
        const io = new SocketIOServer(fastify.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            },
            transports: ['websocket', 'polling']
        });

        setupSocketIOServer(io);

        logger.info(`Call Gateway running on port ${config.port}`);
        logger.info(`Socket.IO endpoint: http://localhost:${config.port}`);
        logger.info(`Web client: http://localhost:${config.port}`);
    } catch (err) {
        logger.error(err);
        process.exit(1);
    }
};

start();
