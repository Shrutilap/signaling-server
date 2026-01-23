import { CallSession } from '../models/types';
import { aiServerClient } from '../services/aiServerClient';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class UrgencyDetector {
    private detectionBuffer: Map<string, string[]> = new Map();
    private readonly DETECTION_TIME_MS = 10000; // 10 seconds
    private readonly MIN_WORDS = 10;

    async startDetection(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Starting urgency detection');

        // Initialize buffer
        this.detectionBuffer.set(callSession.id, []);

        // Set timeout for detection
        setTimeout(() => {
            this.performDetection(callSession.id);
        }, this.DETECTION_TIME_MS);
    }

    addTranscriptChunk(callId: string, text: string): void {
        const buffer = this.detectionBuffer.get(callId);
        if (buffer) {
            buffer.push(text);
            this.detectionBuffer.set(callId, buffer);
        }
    }

    private async performDetection(callId: string): Promise<void> {
        const buffer = this.detectionBuffer.get(callId);

        if (!buffer || buffer.length === 0) {
            logger.warn({ callId }, 'No transcript for urgency detection, defaulting to HIGH');
            // Default to HIGH for safety
            return;
        }

        const transcript = buffer.join(' ');
        const wordCount = transcript.split(' ').length;

        // If not enough words, default to HIGH for safety
        if (wordCount < this.MIN_WORDS) {
            logger.warn({ callId, wordCount }, 'Insufficient transcript, defaulting to HIGH');
            return;
        }

        logger.debug({ callId, transcript: transcript.substring(0, 50) }, 'Detecting urgency');

        // Detection will be triggered by call router
        // This just manages the buffer
    }

    getInitialTranscript(callId: string): string {
        const buffer = this.detectionBuffer.get(callId);
        return buffer ? buffer.join(' ') : '';
    }

    clearBuffer(callId: string): void {
        this.detectionBuffer.delete(callId);
    }
}

export const urgencyDetector = new UrgencyDetector();
