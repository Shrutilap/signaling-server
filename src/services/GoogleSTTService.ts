import { v1 } from '@google-cloud/speech';
import pino from 'pino';
import { config } from '../config';
import ConversationService from './ConversationService';

const logger = pino({ level: config.logLevel });

export class GoogleSTTService {
    private client: v1.SpeechClient;

    constructor() {
        this.client = new v1.SpeechClient();
        logger.info('[GoogleSTT] Initialized Google Cloud Speech Client');
    }

    /**
     * One-off (batch) transcription for an audio buffer.
     * Useful for replacement of Whisper 7-second chunking logic.
     */
    async recognize(audioBuffer: Buffer): Promise<string> {
        try {
            const [response] = await this.client.recognize({
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 16000,
                    languageCode: 'en-IN',
                    alternativeLanguageCodes: ['hi-IN'],
                },
                audio: {
                    content: audioBuffer,
                },
            });

            const transcription = response.results
                ?.map(result => result.alternatives?.[0]?.transcript)
                .join('\n');

            return transcription || '';
        } catch (error: any) {
            logger.error({ error: error.message }, '[GoogleSTT] Batch recognition failed');
            return '';
        }
    }

    /**
     * Creates a streaming recognize session.
     * @param onTranscript Callback when a final/interim transcript is received
     * @param onError Callback when an error occurs
     * @param userId Optional user ID for DB persistence
     * @param otherUserId Optional recipient user ID for DB persistence
     */
    createStream(
        onTranscript: (transcript: string, isFinal: boolean) => void,
        onError: (error: Error) => void,
        userId?: string,
        otherUserId?: string
    ) {
        const recognizeStream = this.client
            .streamingRecognize({
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 16000,
                    languageCode: 'en-IN',
                    alternativeLanguageCodes: ['hi-IN'],
                    enableAutomaticPunctuation: true,
                    speechContexts: [{
                        phrases: ["Nimi", "Nirmal", "Nawaz", "Manya", "Shruti", "Shriniwas", "TIAA", "Gateway"],
                        boost: 20.0
                    }],
                },
                interimResults: true,
                singleUtterance: false,
            })
            .on('error', (err: any) => {
                logger.error({ error: err.message, code: err.code }, '[GoogleSTT] Stream Error');
                onError(err);
            })
            .on('metadata', (metadata) => {
                logger.info({ metadata }, '[GoogleSTT] Stream Metadata received');
            })
            .on('data', async (data: any) => {
                const result = data.results[0];
                if (result && result.alternatives[0]) {
                    const transcript = result.alternatives[0].transcript;
                    const isFinal = result.isFinal;

                    if (isFinal) {
                        logger.info({ transcript, userId, otherUserId }, '[GoogleSTT] Final transcript received');

                        // Persist to DB if user IDs are provided
                        if (userId && otherUserId && transcript.trim()) {
                            try {
                                await ConversationService.logCallTranscript(
                                    userId,
                                    otherUserId,
                                    transcript.trim(),
                                    Date.now()
                                );
                                logger.info('[GoogleSTT] Transcript persisted to MongoDB');
                            } catch (dbErr: any) {
                                logger.error({ error: dbErr.message }, '[GoogleSTT] Failed to persist transcript');
                            }
                        }
                    } else {
                        // Log interim results at a lower frequency to avoid flooding
                        if (Math.random() < 0.05) {
                            logger.info({ transcript, userId }, '[GoogleSTT] Interim transcript received (isFinal: false)');
                        }
                    }

                    onTranscript(transcript, isFinal);
                }
            });

        return {
            writeBlock: (data: string | Buffer) => {
                try {
                    const audioBuffer = Buffer.isBuffer(data)
                        ? data
                        : Buffer.from(data, 'base64');

                    if (audioBuffer.length > 0) {
                        recognizeStream.write(audioBuffer);
                    } else {
                        logger.warn('[GoogleSTT] Empty audio buffer, skipping write');
                    }
                } catch (e: any) {
                    logger.error({ error: e.message }, '[GoogleSTT] Error writing block to stream');
                }
            },

            close: () => {
                logger.info('[GoogleSTT] Closing stream');
                recognizeStream.end();
            }
        };
    }
}

export default new GoogleSTTService();