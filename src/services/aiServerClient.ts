import axios from 'axios';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

export class AIServerClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = config.aiServerUrl;
    }

    async classifyUrgency(
        transcript: string,
        callerId: string,
        targetUserId: string
    ): Promise<{ urgency: 'HIGH' | 'LOW'; confidence: number; reasoning: string }> {
        try {
            const response = await axios.post(`${this.baseUrl}/api/classify-urgency`, {
                transcript,
                caller_id: callerId,
                target_user_id: targetUserId
            });

            logger.info({ urgency: response.data.urgency }, 'Urgency classified');
            return response.data;
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error classifying urgency');
            // Default to HIGH for safety
            return {
                urgency: 'HIGH',
                confidence: 0.5,
                reasoning: 'Error during classification'
            };
        }
    }

    async logTranscript(
        callId: string,
        timestamp: number,
        speaker: 'caller' | 'recipient' | 'bot',
        text: string
    ): Promise<boolean> {
        try {
            await axios.post(`${this.baseUrl}/api/log-transcript`, {
                call_id: callId,
                timestamp,
                speaker,
                text
            });

            logger.debug({ callId }, 'Transcript logged');
            return true;
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error logging transcript');
            return false;
        }
    }

    async summarizeCall(callId: string): Promise<any> {
        try {
            const response = await axios.post(`${this.baseUrl}/api/summarize-call`, {
                call_id: callId
            });

            logger.info({ callId }, 'Call summarized');
            return response.data;
        } catch (error: any) {
            logger.error({ error: error.message }, 'Error summarizing call');
            return null;
        }
    }
}

export const aiServerClient = new AIServerClient();
