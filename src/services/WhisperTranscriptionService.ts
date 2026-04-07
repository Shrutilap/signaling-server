import pino from 'pino';
import { config } from '../config';
import GoogleSTTService from './GoogleSTTService';

const logger = pino({ level: config.logLevel });

interface AudioStreamSession {
    userId: string;
    otherUserId: string;
    stream: any | null; // The GoogleSTTStream object (null if errored or not yet created)
    lastActivity: number;
    transcripts: { empid: string; message: string; timestamp: number }[];
}

/**
 * STTService (formerly WhisperTranscriptionService)
 * 
 * Channels audio chunks directly to Google Cloud STT streaming for real-time, 
 * VAD-based transcription.
 */
class STTService {
    private sessions: Map<string, AudioStreamSession> = new Map();

    constructor() {
        logger.info('[STTService] Initialized — Using Real-time Streaming (VAD) backend');
    }

    /**
     * Add an audio chunk to the active stream for a specific call/user
     */
    addAudioChunk(callId: string, userId: string, otherUserId: string, audioDataBase64: string): void {
        const sessionKey = `${callId}_${userId}`;

        if (!this.sessions.has(sessionKey)) {
            logger.info({ callId, userId, sessionKey }, '[STTService] Creating NEW session');
            this.sessions.set(sessionKey, {
                userId,
                otherUserId,
                stream: null, // Will be initialized below
                lastActivity: Date.now(),
                transcripts: []
            });
        }

        const session = this.sessions.get(sessionKey)!;
        session.lastActivity = Date.now();

        // If stream doesn't exist or was closed/errored, create a new one for THIS session
        if (!session.stream) {
            logger.info({ sessionKey }, '[STTService] Initializing new Google STT stream for existing session');
            session.stream = GoogleSTTService.createStream(
                (transcript, isFinal) => {
                    if (isFinal) {
                        logger.info({ sessionKey, text: transcript }, '[STTService] Utterance finalized');
                        session.transcripts.push({
                            empid: userId,
                            message: transcript.trim(),
                            timestamp: Date.now()
                        });
                    }
                },
                (error) => {
                    logger.error({ sessionKey, error: error.message }, '[STTService] Stream error — will recreate on next chunk');
                    this.terminateSessionStream(sessionKey); // Only terminate the stream, not the session
                },
                userId,
                otherUserId
            );
        }

        // Debug: Log info about incoming chunk every ~50 chunks to avoid flooding
        if (Math.random() < 0.02) {
            const dataType = typeof audioDataBase64;
            const dataLength = dataType === 'string' ? audioDataBase64.length : (audioDataBase64 as any).length;
            logger.info({ sessionKey, dataType, dataLength }, '[STTService] Incoming audio chunk info');
        }

        // Pipe audio data directly to the stream
        try {
            session.stream.writeBlock(audioDataBase64);
        } catch (e: any) {
            logger.error({ error: e.message, sessionKey }, '[STTService] Failed to write audio to stream');
        }
    }

    /**
     * Terminate ONLY the stream for a specific session (keep transcripts)
     */
    private terminateSessionStream(sessionKey: string): void {
        const session = this.sessions.get(sessionKey);
        if (session && session.stream) {
            try {
                session.stream.close();
            } catch (e) {
                // Ignore close errors
            }
            session.stream = null; // Mark stream as dead
            logger.info({ sessionKey }, '[STTService] Stream closed (session preserved)');
        }
    }

    /**
     * Stop buffering for a call — close all active streams and return full transcript history
     */
    async stopCall(callId: string): Promise<{ empid: string; message: string }[]> {
        logger.info({ callId }, '[STTService] stopCall called — searching for active sessions');
        const keysToRemove: string[] = [];

        // Terminate streams but keep session in memory for final chunks
        for (const [key, session] of this.sessions) {
            if (key.startsWith(callId)) {
                keysToRemove.push(key);
                try {
                    logger.info({ sessionKey: key }, '[STTService] Closing stream for callId');
                    if (session.stream) {
                        session.stream.close();
                        session.stream = null;
                    }
                } catch (e) {
                    // Ignore close errors
                }
            }
        }

        if (keysToRemove.length === 0) {
            logger.warn({ callId }, '[STTService] No active sessions found for this callId');
        }

        // Give Google STT a moment to flush final results to the callback
        logger.info({ callId, sessionCount: keysToRemove.length }, '[STTService] Waiting for stream flush (2.5s)');
        await new Promise(resolve => setTimeout(resolve, 2500));

        let allTranscripts: { empid: string; message: string; timestamp: number }[] = [];

        // Collect and remove sessions
        for (const key of keysToRemove) {
            const session = this.sessions.get(key);
            if (session) {
                logger.info({ sessionKey: key, count: session.transcripts ? session.transcripts.length : 0 }, '[STTService] Collecting final transcripts from session');
                allTranscripts = allTranscripts.concat(session.transcripts);
                this.sessions.delete(key);
                logger.info({ sessionKey: key }, '[STTService] Session cleaned up');
            }
        }

        // Sort combined transcripts chronologically
        allTranscripts.sort((a, b) => a.timestamp - b.timestamp);
        logger.info({ callId, totalTranscripts: allTranscripts.length }, '[STTService] stopCall returning combined transcripts');

        return allTranscripts.map(({ empid, message }) => ({ empid, message }));
    }
}

export default new STTService();